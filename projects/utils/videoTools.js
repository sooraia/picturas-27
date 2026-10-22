// Ferramentas de edição de vídeo (UC-VID-001): validação de parâmetros, ordem
// na pipeline e cancelamento dos pedidos em curso.
const fs = require("fs");
const path = require("path");

// Ferramentas disponíveis para projetos de vídeo (as restantes são só de imagem)
const VIDEO_TOOLS = ["trim"];

const MSG_TOO_SHORT = "O vídeo é demasiado curto para esta operação";
const MSG_TRIM_FORMAT = "Os instantes do recorte devem estar no formato hh:mm:ss.";
const MSG_TRIM_ORDER = "O instante inicial deve ser menor do que o instante final.";
const MSG_TRIM_RANGE = "Os instantes do recorte devem estar dentro da duração do vídeo.";

const TIME_RE = /^(\d{2}):([0-5]\d):([0-5]\d)$/;

// "hh:mm:ss" -> segundos, ou null se não estiver no formato (RN1)
function parseTime(value) {
  const m = TIME_RE.exec(String(value ?? ""));
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Valida os parâmetros do Trim face à duração do vídeo (RN1, RN2, Exceção 2).
 * @returns {string|null} mensagem de erro, ou null se forem válidos
 */
function validateTrimParams(params, duration) {
  const start = parseTime(params?.start);
  const end = parseTime(params?.end);

  if (start === null || end === null) return MSG_TRIM_FORMAT;
  if (Number.isFinite(duration) && duration < 1) return MSG_TOO_SHORT;
  if (start >= end) return MSG_TRIM_ORDER;
  if (Number.isFinite(duration) && end > duration) return MSG_TRIM_RANGE;
  return null;
}

/**
 * O Trim é sempre executado antes das restantes ferramentas (RN7, FA2);
 * as outras mantêm a ordem definida pelo utilizador.
 */
function orderVideoTools(tools) {
  const sorted = [...(tools || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const ordered = [
    ...sorted.filter((t) => t.procedure === "trim"),
    ...sorted.filter((t) => t.procedure !== "trim"),
  ];
  return ordered.map((t, i) => {
    const plain = t.toObject ? t.toObject() : t;
    return { ...plain, position: i };
  });
}

/**
 * Pede às ferramentas de vídeo que interrompam os pedidos em curso (RN5):
 * cada ferramenta procura `<output>.cancel` enquanto processa.
 */
function signalCancel(processes) {
  for (const p of processes || []) {
    if (!p?.new_img_uri) continue;
    try {
      const marker = path.join(__dirname, "/../", `${p.new_img_uri}.cancel`);
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, "");
    } catch (e) {
      console.error("[VIDEO] Error signalling cancel:", e.message);
    }
  }
}

module.exports = {
  VIDEO_TOOLS,
  MSG_TOO_SHORT,
  parseTime,
  validateTrimParams,
  orderVideoTools,
  signalCancel,
};
