"""RabbitMQ worker shared by the video stage services (DA-2).

``projects`` still sends one message per video, with the whole pipeline, to
``video_queue`` and still receives one reply on ``project_queue``. The service
that consumes ``video_queue`` plans the stages; each service runs its stage and
forwards the job to the queue of the next stage, and the last one replies.
Progress goes straight to ``ws_queue`` as a percentage of the whole pipeline.

Each message is only acknowledged after its stage ends: if a service dies
midway, RabbitMQ redelivers that stage (and only that stage).
"""
import datetime
import json
import time
import uuid

import pytz

from .media import InvalidVideo
from .pipeline import (STAGE_SERVICES, UnsupportedEffect, finish, make_work_dir,
                       plan_stages, remove_work_dir, run_stage, stage_io, stage_progress)

EXCHANGE = "picturas"
PROJECT_QUEUE = "project_queue"
WS_QUEUE = "ws_queue"

CODES = {
    "wrong_procedure": 2000,
    "error_processing": 2001,
    "unsupported_effect": 2002,
    "invalid_trim": 2003,
    "invalid_video": 2004,
    "invalid_speed": 2005,
}


def now():
    return datetime.datetime.now(pytz.utc)


class StageWorker:
    """Runs the stages of one kind and forwards the job to the next stage.

    ``runners`` maps stage kinds to the functions this service provides (see
    ``pipeline.run_stage``); ``errors`` maps exception classes to error codes;
    ``supported`` is the set of effects accepted when planning a new job.
    ``publish(queue, msg)`` defaults to RabbitMQ and can be replaced in tests.
    """

    def __init__(self, kind, microservice, runners, errors=(), supported=(), publish=None):
        self.kind = kind
        self.queue, self.procedure = STAGE_SERVICES[kind]
        self.microservice = microservice
        self.runners = runners
        self.errors = [(UnsupportedEffect, "unsupported_effect"),
                       (InvalidVideo, "invalid_video"), *errors]
        self.supported = supported
        self._publish = publish
        self._channel = None

    # ------------------------------------------------------------ messages
    def publish(self, queue, msg):
        if self._publish:
            self._publish(queue, msg)
        else:
            self._channel.basic_publish(exchange=EXCHANGE, routing_key=queue,
                                        body=json.dumps(msg))

    def _reply_success(self, msg_id, started, output_uri, video_info):
        output = {"type": video_info.get("output_type", "video"),
                  "imageURI": video_info.get("output_path", output_uri)}
        if output["type"] == "frames":
            output["frames"] = video_info["frames"]
        self.publish(PROJECT_QUEUE, {
            "messageId": f"video-{uuid.uuid4()}",
            "correlationId": msg_id,
            "timestamp": now().isoformat(),
            "status": "success",
            "output": output,
            "metadata": {
                "processingTime": (now() - started).total_seconds() * 1000,
                "microservice": self.microservice,
                "video": video_info,
            },
        })

    def _reply_error(self, msg_id, started, code, message, input_uri):
        self.publish(PROJECT_QUEUE, {
            "messageId": f"video-{uuid.uuid4()}",
            "correlationId": msg_id,
            "timestamp": now().isoformat(),
            "status": "error",
            "error": {
                "code": code,
                "message": message,
                "msg": message,  # the orchestrator reads error.msg
                "details": {"inputFileURI": input_uri},
            },
            "metadata": {
                "processingTime": (now() - started).total_seconds() * 1000,
                "microservice": self.microservice,
            },
        })

    def _progress(self, progress, preview, percent):
        if not progress or not progress.get("user"):
            return
        self.publish(WS_QUEUE, {
            "messageId": f"update-client-video-progress-{uuid.uuid4()}",
            "timestamp": now().isoformat(),
            "status": "success",
            "user": progress["user"],
            "projectId": progress.get("projectId"),
            "imgId": progress.get("imgId"),
            "preview": bool(preview),
            "percent": percent,
        })

    def _forward(self, info, job):
        """Sends the job to the service of its current stage."""
        queue, procedure = STAGE_SERVICES[job["plan"][job["stage"]]["kind"]]
        self.publish(queue, {
            **info,
            "procedure": procedure,
            "parameters": {**info["parameters"], "stageJob": job},
        })

    def _error_code(self, error):
        for cls, name in self.errors:
            if isinstance(error, cls):
                return CODES[name]
        return CODES["error_processing"]

    # ------------------------------------------------------------ handling
    def handle(self, info):
        """Processes one message (without acknowledging it)."""
        started = now()
        try:
            msg_id = info["messageId"]
            params = info["parameters"]
            input_uri = params["inputImageURI"]
            output_uri = params["outputImageURI"]
            tools = params.get("tools") or []
            preview = bool(params.get("preview"))
            progress = params.get("progress") or {}
            job = params.get("stageJob")
        except (TypeError, KeyError) as e:
            print(f"[{self.kind}] invalid message discarded: {e}", flush=True)
            return

        if job and job.get("startedAt"):
            started = datetime.datetime.fromisoformat(job["startedAt"])

        if info.get("procedure") != self.procedure:
            self._reply_error(msg_id, started, CODES["wrong_procedure"],
                              "The procedure received does not fit into this tool", input_uri)
            return

        try:
            if job is None:
                # a new job from projects: plan its stages
                plan = plan_stages(tools, preview, self.supported)
                job = {"plan": plan, "stage": 0, "workDir": make_work_dir(plan, output_uri),
                       "startedAt": started.isoformat()}
                print(f"[{self.kind}] msg={msg_id} preview={preview} "
                      f"stages={[s['kind'] for s in plan]}", flush=True)
                if plan[0]["kind"] != self.kind:
                    self._forward(info, job)
                    return

            plan, index = job["plan"], job["stage"]
            source, target = stage_io(plan, index, input_uri, output_uri, job["workDir"])
            report = stage_progress(plan, index,
                                    lambda pct: self._progress(progress, preview, pct))
            result = run_stage(plan, index, source, target, report, self.runners)

            if index < len(plan) - 1:
                self._forward(info, {**job, "stage": index + 1})
                return

            result = finish(plan, output_uri, job["workDir"], result,
                            lambda pct: self._progress(progress, preview, pct))
            remove_work_dir(job["workDir"])
            self._reply_success(msg_id, started, output_uri, result)
            print(f"[{self.kind}] msg={msg_id} ok "
                  f"t={(now() - started).total_seconds():.1f}s", flush=True)
        except Exception as e:  # noqa: BLE001 - any failure is reported
            if job:
                remove_work_dir(job.get("workDir"))
            self._reply_error(msg_id, started, self._error_code(e), str(e), input_uri)

    # ------------------------------------------------------------ RabbitMQ
    def _connect(self):
        import pika
        import utils.env as env
        credentials = pika.PlainCredentials(env.RABBITMQ_USERNAME, env.RABBITMQ_PASSWORD)
        params = pika.ConnectionParameters(
            env.RABBITMQ_HOST, int(env.RABBITMQ_PORT), "/", credentials,
            # processing a stage blocks this thread for minutes; without a
            # heartbeat the broker does not drop the connection midway
            heartbeat=0,
        )
        for _ in range(30):
            try:
                return pika.BlockingConnection(params)
            except pika.exceptions.AMQPConnectionError:
                time.sleep(2)
        raise RuntimeError("Could not connect to RabbitMQ")

    def run(self):
        from pika.exchange_type import ExchangeType
        connection = self._connect()
        self._channel = connection.channel()
        self._channel.exchange_declare(exchange=EXCHANGE,
                                       exchange_type=ExchangeType.direct, durable=True)
        # declare every stage queue, so a forwarded job is never dropped
        # because the next service has not started yet
        for queue, _ in STAGE_SERVICES.values():
            self._channel.queue_declare(queue=queue, durable=True)
            self._channel.queue_bind(queue=queue, exchange=EXCHANGE, routing_key=queue)
        # one stage at a time per replica; parallelism comes from replicas
        self._channel.basic_qos(prefetch_count=1)

        def callback(ch, method, properties, body):
            try:
                info = json.loads(body.decode())
            except ValueError as e:
                print(f"[{self.kind}] invalid message discarded: {e}", flush=True)
                info = None
            if info is not None:
                self.handle(info)
            # manual ack only at the end of the stage
            ch.basic_ack(delivery_tag=method.delivery_tag)

        self._channel.basic_consume(queue=self.queue, on_message_callback=callback,
                                    auto_ack=False)
        print(f"[{self.kind}] waiting for jobs on {self.queue}", flush=True)
        self._channel.start_consuming()
