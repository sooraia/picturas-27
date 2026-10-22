const mongoose = require("mongoose");

// Ficheiro exportado de um vídeo processado (UC-VID-002). Fica guardado para
// ser reutilizado enquanto o resultado do processamento não mudar (RN4).
const historySchema = new mongoose.Schema(
  {
    exportedAt: { type: Date, required: true },
    exported_by: { type: String, default: null },
  },
  { _id: false }
);

const videoExportSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // dono do projeto
    project_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    img_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    // img_key do resultado de onde foi gerado: muda sempre que o vídeo é reprocessado
    source_key: { type: String, required: true },
    status: { type: String, enum: ["processing", "done"], default: "processing" },
    file_key: { type: String, default: null },
    file_name: { type: String, required: true },
    size: { type: Number, default: 0 },
    // descargas concluídas, com data e hora (REQ-VID-EXPORT-005)
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("videoExport", videoExportSchema);
