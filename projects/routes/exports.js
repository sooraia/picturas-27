// Exportação de vídeos processados (UC-VID-002): gera um MP4 (H.264) a partir do
// resultado do processamento, com progresso e cancelamento, reutiliza o ficheiro
// enquanto o resultado não mudar e regista cada descarga no histórico do vídeo.
//
// Como o router de vídeo, é montado antes do router de projetos (ver app.js).

const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const Project = require("../controllers/project");
const Result = require("../controllers/result");
const VideoExport = require("../models/videoExport");
const { httpsAgent } = require("../utils/httpsAgent");
const { getCallerId } = require("../utils/caller");
const { checkSharePermission } = require("../middleware/shareAuth");
const { send_msg_client_export } = require("../utils/project_msg");
const {
  get_image_internal_url,
  get_image_public_url,
  post_file_stream,
  delete_image,
} = require("../utils/imageStorage");

const users_ms = "https://users:10001/";

// Tamanho máximo do ficheiro exportado para utilizadores anónimos e com plano
// Free (RN3). O caso de uso deixa o valor em aberto ("X MB"): ajustar aqui.
const MB = 1024 * 1024;
const MAX_EXPORT_SIZE = 500 * MB;
const LIMITED_TYPES = ["anonymous", "free"];

const MSG_NOT_PROCESSED =
  "Só é possível exportar vídeos cujo processamento tenha sido concluído com sucesso.";
const MSG_FAILED = "Não foi possível exportar este vídeo. Tente novamente.";
const MSG_TOO_BIG =
  "Este vídeo excede o tamanho máximo de exportação permitido para a sua conta";

const TMP_DIR = path.join(os.tmpdir(), "picturas-exports");
fs.mkdirSync(TMP_DIR, { recursive: true });

// Exportações em curso neste processo: exportId -> { child, cancelled, tmpDir }
const jobs = new Map();

// ================== HELPERS ==================

async function getUserType(userId) {
  const resp = await axios.get(users_ms + `${userId}/type`, { httpsAgent });
  return resp.data.type;
}

// Resultado do processamento mais recente (commitado) de um vídeo (RN1)
async function getVideoResult(user, project, img) {
  const doc = await Project.getOne(user, project);
  if (!doc || doc.type !== "video") return null;

  const results = await Result.getAllByToken(user, project, doc.committedToken || 0);
  return results.find((r) => String(r.img_id) === String(img) && r.type === "video") || null;
}

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

async function download(url, dest) {
  const resp = await axios.get(url, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    writer.on("finish", resolve);
    writer.on("error", reject);
    resp.data.on("error", reject);
    resp.data.pipe(writer);
  });
}

/**
 * Gera o MP4 final (RN2): se o resultado já é H.264, o vídeo é copiado sem
 * recodificar (mantém resolução e qualidade e é rápido); caso contrário é
 * recodificado para H.264 com a mesma resolução.
 */
