"""DA-2: the video pipeline split into stage services (Pipes and Filters).

The services are driven through an in-memory bus instead of RabbitMQ: a job
from projects enters video_queue, hops between the stage queues and ends with a
single reply on project_queue, exactly as before the split.
"""
from collections import defaultdict
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

import subtitles
from video_common.pipeline import plan_stages
from video_processor import SUPPORTED, process_video, probe

TOOLS_DIR = Path(__file__).resolve().parents[2]


def load_service(directory, module):
    spec = importlib.util.spec_from_file_location(f"{module}_service",
                                                  TOOLS_DIR / directory / f"{module}.py")
    service = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(service)
    return service


class Bus:
    """Stands in for RabbitMQ: each queue is a list, messages go through JSON."""

    def __init__(self):
        self.queues = defaultdict(list)
        self.workers = {}
        self.route = []

    def publish(self, queue, msg):
        self.queues[queue].append(json.loads(json.dumps(msg)))

    def connect(self, worker):
        self.workers[worker.queue] = worker

    def run(self, msg):
        self.publish("video_queue", msg)
        while any(self.queues[q] for q in self.workers):
            queue = next(q for q in self.workers if self.queues[q])
            self.route.append(queue)
            self.workers[queue].handle(self.queues[queue].pop(0))
        replies = self.queues["project_queue"]
        assert len(replies) == 1, "a job must end with exactly one reply"
        return replies[0]

    def progress(self):
        return [m["percent"] for m in self.queues["ws_queue"]]


@pytest.fixture
def bus():
    bus = Bus()
    bus.connect(load_service("video", "video").make_worker(bus.publish))
    bus.connect(load_service("video_subtitles", "video_subtitles").make_worker(bus.publish))
    bus.connect(load_service("video_frames", "video_frames").make_worker(bus.publish))
    return bus


def job(src, out, tools, preview=False, procedure="video"):
    return {
        "messageId": "request-1",
        "timestamp": "2026-11-26T00:00:00+00:00",
        "procedure": procedure,
        "parameters": {
            "inputImageURI": src,
            "outputImageURI": out,
            "tools": tools,
            "preview": preview,
            "progress": {"user": "u1", "projectId": "p1", "imgId": "v1"},
        },
    }


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Recognizer:
    def transcribe(self, path, **options):
        return iter([SimpleNamespace(start=0.2, end=1.8, text="Hello from PictuRAS")]), None


TRIM = {"procedure": "trim", "params": {"start": 0, "end": 2}}
SPEED = {"procedure": "speed", "params": {"factor": 2}}
CAPTIONS = {"procedure": "subtitles", "params": {}}
BRIGHT = {"procedure": "brightness", "params": {"brightness": 1.2}}


def frames(**params):
    return {"procedure": "extract_frames", "params": {"mode": "count", "count": 4, "format": "png", **params}}


# ---------------------------------------------------------------- planning

def test_plan_keeps_one_pass_for_ordinary_effects():
    plan = plan_stages([BRIGHT, TRIM, SPEED], False, SUPPORTED)
    assert [s["kind"] for s in plan] == ["effects"]
    assert plan[0]["tools"] == [BRIGHT, TRIM, SPEED]


def test_plan_orders_captions_between_effect_stages():
    plan = plan_stages([TRIM, CAPTIONS, SPEED], True, SUPPORTED)
    assert [s["kind"] for s in plan] == ["effects", "subtitles", "effects"]
    # the preview cut happens on the last stage with a temporal effect
    assert [s.get("preview") for s in plan] == [False, None, True]
    assert plan[-1]["range"][1] == 100


def test_plan_normalizes_input_before_leading_captions():
    plan = plan_stages([CAPTIONS], False, SUPPORTED)
    assert [s["kind"] for s in plan] == ["effects", "subtitles"]
    assert plan[0]["tools"] == []


def test_plan_extraction_is_terminal():
    only = plan_stages([frames()], False, SUPPORTED)
    assert [s["kind"] for s in only] == ["frames"] and only[0]["video_duration"]
    edited = plan_stages([SPEED, frames()], True, SUPPORTED)
    assert [s["kind"] for s in edited] == ["effects", "frames"]
    # sampling spans the complete edited timeline: only the extractor previews
    assert edited[0]["preview"] is False and edited[1]["preview"] is True


