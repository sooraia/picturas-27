// Limites de upload de vídeo por perfil (UC-VID-005, RN1, RN2, A3).
// Valores definidos nos requisitos REQ-VID-UP-002, REQ-VID-UP-005 e REQ-VID-UP-016.

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Extensões aceites na seleção (REQ-VID-UP-015); o formato real é confirmado com ffprobe
const VIDEO_EXTENSIONS = [".mp4", ".mov"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

// Nomes de container devolvidos pelo ffprobe (format_name) e codecs suportados:
// MP4 e MOV com codec H.264 (REQ-VID-UP-005)
const VIDEO_CONTAINERS = ["mov", "mp4"];
const VIDEO_CODECS = ["h264"];

// Resolução máxima: 1080p, igual para todos os perfis (REQ-VID-UP-005)
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

const PROFILES = {
  anonymous: {
    maxFileSize: 200 * MB,
    maxDuration: 5 * 60, // segundos
    storageQuota: 200 * MB,
  },
  free: {
    maxFileSize: 500 * MB,
    maxDuration: 10 * 60,
    storageQuota: 2 * GB,
  },
  premium: {
    maxFileSize: 2 * GB,
    maxDuration: 30 * 60,
    storageQuota: 10 * GB,
  },
};

function getVideoLimits(userType) {
  const profile = PROFILES[userType] || PROFILES.anonymous;
  return {
    ...profile,
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
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
