const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { getVideoLimits, formatBytes } = require("../../../projects/utils/videoLimits");

test("TST-UP-02/TST-UP-18/TST-UP-19: limites e restrições dependem do perfil", () => {
  const free = getVideoLimits("free");
  assert.equal(free.maxFileSize, 500 * 1024 * 1024);
  assert.equal(free.maxWidth, 1920);
  assert.equal(free.maxHeight, 1080);
  assert.equal(free.maxDuration, 600);
  assert.match(formatBytes(free.maxFileSize), /500/);
});

test("TST-UP-06/TST-UP-07/TST-UP-15/TST-UP-20: quotas aceitam ou rejeitam o tamanho disponível", () => {
  const quota = getVideoLimits("free").storageQuota;
  assert.equal(quota - 300 * 1024 * 1024, 1748 * 1024 * 1024);
  assert.ok(300 * 1024 * 1024 <= quota);
  assert.ok(2100 * 1024 * 1024 > quota);
  assert.equal(getVideoLimits("anonymous").storageQuota, 200 * 1024 * 1024);
  assert.equal(getVideoLimits("premium").storageQuota, 10 * 1024 * 1024 * 1024);
});

test("TST-UP-12/TST-UP-13/TST-UP-14: classifica médias e rejeita extensões não suportadas", () => {
  const limits = getVideoLimits("free");
  const isVideo = (name) => limits.extensions.includes(path.extname(name).toLowerCase());
  const isImage = (name) => [".png", ".jpg", ".jpeg"].includes(path.extname(name).toLowerCase());
  const classify = (names) => {
    const video = names.some(isVideo);
    const image = names.some(isImage);
    return video && image ? "mixed" : video ? "video" : image ? "image" : "empty";
  };

  assert.equal(classify(["clip.mp4", "photo.jpg"]), "mixed");
  assert.equal(classify(["clip.mp4", "clip.mkv"]), "video");
  assert.equal(isVideo("clip.exe"), false);
  assert.equal(isImage("clip.gif"), false);
});
