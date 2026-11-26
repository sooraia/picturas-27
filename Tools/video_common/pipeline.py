"""Video pipeline as a sequence of stages (DA-2, Pipes and Filters).

A video pipeline is split into stages, each run by its own service:

- ``effects``   (``video_tool``, ``video_queue``): trim, speed and frame effects,
  in one decode/encode pass;
- ``subtitles`` (``video_subtitles_tool``, ``video_subtitles_queue``): captions;
- ``frames``    (``video_frames_tool``, ``video_frames_queue``): frame extraction.

The plan is the one the single video worker used to follow internally:
contiguous ordinary effects share one pass, captions are ordered stages and
frame extraction is terminal. Stages hand their output to the next one through
a work directory next to the final output; only the last stage publishes the
result, so a failure never leaves partial output.

``run_pipeline`` runs every stage in-process (reference composition, used by
the tests); the stage services run the very same functions one stage at a time
and forward the job between queues (see ``stage_worker``).
"""
import math
import os
import shutil
import tempfile
from pathlib import Path

from .media import probe

MAX_FRAMES = 100

# stage kind -> (queue, procedure) of the service that runs it
STAGE_SERVICES = {
    "effects": ("video_queue", "video"),
    "subtitles": ("video_subtitles_queue", "video_subtitles"),
    "frames": ("video_frames_queue", "video_frames"),
}


class UnsupportedEffect(Exception):
    pass


class InvalidExtraction(ValueError):
    """Invalid frame extraction parameters or an excessive output count."""


def validate_params(params):
    if not isinstance(params, dict):
        raise InvalidExtraction("Frame extraction requires parameters")
    mode = params.get("mode", "count")
    fmt = params.get("format", "png")
    if mode not in ("count", "interval") or fmt not in ("png", "jpeg"):
        raise InvalidExtraction("Choose count/interval and PNG/JPEG")
    value = params.get("count", 6) if mode == "count" else params.get("interval", 2)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise InvalidExtraction("Frame count or interval must be a finite number")
    if mode == "count" and (value != int(value) or not 1 <= value <= MAX_FRAMES):
        raise InvalidExtraction("Frame count must be an integer between 1 and 100")
    if mode == "interval" and value <= 0:
        raise InvalidExtraction("Frame interval must be greater than zero")
    return mode, value, fmt


def validate_tools(tools: list, supported) -> None:
    extractors = [i for i, tool in enumerate(tools) if tool.get("procedure") == "extract_frames"]
    if extractors:
        if extractors != [len(tools) - 1]:
            raise InvalidExtraction("Frame extraction must appear once, at the end of the pipeline")
        validate_params(tools[-1].get("params", {}))
    for tool in tools:
        if tool.get("procedure") not in set(supported) | {"subtitles", "extract_frames"}:
            raise UnsupportedEffect(
                f"Effect '{tool.get('procedure')}' is not available for video"
            )


def plan_stages(tools: list, preview: bool, supported) -> list:
    """Splits the pipeline into stages; each has a progress ``range`` in [0, 100]."""
    validate_tools(tools, supported)
    if tools and tools[-1].get("procedure") == "extract_frames":
        frames = {"kind": "frames", "params": tools[-1].get("params", {}), "preview": bool(preview)}
        if len(tools) == 1:
            # With no preceding edits, seek directly in the original. Extracting
            # a few stills must not transcode an entire long video or add a lossy
            # generation before a PNG export. Use video duration when available
            # so a longer audio stream does not create out-of-range sample times.
            return [{**frames, "video_duration": True, "range": [0, 100]}]
        # Sampling spans the complete edited timeline, including in preview.
        before = _plan_video(tools[:-1], preview=False)
        for stage in before:
            stage["range"] = [stage["range"][0] * 0.7, stage["range"][1] * 0.7]
        return before + [{**frames, "video_duration": False, "range": [70, 100]}]
    return _plan_video(tools, bool(preview))


