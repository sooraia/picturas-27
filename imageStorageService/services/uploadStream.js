const s3 = require("./s3Client");
const createBucket = require("./createBucket");
const { v4: uuidv4 } = require("uuid");

// Envia um ficheiro para o S3 a partir de um stream (sem o carregar em memória),
// usado para os vídeos, que podem ter vários GB.
async function uploadStream(userId, projectId, stage, stream, ext, contentType) {
  const bucketName = `user-${userId}`;
  await createBucket(bucketName);

  const imageKey = `${projectId}/${stage}/${uuidv4()}.${ext}`;
  const params = {
    Bucket: bucketName,
    Key: imageKey,
    Body: stream,
    ContentType: contentType,
  };

  try {
    const data = await s3.upload(params).promise();
    return { imageKey, location: data.Location };
  } catch (error) {
    console.error("Erro ao enviar ficheiro:", error.message);
    throw error;
  }
}

module.exports = uploadStream;
