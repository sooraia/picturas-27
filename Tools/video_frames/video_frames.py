"""PictuRAS video frame extraction service (RabbitMQ worker, video_frames_tool).

Runs the terminal frame extraction stage of a video pipeline (DA-2): it
consumes video_frames_queue, extracts the still frames (or the preview contact
sheet) and replies to projects on project_queue.
"""
from frame_extraction import InvalidExtraction, extract_frames  # noqa: F401
from video_common.stage_worker import StageWorker

MICROSERVICE = "picturas-video-frames-ms"


def make_worker(publish=None):
    return StageWorker("frames", MICROSERVICE,
                       runners={"frames": extract_frames}, publish=publish)


if __name__ == "__main__":
    make_worker().run()
