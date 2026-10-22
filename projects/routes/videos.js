// Upload de vídeo (UC-VID-005): criação de projetos de vídeo, transferência de
// vídeos individuais ou em lote (.zip), validação no servidor, quota de
// armazenamento e limpeza de temporários / projetos de utilizadores anónimos.
//
// Este router é montado ANTES do router de projetos (ver app.js), para que
// rotas como GET /:user/storage não sejam apanhadas por GET /:user/:project.

const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const yauzl = require("yauzl");
const { v4: uuidv4 } = require("uuid");

const Project = require("../controllers/project");
const { httpsAgent } = require("../utils/httpsAgent");
const { post_file_stream, delete_image } = require("../utils/imageStorage");
const {
  checkSharePermission,
  requireEditPermission,
} = require("../middleware/shareAuth");
const {
  IMAGE_EXTENSIONS,
  getVideoLimits,
  formatBytes,
} = require("../utils/videoLimits");
const {
  validateVideo,
  MSG_UNSUPPORTED,
  MSG_CORRUPTED,
} = require("../utils/videoValidation");
const { deleteProjectAndResources } = require("./projects");

const users_ms = "https://users:10001/";

const MSG_MIXED = "Um projeto só pode conter imagens ou vídeos.";
const MSG_QUOTA = "Espaço livre insuficiente na biblioteca.";
const MSG_TRANSFER = "Falha na transferência do vídeo. Tente novamente.";
const MSG_ZIP_UNREADABLE = "Não foi possível ler o ficheiro .zip.";
const MSG_ZIP_EMPTY = "O ficheiro .zip não contém vídeos.";

const msgTooBig = (limits) =>
  `O vídeo excede o tamanho máximo permitido para o seu perfil (${formatBytes(limits.maxFileSize)}).`;
// O .zip está sujeito ao mesmo limite de tamanho de ficheiro do perfil (Q2)
const msgZipTooBig = (limits) =>
  `O ficheiro .zip excede o tamanho máximo permitido para o seu perfil (${formatBytes(limits.maxFileSize)}).`;

const MIME_TYPES = {
  mp4: "video/mp4",
  mov: "video/quicktime",
};

// ================== TEMPORÁRIOS ==================

// Os ficheiros recebidos ficam aqui até serem validados e enviados para o S3.
// Não contam para a quota (RN7) e são apagados em até 5 minutos (REQ-VID-UP-011).
const TMP_DIR = path.join(os.tmpdir(), "picturas-uploads");
fs.mkdirSync(TMP_DIR, { recursive: true });

const TMP_MAX_AGE_MS = 4 * 60 * 1000;
const ANON_MAX_IDLE_MS = 3 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

// Temporários a ser validados/enviados neste momento (o varrimento ignora-os)
const processingTmp = new Set();

function removeTmp(p) {
  processingTmp.delete(p);
  fs.rm(p, { recursive: true, force: true }, () => {});
}

function cleanupRequest(req) {
  for (const p of req.tmpPaths || []) removeTmp(p);
  req.tmpPaths = [];
}

// ================== HELPERS ==================

function extOf(name) {
  return path.extname(String(name)).toLowerCase();
}

