const express = require("express");
const uploadRoutes = require("./route/upload");
const imageRoutes = require("./route/images");
const deleteRoutes = require("./route/delete");
const copyRoutes = require("./route/copy"); 
const uploadStreamRoutes = require("./route/uploadStream");

const app = express();

app.use("/upload", uploadRoutes);
app.use("/image", imageRoutes);
app.use("/delete", deleteRoutes);
app.use("/copy", copyRoutes); 
app.use("/upload-stream", uploadStreamRoutes);

const PORT = process.env.PORT || 11000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
