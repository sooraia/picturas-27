FROM python:3.11-slim

WORKDIR /app

# ffmpeg/ffprobe fazem o recorte e a leitura da duração do vídeo
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY ./video_trim .

COPY ./utils ./utils
RUN pip install --no-cache-dir -r ./utils/requirements.txt

CMD [ "python","-u", "video_trim.py"]