async function getUserType(userId) {
  const resp = await axios.get(users_ms + `${userId}/type`, { httpsAgent });
  return resp.data.type;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// Carrega o projeto de vídeo e os limites do perfil do dono
async function loadVideoProject(req, res, next) {
  try {
    const project =
      req.sharedProject ||
      (await Project.getOne(req.params.user, req.params.project));
    if (!project) return res.status(404).jsonp("Project not found");
    if (project.type !== "video") return res.status(400).jsonp(MSG_MIXED);

    const userType = await getUserType(req.params.user);
    req.ownerType = userType;
    req.videoLimits = getVideoLimits(userType);
    next();
  } catch (e) {
    console.error("[VIDEO] Error loading project:", e.message);
    return res.status(501).jsonp("Error acquiring user's project");
  }
}

/**
 * Recebe um único ficheiro (campo `field`) para disco, com limite de tamanho.
 * Se o cliente cancelar ou a ligação cair (FA3, Exceção 5), os temporários são apagados.
 */
function receiveFile(field, maxBytesOf, tooBigMsgOf) {
  return (req, res, next) => {
    req.tmpPaths = [];

    const storage = multer.diskStorage({
      destination: TMP_DIR,
      filename: (req, file, cb) => {
        const name = `${uuidv4()}${extOf(file.originalname)}`;
        req.tmpPaths.push(path.join(TMP_DIR, name));
        cb(null, name);
      },
    });

    res.on("close", () => {
      if (!res.writableFinished) {
        req.cancelled = true;
        cleanupRequest(req);
      }
    });

    multer({ storage, limits: { fileSize: maxBytesOf(req), files: 1 } }).single(field)(
      req,
      res,
      (err) => {
        if (err) {
          cleanupRequest(req);
          if (req.cancelled || res.headersSent) return;
          if (err.code === "LIMIT_FILE_SIZE")
            return res.status(413).jsonp(tooBigMsgOf(req));
          return res.status(400).jsonp(MSG_TRANSFER);
        }
        if (!req.file) {
          cleanupRequest(req);
          return res.status(400).jsonp("No file found");
        }
        // O multer lê o nome do ficheiro como latin1; os browsers enviam-no em
        // UTF-8, o que estragava acentos ("Gravação" -> "GravaÃ§Ã£o")
        req.file.originalname = Buffer.from(req.file.originalname, "latin1").toString("utf8");
        next();
      },
    );
  };
}

/**
 * Valida um vídeo em disco e, se for válido, guarda-o no projeto (Passos 6 e 7).
 * @returns {{ ok: true, version } | { ok: false, reason }}
 */
async function processVideoFile(req, filePath, originalName, existingNames) {
  const { user, project } = req.params;
  const limits = req.videoLimits;
  const ext = extOf(originalName);

  if (!limits.extensions.includes(ext)) return { ok: false, reason: MSG_UNSUPPORTED };

  // O nome identifica o ficheiro no projeto (og_uri): nomes repetidos são renomeados
  const name = uniqueName(path.basename(originalName), existingNames);

  const size = fs.statSync(filePath).size;
  if (size > limits.maxFileSize) return { ok: false, reason: msgTooBig(limits) };

  const validation = await validateVideo(filePath, limits);
  if (!validation.ok) return validation;

  // A quota é verificada outra vez com o tamanho real (RN2)
  const used = await Project.getStorageUsed(user);
  if (used + size > limits.storageQuota) return { ok: false, reason: MSG_QUOTA };

  const sha = await sha256File(filePath);
  const resp = await post_file_stream(
    user,
    project,
    "src",
    filePath,
    ext.slice(1),
    MIME_TYPES[ext.slice(1)] || "application/octet-stream",
  );
  const key = resp.data.data.imageKey.split("/").pop();

  // Cancelado enquanto enviava para o S3: não adicionar ao projeto (FA3)
  if (req.cancelled) {
    await delete_image(user, project, "src", key).catch(() => {});
    return { ok: false, reason: MSG_TRANSFER };
  }

  const updated = await Project.addVideo(user, project, {
    og_uri: `./images/users/${user}/projects/${project}/src/${name}`,
    new_uri: `./images/users/${user}/projects/${project}/out/${name}`,
    og_img_key: key,
    og_sha256: sha,
    media_type: "video",
    size,
    ...validation.meta,
  });

  if (!updated) {
    await delete_image(user, project, "src", key).catch(() => {});
    return { ok: false, reason: "Project not found" };
  }

  existingNames.add(name);
  return { ok: true, version: updated.version };
}

// "video.mp4" -> "video (1).mp4" se já existir no projeto
function uniqueName(name, existingNames) {
  if (!existingNames.has(name)) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 1;
  while (existingNames.has(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}

async function existingNamesOf(user, project) {
  const doc = await Project.getOne(user, project);
  return new Set((doc?.imgs || []).map((i) => path.basename(i.og_uri)));
}

/**
 * Descompacta o .zip para `destDir`, entrada a entrada (sem carregar tudo em memória).
 * @returns {{ mixed: boolean, items: { name, path?, reason? }[] }}
 */
function extractZip(zipPath, destDir, limits) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      const items = [];
      let totalBytes = 0;

      zipfile.on("error", reject);
      zipfile.on("end", () => resolve({ mixed: false, items }));

      zipfile.on("entry", (entry) => {
        const name = path.basename(entry.fileName);
        const skip =
          entry.fileName.endsWith("/") ||
          entry.fileName.startsWith("__MACOSX/") ||
          name.startsWith(".");
        if (skip) return zipfile.readEntry();

        const ext = extOf(name);

        // Mistura de imagens e vídeos rejeita o lote todo (Exceção 7)
        if (IMAGE_EXTENSIONS.includes(ext)) {
          zipfile.close();
          return resolve({ mixed: true, items });
        }

        if (!limits.extensions.includes(ext)) {
          items.push({ name, reason: MSG_UNSUPPORTED });
          return zipfile.readEntry();
        }

        if (entry.uncompressedSize > limits.maxFileSize) {
          items.push({ name, reason: msgTooBig(limits) });
          return zipfile.readEntry();
        }

        // Proteção contra "zip bombs": o conteúdo descompactado não pode exceder a quota
        totalBytes += entry.uncompressedSize;
        if (totalBytes > limits.storageQuota) {
          items.push({ name, reason: msgZipTooBig(limits) });
          return zipfile.readEntry();
        }

        const out = path.join(destDir, `${uuidv4()}${ext}`);
        zipfile.openReadStream(entry, (err2, rs) => {
          if (err2) {
            items.push({ name, reason: MSG_CORRUPTED });
            return zipfile.readEntry();
          }
          const ws = fs.createWriteStream(out);
          rs.on("error", () => {
            ws.destroy();
            items.push({ name, reason: MSG_CORRUPTED });
            zipfile.readEntry();
          });
          ws.on("error", reject);
          ws.on("finish", () => {
            items.push({ name, path: out });
            zipfile.readEntry();
          });
          rs.pipe(ws);
        });
      });

      zipfile.readEntry();
    });
  });
}

