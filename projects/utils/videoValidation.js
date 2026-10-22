// Validação de vídeos no servidor depois da transferência (UC-VID-005, Passo 5, A4):
// integridade, formato real, codec, duração e resolução, através do ffprobe.
const { execFile } = require("child_process");
const { formatDuration } = require("./videoLimits");

const MSG_UNSUPPORTED = "Formato ou codec de vídeo não suportado.";
const MSG_CORRUPTED = "Não foi possível ler o vídeo por se encontrar corrompido.";

function ffprobe(filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: 60 * 1000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

/**
 * Valida um ficheiro de vídeo face aos limites do perfil.
 * @returns {{ ok: true, meta } | { ok: false, reason: string }}
 */
async function validateVideo(filePath, limits) {
  let info;
  try {
    info = await ffprobe(filePath);
  } catch (_) {
    return { ok: false, reason: MSG_CORRUPTED };
  }

  const video = (info.streams || []).find((s) => s.codec_type === "video");
  const duration = Number(info.format?.duration);

  if (!video || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, reason: MSG_CORRUPTED };
  }

  const containers = String(info.format?.format_name || "").split(",");
  if (!containers.some((c) => limits.containers.includes(c))) {
    return { ok: false, reason: MSG_UNSUPPORTED };
  }

  if (!limits.codecs.includes(video.codec_name)) {
    return { ok: false, reason: MSG_UNSUPPORTED };
  }

  if (duration > limits.maxDuration) {
    return {
      ok: false,
      reason: `O vídeo excede a duração máxima permitida para o seu perfil (${formatDuration(limits.maxDuration)}).`,
    };
  }

  // Compara lado maior com lado maior, para aceitar vídeos na vertical
  const width = Number(video.width);
  const height = Number(video.height);
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide > limits.maxWidth || shortSide > limits.maxHeight) {
    return {
      ok: false,
      reason: `O vídeo excede a resolução máxima permitida para o seu perfil (${limits.maxWidth}x${limits.maxHeight}).`,
    };
  }

  return {
    ok: true,
    meta: { duration, width, height, codec: video.codec_name },
  };
}

module.exports = { validateVideo, MSG_UNSUPPORTED, MSG_CORRUPTED };
