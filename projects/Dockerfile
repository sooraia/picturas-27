from node
workdir /app

# ffprobe (ffmpeg) valida formato, codec, duração e resolução dos vídeos
run apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

copy . .
run npm install

expose 9001
cmd ["npm", "start"]