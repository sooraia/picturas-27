"""PictuRAS video captions service (RabbitMQ worker, video_subtitles_tool).

Runs the captioning stages of a video pipeline (DA-2): it consumes
video_subtitles_queue, burns the recognised speech into the MP4 and forwards
the job to the next stage, or replies to projects if it is the last one.
The speech model and its dependencies live only in this service.
"""
from subtitles import caption_video
from video_common.stage_worker import StageWorker

MICROSERVICE = "picturas-video-subtitles-ms"


def make_worker(publish=None):
    return StageWorker("subtitles", MICROSERVICE,
                       runners={"subtitles": caption_video}, publish=publish)


if __name__ == "__main__":
    make_worker().run()