async function encodeMp4(job, input, output, onProgress) {
  const info = await ffprobe(input);
  const video = (info.streams || []).find((s) => s.codec_type === "video");
  const audio = (info.streams || []).find((s) => s.codec_type === "audio");
  const duration = Number(info.format?.duration) || 0;
  if (!video) throw new Error("No video stream");

  const args = ["-y", "-v", "error", "-nostats", "-i", input, "-map", "0:v:0", "-map", "0:a?"];
  args.push(...(video.codec_name === "h264" ? ["-c:v", "copy"] : ["-c:v", "libx264", "-pix_fmt", "yuv420p"]));
  if (audio) args.push(...(audio.codec_name === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac"]));
  args.push("-movflags", "+faststart", "-progress", "pipe:1", "-f", "mp4", output);

  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args);
    job.child = child;

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.on("data", (chunk) => {
      const m = /out_time_us=(\d+)/g;
      let last = null;
      let r;
      while ((r = m.exec(String(chunk))) !== null) last = Number(r[1]);
      if (last !== null && duration > 0) onProgress(Math.min(last / 1e6 / duration, 0.99));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      job.child = null;
      if (job.cancelled) return reject(new Error("cancelled"));
      if (code !== 0) return reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`));
      resolve();
    });
  });
}

function notify(runnerId, payload) {
  send_msg_client_export(
    `update-client-export-${uuidv4()}`,
    new Date().toISOString(),
    runnerId,
    payload
  );
}

/**
 * Executa a exportação em segundo plano (Passos 4 e 5, FA2). Em caso de falha
 * ou cancelamento, o ficheiro parcial é descartado (Garantia Mínima).
 */
async function runExport(exp, result, runnerId, limited) {
  const exportId = String(exp._id);
  const tmpDir = path.join(TMP_DIR, exportId);
  const job = { child: null, cancelled: false, tmpDir };
  jobs.set(exportId, job);

  const input = path.join(tmpDir, `in${path.extname(result.file_name) || ".mp4"}`);
  const output = path.join(tmpDir, "out.mp4");
  const base = { exportId, imgId: String(exp.img_id), fileName: exp.file_name };

  let lastSent = 0;
  const onProgress = (p) => {
    // atualizações no máximo uma vez por segundo
    if (Date.now() - lastSent < 1000) return;
    lastSent = Date.now();
    notify(runnerId, { ...base, status: "progress", progress: Math.round(p * 100) });
  };

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    notify(runnerId, { ...base, status: "progress", progress: 0 });

    const urlResp = await get_image_internal_url(exp.user_id, exp.project_id, "out", result.img_key);
    await download(urlResp.data.url, input);
    if (job.cancelled) throw new Error("cancelled");

    await encodeMp4(job, input, output, onProgress);

    const size = fs.statSync(output).size;
    // O limite é verificado antes de gerar; aqui confirma-se com o tamanho real (Exceção 2)
    if (limited && size > MAX_EXPORT_SIZE) {
      await VideoExport.deleteOne({ _id: exp._id });
      return notify(runnerId, { ...base, status: "error", message: MSG_TOO_BIG });
    }

    const resp = await post_file_stream(exp.user_id, exp.project_id, "export", output, "mp4", "video/mp4");
    const fileKey = resp.data.data.imageKey.split("/").pop();

    if (job.cancelled) {
      await delete_image(exp.user_id, exp.project_id, "export", fileKey).catch(() => {});
      throw new Error("cancelled");
    }

    await VideoExport.updateOne({ _id: exp._id }, { $set: { status: "done", file_key: fileKey, size } });
    notify(runnerId, { ...base, status: "done", progress: 100 });
  } catch (e) {
    await VideoExport.deleteOne({ _id: exp._id }).catch(() => {});
    if (job.cancelled) {
      console.log(`[EXPORT] ${exportId} cancelled`);
    } else {
      console.error(`[EXPORT] ${exportId} failed:`, e.message);
      notify(runnerId, { ...base, status: "error", message: MSG_FAILED });
    }
  } finally {
    jobs.delete(exportId);
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  }
}

// Ficheiros exportados de um projeto (usado ao apagar o projeto)
async function deleteProjectExports(userId, projectId) {
  const exports = await VideoExport.find({ user_id: userId, project_id: projectId }).exec();
  for (const e of exports) {
    const job = jobs.get(String(e._id));
    if (job) {
      job.cancelled = true;
      job.child?.kill("SIGKILL");
    }
    if (e.file_key) await delete_image(userId, projectId, "export", e.file_key).catch(() => {});
  }
  await VideoExport.deleteMany({ user_id: userId, project_id: projectId }).exec();
}

// ================== ROTAS ==================

/**
 * Exportar um vídeo processado (Passos 2 a 5, FA1, FA2, Exceção 2).
 * @returns 200 { exportId, status: "done", fileName } se já existir um ficheiro para este resultado,
 *          202 { exportId, status: "processing", fileName } se a geração começou
 */
router.post("/:user/:project/export/:img", checkSharePermission, async (req, res) => {
  const { user, project, img } = req.params;
  const callerId = getCallerId(req) || user;

  try {
    const result = await getVideoResult(user, project, img);
    if (!result) return res.status(409).jsonp(MSG_NOT_PROCESSED);

    // FA1 / RN4: o resultado não mudou desde a última exportação -> reutilizar
    let existing = await VideoExport.findOne({
      project_id: project,
      img_id: img,
      source_key: result.img_key,
    }).exec();

    // Geração interrompida (ex.: reinício do serviço) sem job ativo: recomeçar
    if (existing?.status === "processing" && !jobs.has(String(existing._id))) {
      await VideoExport.deleteOne({ _id: existing._id });
      existing = null;
    }

    const limited = LIMITED_TYPES.includes(await getUserType(callerId));

    // RN3: com cópia sem recodificação, o ficheiro final tem o tamanho do resultado
    const expectedSize = existing?.size || result.size || 0;
    if (limited && expectedSize > MAX_EXPORT_SIZE) return res.status(413).jsonp(MSG_TOO_BIG);

    if (existing) {
      return res.status(existing.status === "done" ? 200 : 202).jsonp({
        exportId: existing._id,
        status: existing.status,
        fileName: existing.file_name,
      });
    }

    const base = path.basename(result.file_name, path.extname(result.file_name));
    const exp = await VideoExport.create({
      user_id: user,
      project_id: project,
      img_id: img,
      source_key: result.img_key,
      file_name: `${base}.mp4`,
    });

    runExport(exp, result, callerId, limited);

    return res.status(202).jsonp({ exportId: exp._id, status: "processing", fileName: exp.file_name });
  } catch (e) {
    console.error("[EXPORT] Error starting export:", e.message);
    return res.status(500).jsonp(MSG_FAILED);
  }
});

/**
 * Cancelar uma exportação em curso (FA3): o ficheiro parcial é descartado e o
 * vídeo não é alterado.
 */
router.delete("/:user/:project/export/:exportId", checkSharePermission, async (req, res) => {
  try {
    const exp = await VideoExport.findOne({
      _id: req.params.exportId,
      project_id: req.params.project,
    }).exec();
    if (!exp) return res.sendStatus(204);
    if (exp.status === "done") return res.status(409).jsonp("A exportação já terminou.");

    const job = jobs.get(String(exp._id));
    if (job) {
      job.cancelled = true;
      job.child?.kill("SIGKILL");
    }
    await VideoExport.deleteOne({ _id: exp._id });
    return res.sendStatus(204);
  } catch (e) {
    console.error("[EXPORT] Error cancelling export:", e.message);
    return res.status(500).jsonp("Error cancelling export");
  }
});

/**
 * Obter o URL de descarga de um ficheiro exportado (Passos 5 e 6) e registar a
 * exportação no histórico do vídeo (REQ-VID-EXPORT-005).
 * @returns { url, fileName }
 */
router.get("/:user/:project/export/:exportId/download", checkSharePermission, async (req, res) => {
  try {
    const exp = await VideoExport.findOne({
      _id: req.params.exportId,
      project_id: req.params.project,
      status: "done",
    }).exec();
    if (!exp) return res.status(404).jsonp(MSG_FAILED);

    const resp = await get_image_public_url(req.params.user, req.params.project, "export", exp.file_key);

    await VideoExport.updateOne(
      { _id: exp._id },
      { $push: { history: { exportedAt: new Date(), exported_by: getCallerId(req) } } }
    );

    return res.status(200).jsonp({ url: resp.data.url, fileName: exp.file_name });
  } catch (e) {
    console.error("[EXPORT] Error getting download url:", e.message);
    return res.status(500).jsonp(MSG_FAILED);
  }
});

/**
 * Histórico de exportações de um vídeo, mais recentes primeiro (REQ-VID-EXPORT-005)
 * @returns [{ exportedAt, fileName }]
 */
router.get("/:user/:project/export/:img/history", checkSharePermission, async (req, res) => {
  try {
    const exports = await VideoExport.find({
      project_id: req.params.project,
      img_id: req.params.img,
    }).exec();

    const history = exports
      .flatMap((e) => e.history.map((h) => ({ exportedAt: h.exportedAt, fileName: e.file_name })))
      .sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));

    return res.status(200).jsonp(history);
  } catch (e) {
    console.error("[EXPORT] Error getting history:", e.message);
    return res.status(500).jsonp("Error acquiring export history");
  }
});

module.exports = { router, deleteProjectExports };
