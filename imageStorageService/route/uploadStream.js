const express = require("express");
const uploadStream = require("../services/uploadStream");
const allowedStages = require("../utils/stages");

const router = express.Router();

/**
 * POST /upload-stream/:userId/:projectId/:stage?ext=mp4
 * O corpo do pedido é o próprio ficheiro (não multipart).
 */
router.post("/:userId/:projectId/:stage", async (req, res) => {
  const { userId, projectId, stage } = req.params;
  const ext = String(req.query.ext || "").replace(/[^a-z0-9]/gi, "").toLowerCase();

  if (!allowedStages.includes(stage)) {
    return res.status(400).json({
      error: "O estágio deve ser src, preview, preview_cache, out ou export.",
    });
  }

  if (!ext) {
    return res.status(400).json({ error: "Extensão em falta." });
  }

  try {
    const contentType = req.headers["content-type"] || "application/octet-stream";
    const result = await uploadStream(userId, projectId, stage, req, ext, contentType);
    res.status(201).json({ message: "Ficheiro enviado com sucesso!", data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
