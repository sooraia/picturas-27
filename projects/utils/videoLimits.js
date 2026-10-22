// Limites de upload de vídeo por perfil (UC-VID-005, RN1, RN2, RN5, A3).
// Os valores são uma proposta para o MVP e podem ser ajustados aqui sem
// tocar no resto do código.

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Extensões aceites na seleção; o formato real é confirmado com ffprobe
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

// Nomes de container devolvidos pelo ffprobe (format_name) e codecs suportados
const VIDEO_CONTAINERS = ["mov", "mp4", "matroska", "webm"];
const VIDEO_CODECS = ["h264", "hevc", "vp8", "vp9", "av1"];

// Tamanho máximo de um .zip, para evitar sobrecarga na descompactação (Q2)
const MAX_ZIP_SIZE = 4 * GB;

const PROFILES = {
  anonymous: {
    maxFileSize: 100 * MB,
    maxDuration: 60, // segundos
    maxWidth: 1280,
    maxHeight: 720,
    storageQuota: 500 * MB,
    zipAllowed: false,
  },
  free: {
    maxFileSize: 500 * MB,
    maxDuration: 5 * 60,
    maxWidth: 1920,
    maxHeight: 1080,
    storageQuota: 2 * GB,
    zipAllowed: true,
  },
  premium: {
    maxFileSize: 2 * GB,
    maxDuration: 30 * 60,
    maxWidth: 3840,
    maxHeight: 2160,
    storageQuota: 20 * GB,
    zipAllowed: true,
  },
};

function getVideoLimits(userType) {
  const profile = PROFILES[userType] || PROFILES.anonymous;
  return {
    ...profile,
    maxZipSize: MAX_ZIP_SIZE,
    extensions: VIDEO_EXTENSIONS,
    containers: VIDEO_CONTAINERS,
    codecs: VIDEO_CODECS,
  };
}

function formatBytes(bytes) {
  if (bytes >= GB) return `${+(bytes / GB).toFixed(2)} GB`;
  return `${+(bytes / MB).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${+(seconds / 60).toFixed(1)} min`;
}

module.exports = {
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  getVideoLimits,
  formatBytes,
  formatDuration,
};
