# 30 segundos, 1080p, formato MP4, H.264 (formato válido)
ffmpeg -f lavfi -i testsrc=duration=30:size=1920x1080:rate=30 -c:v libx264 1080p_30s.mp4

# 30 segundos, 1080p, formato MOV, H.264 (formato válido)
ffmpeg -f lavfi -i testsrc=duration=30:size=1920x1080:rate=30 -c:v libx264 1080p_30s.mov

# 0.59 segundos, 1080p, formato MP4, H.264 (testar ferramenta de recorte)
ffmpeg -f lavfi -i testsrc=duration=0.59:size=1920x1080:rate=30 -c:v libx264 1080p_0.59s.mp4

# 350p, formato MP4, H.264 com durações de 5min5s, 10min5s e 30min5s (testar limites de tamanho por perfil)
ffmpeg -f lavfi -i testsrc=duration=305:size=640x360:rate=10 -c:v libx264 5m5s.mp4
ffmpeg -f lavfi -i testsrc=duration=605:size=640x360:rate=10 -c:v libx264 10m5s.mp4
ffmpeg -f lavfi -i testsrc=duration=1805:size=640x360:rate=10 -c:v libx264 30m5s.mp4

# 30 segundos, 1080p, formato AVI, H.264 (formato inválido)
ffmpeg -f lavfi -i testsrc=duration=30:size=1920x1080:rate=30 -c:v libx264 1080p_30s.avi

# Vídeo corrompido
ffmpeg -f lavfi -i testsrc=duration=30:size=1920x1080:rate=30 -c:v libx264 1080p_30s_corrupted.mp4
truncate -s 100 1080p_30s_corrupted.mp4

# 1080p, 30 segundos, > 600 MB (testar limites de perfil)
ffmpeg -f lavfi -i testsrc=duration=30:size=1920x1080:rate=30 -c:v libx264 video_600mb.mp4
truncate -s 605M video_600mb.mp4

# Ficheiro *.zip* recorrendo ao uso de ficheiros de vídeo mencionados
zip -r videos.zip 1080p_30s.mp4 1080p_30s.mov 1080p_0.59s.mp4

# zip com um ficheiro de vídeo corrompido
zip -r videos_corrupted.zip 1080p_30s_corrupted.mp4 1080p_30s.mov