# ------------------------------------------------- services through the bus

def test_single_effect_job_matches_local_pipeline(bus, sample_video, tmp_path):
    local = str(tmp_path / "local.mp4")
    process_video(sample_video, local, [BRIGHT])

    out = str(tmp_path / "out.mp4")
    reply = bus.run(job(sample_video, out, [BRIGHT]))
    assert reply["status"] == "success" and reply["correlationId"] == "request-1"
    assert reply["output"] == {"type": "video", "imageURI": out}
    assert bus.route == ["video_queue"]
    assert sha(out) == sha(local)
    progress = bus.progress()
    assert progress == sorted(progress) and progress[-1] == 100


def test_captions_job_hops_between_services(bus, sample_video, tmp_path, monkeypatch):
    monkeypatch.setattr(subtitles, "speech_model", Recognizer)
    tools = [TRIM, CAPTIONS, SPEED]
    local = str(tmp_path / "local.mp4")
    expected = process_video(sample_video, local, tools)

    out_dir = tmp_path / "out"
    out = str(out_dir / "out.mp4")
    reply = bus.run(job(sample_video, out, tools))
    assert reply["status"] == "success"
    assert bus.route == ["video_queue", "video_subtitles_queue", "video_queue"]
    assert sha(out) == sha(local)
    assert reply["metadata"]["video"]["frames"] == expected["frames"]
    assert probe(out)["duration"] == pytest.approx(1, abs=0.15)
    progress = bus.progress()
    assert progress == sorted(progress) and progress[-1] == 100
    # only the final output is left next to it (no stage files)
    assert os.listdir(out_dir) == ["out.mp4"]


def test_extraction_only_goes_straight_to_frames_service(bus, silent_video, tmp_path):
    reply = bus.run(job(silent_video, str(tmp_path / "result.mp4"), [frames(count=3)]))
    assert bus.route == ["video_queue", "video_frames_queue"]
    assert reply["output"]["type"] == "frames"
    assert len(reply["output"]["frames"]) == 3
    assert reply["metadata"]["microservice"] == "picturas-video-frames-ms"


def test_preview_contact_sheet_after_effects(bus, sample_video, tmp_path):
    reply = bus.run(job(sample_video, str(tmp_path / "preview.mp4"),
                        [{"procedure": "speed", "params": {"factor": 0.5}}, frames(count=12)],
                        preview=True))
    assert bus.route == ["video_queue", "video_frames_queue"]
    assert reply["output"]["type"] == "image"
    assert reply["metadata"]["video"]["duration"] == pytest.approx(8, abs=0.15)
    assert not list(tmp_path.glob("video-stages-*"))


def test_stage_failure_replies_once_and_leaves_nothing(bus, sample_video, tmp_path, monkeypatch):
    def fail():
        raise RuntimeError("model unavailable")
    monkeypatch.setattr(subtitles, "speech_model", fail)
    out = tmp_path / "out.mp4"
    reply = bus.run(job(sample_video, str(out), [BRIGHT, CAPTIONS]))
    assert reply["status"] == "error"
    assert reply["error"]["code"] == 2001 and reply["error"]["msg"] == "model unavailable"
    assert not out.exists()
    assert not list(tmp_path.glob("video-stages-*"))


@pytest.mark.parametrize("tools,code", [
    ([{"procedure": "watermark", "params": {}}], 2002),
    ([{"procedure": "trim", "params": {"start": 3, "end": 1}}], 2003),
    ([{"procedure": "speed", "params": {"factor": 9}}], 2005),
])
def test_error_codes_are_unchanged(bus, sample_video, tmp_path, tools, code):
    reply = bus.run(job(sample_video, str(tmp_path / "out.mp4"), tools))
    assert reply["status"] == "error" and reply["error"]["code"] == code


def test_wrong_procedure_is_rejected(bus, sample_video, tmp_path):
    reply = bus.run(job(sample_video, str(tmp_path / "out.mp4"), [BRIGHT], procedure="brightness"))
    assert reply["error"]["code"] == 2000