// ================== ROTAS ==================

// Limites do perfil e espaço ocupado na quota (REQ-VID-UP-002, REQ-VID-UP-007, REQ-VID-UP-016)
router.get("/:user/storage", async (req, res) => {
  try {
    const userType = await getUserType(req.params.user);
    const limits = getVideoLimits(userType);
    const used = await Project.getStorageUsed(req.params.user);

    res.status(200).jsonp({
      type: userType,
      used,
      quota: limits.storageQuota,
      limits: {
        maxFileSize: limits.maxFileSize,
        maxDuration: limits.maxDuration,
        maxWidth: limits.maxWidth,
        maxHeight: limits.maxHeight,
        extensions: limits.extensions,
      },
    });
  } catch (e) {
    console.error("[VIDEO] Error getting storage:", e.message);
    res.status(500).jsonp("Error acquiring user's storage");
  }
});

// Heartbeat da sessão anónima (REQ-VID-UP-012)
router.post("/:user/heartbeat", async (req, res) => {
  try {
    await Project.touchEphemeral(req.params.user);
    res.sendStatus(204);
  } catch (_) {
    res.status(500).jsonp("Error updating session");
  }
});

/**
 * Criar projeto de vídeo, com validação preliminar (Passos 3 e 4, REQ-VID-UP-001/002/014/015/016).
 * @body { name, type: "video", files: [{ name, size }], zipEntries?: [String] }
 * Pedidos sem type "video" seguem para a criação normal de projetos.
 */
