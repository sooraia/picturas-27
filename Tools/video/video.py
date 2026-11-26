"""PictuRAS video effects service (RabbitMQ worker, video_tool).

Entry point of the video pipeline (DA-2): projects sends one message per video,
carrying the whole pipeline, to video_queue. This service plans the stages,
runs the effects stages (trim, speed and frame effects in one decode/encode
pass) and forwards the job to the captions or frame extraction services when
the pipeline needs them. The last stage replies to projects on project_queue;
progress goes straight to the WebSocket gateway (ws_queue) as a percentage.

The message is only acknowledged after the stage ends: if the worker dies
midway, RabbitMQ redelivers it.
"""
from effects import SUPPORTED
from video_common.stage_worker import StageWorker
from video_processor import InvalidSpeed, InvalidTrim, _process_video

MICROSERVICE = "picturas-video-tool-ms"


def make_worker(publish=None):
    return StageWorker(
        "effects", MICROSERVICE,
        runners={"effects": _process_video},
        errors=[(InvalidTrim, "invalid_trim"), (InvalidSpeed, "invalid_speed")],
        supported=SUPPORTED,
        publish=publish,
    )


if __name__ == "__main__":
    make_worker().run()