def _plan_video(tools: list, preview: bool) -> list:
    if not any(t.get("procedure") == "subtitles" for t in tools):
        return [{"kind": "effects", "tools": tools, "preview": preview, "range": [0, 100]}]

    groups, pending = [], []
    for tool in tools:
        if tool.get("procedure") == "subtitles":
            # Normalize the first input to MP4/H.264 even when captioning is a no-op.
            if pending or not groups:
                groups.append(pending)
                pending = []
            groups.append(None)
        else:
            pending.append(tool)
    if pending:
        groups.append(pending)

    # A preview is the first seconds of the final timeline. Cutting the initial
    # input before a later trim/speed would discard needed frames or produce the
    # wrong preview length. Keep preceding stages complete until the final
    # temporal stage; ordinary pipelines still limit input before recognition.
    preview_stage = max(
        (index for index, group in enumerate(groups)
         if group is not None and any(
             tool.get("procedure") in {"trim", "speed"} for tool in group)),
        default=0,
    )

    count = len(groups)
    stages = []
    for index, group in enumerate(groups):
        span = [index * 100 / count, (index + 1) * 100 / count]
        if group is None:
            stages.append({"kind": "subtitles", "range": span})
        else:
            stages.append({"kind": "effects", "tools": group,
                           "preview": preview and index == preview_stage, "range": span})
    return stages


def make_work_dir(plan: list, output_path: str):
    """Directory where stages hand over their intermediate MP4 (None for one stage)."""
    if len(plan) == 1:
        return None
    target = Path(output_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    return tempfile.mkdtemp(prefix="video-stages-", dir=target.parent)


def remove_work_dir(work_dir) -> None:
    if work_dir:
        shutil.rmtree(work_dir, ignore_errors=True)


def stage_io(plan: list, index: int, input_path: str, output_path: str, work_dir):
    """Input and output files of stage ``index``."""
    source = input_path if index == 0 else os.path.join(work_dir, f"stage-{index - 1}.mp4")
    if len(plan) == 1 or plan[index]["kind"] == "frames":
        target = output_path
    else:
        target = os.path.join(work_dir, f"stage-{index}.mp4")
    return source, target


def stage_progress(plan: list, index: int, progress_cb):
    """Maps the 0-100 progress of one stage into its range of the whole pipeline."""
    if progress_cb is None:
        return None
    low, high = plan[index]["range"]
    capped = len(plan) > 1 and plan[index]["kind"] != "frames"

    def report(percent):
        value = int(low + percent * (high - low) / 100)
        # 100 % is only reported once the whole pipeline has finished
        progress_cb(min(99, value) if capped else value)
    return report


def run_stage(plan: list, index: int, source: str, target: str, report, runners: dict):
    """Runs one stage with the service functions in ``runners`` (by stage kind)."""
    stage = plan[index]
    if len(plan) > 1 and stage["kind"] != "frames" and report:
        report(0)
    if stage["kind"] == "effects":
        return runners["effects"](source, target, stage["tools"], report, stage["preview"])
    if stage["kind"] == "subtitles":
        runners["subtitles"](source, target, probe(source), report or (lambda _: None))
        return None
    if stage["kind"] == "frames":
        info = probe(source, prefer_video_duration=stage["video_duration"])
        return runners["frames"](source, target, info, stage["params"],
                                 report or (lambda _: None), preview=stage["preview"])
    raise UnsupportedEffect(f"Unknown video stage '{stage['kind']}'")


def finish(plan: list, output_path: str, work_dir, last_result, progress_cb):
    """After the last stage: publishes the output and returns the job information."""
    if len(plan) == 1 or plan[-1]["kind"] == "frames":
        return last_result
    current = os.path.join(work_dir, f"stage-{len(plan) - 1}.mp4")
    result = probe(current)
    result["frames"] = round(result["duration"] * result["fps"])
    target = Path(output_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(current, target)
    if progress_cb:
        progress_cb(100)
    return result


def run_pipeline(input_path: str, output_path: str, tools: list, runners: dict, supported,
                 progress_cb=None, preview: bool = False) -> dict:
    """Runs every stage in this process, in order (reference composition)."""
    plan = plan_stages(tools, preview, supported)
    work_dir = make_work_dir(plan, output_path)
    try:
        result = None
        for index in range(len(plan)):
            source, target = stage_io(plan, index, input_path, output_path, work_dir)
            result = run_stage(plan, index, source, target,
                               stage_progress(plan, index, progress_cb), runners)
        return finish(plan, output_path, work_dir, result, progress_cb)
    finally:
        remove_work_dir(work_dir)