router.post("/:user", async (req, res, next) => {
  if (req.body?.type !== "video") return next();

  const name = String(req.body.name || "").trim();
  const files = Array.isArray(req.body.files) ? req.body.files : [];
  const zipEntries = Array.isArray(req.body.zipEntries) ? req.body.zipEntries : [];

  if (!name) return res.status(400).jsonp("O nome do projeto é obrigatório.");
  if (files.length === 0) return res.status(400).jsonp("Selecione pelo menos um vídeo.");

  const allNames = [...files.map((f) => f?.name), ...zipEntries];
  if (allNames.some((n) => IMAGE_EXTENSIONS.includes(extOf(n))))
    return res.status(400).jsonp(MSG_MIXED);

  try {
    const userType = await getUserType(req.params.user);
    const limits = getVideoLimits(userType);

    let total = 0;
    for (const f of files) {
      const ext = extOf(f?.name);
      const size = Number(f?.size) || 0;

      if (ext === ".zip") {
        if (size > limits.maxFileSize) return res.status(413).jsonp(msgZipTooBig(limits));
      } else {
        if (!limits.extensions.includes(ext))
          return res.status(400).jsonp(`${f?.name}: ${MSG_UNSUPPORTED}`);
        if (size > limits.maxFileSize)
          return res.status(413).jsonp(`${f?.name}: ${msgTooBig(limits)}`);
      }
      total += size;
    }

    const used = await Project.getStorageUsed(req.params.user);
    if (used + total > limits.storageQuota) return res.status(413).jsonp(MSG_QUOTA);

    const anonymous = userType === "anonymous";
    const project = await Project.create({
      name,
      user_id: req.params.user,
      type: "video",
      imgs: [],
      tools: [],
      ephemeral: anonymous,
      lastSeenAt: anonymous ? new Date() : null,
    });

    return res.status(201).jsonp(project);
  } catch (e) {
    console.error("[VIDEO] Error creating project:", e.message);
    return res.status(502).jsonp("Error creating new project");
  }
});

/**
 * Transferir um vídeo para um projeto de vídeo (Passos 5 a 7).
 * @file video
 * @returns { accepted: [name], rejected: [{ name, reason }] }
 */
router.post(
  "/:user/:project/video",
  checkSharePermission,
  requireEditPermission,
  loadVideoProject,
  receiveFile("video", (req) => req.videoLimits.maxFileSize, (req) => msgTooBig(req.videoLimits)),
  async (req, res) => {
    const name = path.basename(req.file.originalname);
    req.tmpPaths.forEach((p) => processingTmp.add(p));

    try {
      const existing = await existingNamesOf(req.params.user, req.params.project);
      const result = await processVideoFile(req, req.file.path, name, existing);
      if (req.cancelled) return;

      if (!result.ok)
        return res.status(422).jsonp({ accepted: [], rejected: [{ name, reason: result.reason }] });

      res.set("X-Project-Version", String(result.version));
      return res.status(201).jsonp({ accepted: [name], rejected: [] });
    } catch (e) {
      console.error("[VIDEO] Error storing video:", e.message);
      if (!req.cancelled) res.status(501).jsonp("Error storing video");
    } finally {
      cleanupRequest(req);
    }
  },
);

/**
 * Transferir um lote (.zip) de vídeos (FA2, RN4). Disponível para todos os perfis (Q1).
 * Cada vídeo é validado de forma independente; só a mistura com imagens rejeita tudo.
 * @file zip
 * @returns { accepted: [name], rejected: [{ name, reason }], projectDeleted? }
 */
