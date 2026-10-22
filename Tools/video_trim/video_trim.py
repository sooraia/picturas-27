import sys
import os
import json
import time
import datetime
import subprocess
import pytz

from utils.tool_msg import ToolMSG
import utils.env as env

# Recorte temporal de vídeo (UC-VID-001): executa o intervalo [start, end] do
# vídeo de entrada com ffmpeg, enviando o progresso ao projects-ms (RN3).
# O vídeo original nunca é alterado: o resultado é escrito noutro ficheiro (RN6).

MSG_TOO_SHORT = "O vídeo é demasiado curto para esta operação"
MSG_ERROR = "Ocorreu um erro durante o processamento. Tente novamente."

# Intervalo entre mensagens de progresso (o requisito pede no máximo 5 s)
PROGRESS_INTERVAL_S = 1.0


class TrimError(Exception):
    pass


def parse_time(value):
    """'hh:mm:ss' -> segundos (RN1)."""
    parts = str(value).split(":")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise TrimError(f"Invalid time '{value}', expected hh:mm:ss")
    h, m, s = (int(p) for p in parts)
    if m > 59 or s > 59:
        raise TrimError(f"Invalid time '{value}', expected hh:mm:ss")
    return h * 3600 + m * 60 + s


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, timeout=60, check=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


class VideoTrim:
    def __init__(self):
        # heartbeat desligado: o callback fica bloqueado enquanto o ffmpeg corre
        self._tool_msg = ToolMSG('picturas-video-trim-tool-ms',
                                 'trim',
                                 env.RABBITMQ_HOST,
                                 env.RABBITMQ_PORT,
                                 env.RABBITMQ_USERNAME,
                                 env.RABBITMQ_PASSWORD,
                                 heartbeat=0)
        self._counter = 0
        self._codes = {
            'wrong_procedure': 2000,
            'error_processing': 2001,
            'too_short': 2002,
        }

    def trim_video(self, in_path, out_path, start, end, on_progress):
        """
        Recorta [start, end] (segundos) de in_path para out_path.
        Devolve False se o pedido foi cancelado (RN5).
        """
        duration = probe_duration(in_path)
        if duration < 1:
            raise TrimError(MSG_TOO_SHORT)

        # Instantes já validados contra o vídeo selecionado; nos restantes vídeos
        # do projeto o fim é limitado à duração de cada um
        end = min(end, duration)
        if start >= end:
            raise TrimError("Trim interval is outside the video duration")
        length = end - start

        # Escreve num temporário e só depois substitui o output: a entrada e a saída
        # podem ser o mesmo ficheiro quando há várias ferramentas na pipeline
        out_dir = os.path.dirname(out_path)
        base, ext = os.path.splitext(os.path.basename(out_path))
        tmp_path = os.path.join(out_dir, f".{base}.trim-{os.getpid()}{ext}")
        cancel_path = out_path + ".cancel"
        os.makedirs(out_dir, exist_ok=True)

        cmd = [
            "ffmpeg", "-y", "-v", "error", "-nostats",
            "-ss", f"{start:.3f}", "-i", in_path, "-t", f"{length:.3f}",
            "-map", "0:v:0", "-map", "0:a?",
            # recodificar para cortar no instante exato (e não no keyframe mais próximo)
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-movflags", "+faststart",
            "-progress", "pipe:1",
            tmp_path,
        ]

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        last_sent = 0.0
        cancelled = False

        try:
            for line in proc.stdout:
                if os.path.exists(cancel_path):
                    cancelled = True
                    proc.kill()
                    break

                key, _, value = line.strip().partition("=")
                if key == "out_time_us" and value.isdigit():
                    fraction = min(int(value) / 1_000_000 / length, 0.99)
                    now = time.monotonic()
                    if now - last_sent >= PROGRESS_INTERVAL_S:
                        on_progress(round(fraction, 3))
                        last_sent = now

            proc.wait()

            if cancelled or os.path.exists(cancel_path):
                return False

            if proc.returncode != 0:
                raise TrimError(proc.stderr.read().strip() or f"ffmpeg exited with {proc.returncode}")

            os.replace(tmp_path, out_path)
            return True
        finally:
            if proc.poll() is None:
                proc.kill()
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            if os.path.exists(cancel_path):
                os.remove(cancel_path)

    def _elapsed(self, timestamp):
        cur_timestamp = datetime.datetime.now(pytz.utc)
        processing_time = (cur_timestamp - timestamp).total_seconds() * 1000
        return cur_timestamp.isoformat(), processing_time

    def trim_callback(self, ch, method, properties, body):
        info = json.loads(body.decode())

        msg_id = info['messageId']
        timestamp = datetime.datetime.fromisoformat(info['timestamp'])
        procedure = info['procedure']
        in_path = info['parameters']['inputImageURI']
        out_path = info['parameters']['outputImageURI']

        resp_msg_id = f'trim-{self._counter}-{msg_id}'
        self._counter += 1

        def send_error(code, message, details):
            cur_timestamp, processing_time = self._elapsed(timestamp)
            self._tool_msg.send_msg(msg_id, resp_msg_id, cur_timestamp, 'error',
                                    processing_time, None,
                                    err_code=code, err_msg=message, og_img_uri=in_path)
            print(f"[TRIM] {msg_id} error: {details}", flush=True)

        if procedure != 'trim':
            send_error(self._codes['wrong_procedure'],
                       "The procedure received does not fit into this tool", procedure)
            return

        def on_progress(fraction):
            cur_timestamp, _ = self._elapsed(timestamp)
            self._tool_msg.send_progress(msg_id, resp_msg_id, cur_timestamp, fraction)

        try:
            start = parse_time(info['parameters']['start'])
            end = parse_time(info['parameters']['end'])

            done = self.trim_video(in_path, out_path, start, end, on_progress)
            if not done:
                # Cancelado pelo utilizador: o projects-ms já descartou este pedido
                print(f"[TRIM] {msg_id} cancelled", flush=True)
                return

            cur_timestamp, processing_time = self._elapsed(timestamp)
            self._tool_msg.send_msg(msg_id, resp_msg_id, cur_timestamp, 'success',
                                    processing_time, out_path, type="video")
        except TrimError as e:
            code = self._codes['too_short'] if str(e) == MSG_TOO_SHORT else self._codes['error_processing']
            message = MSG_TOO_SHORT if code == self._codes['too_short'] else MSG_ERROR
            send_error(code, message, str(e))
        except Exception as e:
            send_error(self._codes['error_processing'], MSG_ERROR, repr(e))

    def exec(self, args):
        while True:
            self._tool_msg.read_msg(self.trim_callback)


if __name__ == "__main__":
    video_trim = VideoTrim()
    video_trim.exec(sys.argv)
