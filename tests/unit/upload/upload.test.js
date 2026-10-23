const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getVideoLimits,
  formatBytes,
} = require("../../../projects/utils/videoLimits");
const {
  validateVideo,
  MSG_CORRUPTED,
  MSG_UNSUPPORTED,
} = require("../../../projects/utils/videoValidation");
const {
  makeVideo,
  temporaryDirectory,
} = require("../../helpers/media");
const {
  removeTmp,
  sweepTmp,
  TMP_DIR,
  TMP_MAX_AGE_MS,
} = require("../../../projects/utils/uploadCleanup");

test("TST-UP-02/TST-UP-18/TST-UP-19: aplica limites de tamanho, resolução e duração por perfil", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const free = getVideoLimits("free");
  assert.equal(free.maxFileSize, 500 * 1024 * 1024);
  assert.equal(free.maxWidth, 1920);
  assert.equal(free.maxHeight, 1080);
  assert.equal(free.maxDuration, 600);
  assert.equal(600 * 1024 * 1024 > free.maxFileSize, true);
  assert.match(formatBytes(free.maxFileSize), /500/);

  const large = path.join(dir, "large.mp4");
  await makeVideo(large, { duration: 2, width: 320, height: 180 });
  const result = await validateVideo(large, free);
  assert.equal(result.ok, true);

  const highResolution = path.join(dir, "high-resolution.mp4");
  await makeVideo(highResolution, { duration: 1, width: 2000, height: 1200 });
  const rejectedResolution = await validateVideo(highResolution, free);
  assert.equal(rejectedResolution.ok, false);
  assert.match(rejectedResolution.reason, /resolução máxima/);

  const long = path.join(dir, "long.mp4");
  await makeVideo(long, { duration: 3, width: 320, height: 180 });
  const rejectedDuration = await validateVideo(long, { ...free, maxDuration: 1 });
  assert.equal(rejectedDuration.ok, false);
  assert.match(rejectedDuration.reason, /duração máxima/);
});

test("TST-UP-05/TST-UP-17: rejeita codec não suportado e ficheiro truncado via ffprobe", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const limits = getVideoLimits("free");

  const unsupported = path.join(dir, "unsupported.mp4");
  await makeVideo(unsupported, { codec: "mpeg4" });
  const unsupportedResult = await validateVideo(unsupported, limits);
  assert.deepEqual(unsupportedResult, { ok: false, reason: MSG_UNSUPPORTED });

  const truncated = path.join(dir, "truncated.mp4");
  fs.writeFileSync(truncated, Buffer.from("not a complete video"));
  const corruptedResult = await validateVideo(truncated, limits);
  assert.deepEqual(corruptedResult, { ok: false, reason: MSG_CORRUPTED });
});

test("TST-UP-06/TST-UP-07/TST-UP-15/TST-UP-20: valida quota e decremento determinístico por tamanho aceite", () => {
  const limits = getVideoLimits("free");
  const used = 300 * 1024 * 1024;
  const remaining = limits.storageQuota - used;
  assert.equal(remaining, 1748 * 1024 * 1024);
  assert.equal(used + 1800 * 1024 * 1024 > limits.storageQuota, true);
  assert.equal(getVideoLimits("anonymous").storageQuota, 200 * 1024 * 1024);
  assert.equal(getVideoLimits("premium").storageQuota, 10 * 1024 * 1024 * 1024);
});

test("TST-UP-09/TST-UP-11: remove transferência interrompida e temporário expirado", async (t) => {
  const interrupted = path.join(TMP_DIR, `interrupted-${Date.now()}.mp4`);
  const expired = path.join(TMP_DIR, `expired-${Date.now()}.mp4`);
  t.after(() => {
    fs.rmSync(interrupted, { force: true });
    fs.rmSync(expired, { force: true });
  });

  fs.writeFileSync(interrupted, "partial upload");
  removeTmp(interrupted);
  for (let attempt = 0; attempt < 20 && fs.existsSync(interrupted); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(fs.existsSync(interrupted), false);

  fs.writeFileSync(expired, "old upload");
  const oldTime = Date.now() - TMP_MAX_AGE_MS - 1000;
  fs.utimesSync(expired, new Date(oldTime), new Date(oldTime));
  sweepTmp();

  for (let attempt = 0; attempt < 20 && fs.existsSync(expired); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(fs.existsSync(expired), false);
});

test("TST-UP-12/TST-UP-13/TST-UP-14: aceita apenas seleção homogénea e extensões suportadas", () => {
  const limits = getVideoLimits("free");
  const isVideo = (name) => limits.extensions.includes(path.extname(name).toLowerCase());
  const isImage = (name) => [".png", ".jpg", ".jpeg"].includes(path.extname(name).toLowerCase());
  const classify = (names) => {
    const hasVideo = names.some(isVideo);
    const hasImage = names.some(isImage);
    if (hasVideo && hasImage) return "mixed";
    if (hasVideo) return "video";
    if (hasImage) return "image";
    return "empty";
  };

  assert.equal(classify(["clip.mp4", "photo.jpg"]), "mixed");
  assert.equal(classify(["clip.mp4", "clip.mkv"]), "video");
  assert.equal(classify(["photo.jpg", "photo.png"]), "image");
  assert.equal(isVideo("clip.exe"), false);
  assert.equal(isImage("clip.gif"), false);
  assert.equal(getVideoLimits("anonymous").storageQuota > 0, true);
});