router.post(
  "/:user/:project/video/zip",
  checkSharePermission,
  requireEditPermission,
  loadVideoProject,
  receiveFile("zip", (req) => req.videoLimits.maxFileSize, (req) => msgZipTooBig(req.videoLimits)),
  async (req, res) => {
    const zipName = path.basename(req.file.originalname);
    const extractDir = path.join(TMP_DIR, uuidv4());
    req.tmpPaths.push(extractDir);
    req.tmpPaths.forEach((p) => processingTmp.add(p));

    try {
      fs.mkdirSync(extractDir, { recursive: true });

      let extracted;
      try {
        extracted = await extractZip(req.file.path, extractDir, req.videoLimits);
      } catch (_) {
        return res.status(422).jsonp({
          accepted: [],
          rejected: [{ name: zipName, reason: MSG_ZIP_UNREADABLE }],
        });
      }

      if (extracted.mixed) {
        // Rejeita a criação na totalidade: se o projeto ainda está vazio, é apagado
        const project = await Project.getOne(req.params.user, req.params.project);
        const projectDeleted = !!project && project.imgs.length === 0;
        if (projectDeleted) await Project.delete(req.params.user, req.params.project);

        return res.status(400).jsonp({
          message: MSG_MIXED,
          accepted: [],
          rejected: [{ name: zipName, reason: MSG_MIXED }],
          projectDeleted,
        });
      }

      if (extracted.items.length === 0) {
        return res.status(422).jsonp({
          accepted: [],
          rejected: [{ name: zipName, reason: MSG_ZIP_EMPTY }],
        });
      }

      const existing = await existingNamesOf(req.params.user, req.params.project);
      const accepted = [];
      const rejected = [];
      let version;

      for (const item of extracted.items) {
        if (req.cancelled) return;

        if (item.reason) {
          rejected.push({ name: item.name, reason: item.reason });
          continue;
        }

        try {
          const result = await processVideoFile(req, item.path, item.name, existing);
          if (result.ok) {
            accepted.push(item.name);
            version = result.version;
          } else {
            rejected.push({ name: item.name, reason: result.reason });
          }
        } catch (e) {
          console.error("[VIDEO] Error storing video from zip:", e.message);
          rejected.push({ name: item.name, reason: "Error storing video" });
        } finally {
          removeTmp(item.path);
        }
      }

      if (req.cancelled) return;
      if (version !== undefined) res.set("X-Project-Version", String(version));
      return res.status(accepted.length > 0 ? 201 : 422).jsonp({ accepted, rejected });
    } catch (e) {
      console.error("[VIDEO] Error processing zip:", e.message);
      if (!req.cancelled) res.status(501).jsonp("Error storing video");
    } finally {
      cleanupRequest(req);
    }
  },
);

// ================== LIMPEZA PERIÓDICA ==================

// Temporários de transferências canceladas, falhadas ou interrompidas (REQ-VID-UP-011)
function sweepTmp() {
  fs.readdir(TMP_DIR, (err, names) => {
    if (err) return;
    const limit = Date.now() - TMP_MAX_AGE_MS;

    for (const n of names) {
      const full = path.join(TMP_DIR, n);
      if (processingTmp.has(full)) continue;

      fs.stat(full, (err2, st) => {
        if (!err2 && st.mtimeMs < limit) removeTmp(full);
      });
    }
  });
}

// Projetos de utilizadores anónimos cuja sessão terminou (REQ-VID-UP-012)
async function sweepAnonymous() {
  try {
    const expired = await Project.getExpiredEphemeral(
      new Date(Date.now() - ANON_MAX_IDLE_MS),
    );
    for (const p of expired) {
      await deleteProjectAndResources(p.user_id, p._id).catch((e) =>
        console.error("[VIDEO] Error deleting anonymous project:", e.message),
      );
    }
  } catch (e) {
    console.error("[VIDEO] Error sweeping anonymous projects:", e.message);
  }
}

function startVideoCleanup() {
  setInterval(sweepTmp, SWEEP_INTERVAL_MS);
  setInterval(sweepAnonymous, SWEEP_INTERVAL_MS);
}

module.exports = { router, startVideoCleanup };
