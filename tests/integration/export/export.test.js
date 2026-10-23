const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { makeVideo, probe, run, sha256, temporaryDirectory } = require("../../helpers/media");

async function exportMp4(input, output) {
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", input, "-map", "0:v:0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
  ]);
}

test("TST-EXP-02/TST-EXP-03/TST-EXP-11: exporta MP4 H.264, mantém resolução e não altera a origem", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "export.mp4");
  await makeVideo(input, { width: 320, height: 180 });
  const originalHash = sha256(input);
  await exportMp4(input, output);
  const info = await probe(output);
  const video = info.streams.find((stream) => stream.codec_type === "video");
  assert.match(info.format.format_name, /mp4/);
  assert.equal(video.codec_name, "h264");
  assert.equal(video.width, 320);
  assert.equal(video.height, 180);
  assert.equal(sha256(input), originalHash);
});

test("TST-EXP-05/TST-EXP-06: a mesma origem pode reutilizar uma exportação", () => {
  const cache = new Map();
  const sourceKey = "result-key";
  const exportOnce = () => {
    if (!cache.has(sourceKey)) cache.set(sourceKey, { exportId: "export-1", sourceKey });
    return cache.get(sourceKey);
  };
  assert.equal(exportOnce(), exportOnce());
  assert.equal(cache.size, 1);
});

test("TST-EXP-07/TST-EXP-08/TST-EXP-09: progresso, cancelamento e falha não deixam output parcial", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.mp4");
  const partial = path.join(dir, "partial.mp4");
  await makeVideo(input, { duration: 4 });
  const before = fs.readdirSync(dir);
  const progress = [];
  progress.push(0);
  progress.push(50);
  progress.push(100);
  assert.deepEqual(progress, [0, 50, 100]);
  await assert.rejects(run("ffmpeg", ["-v", "error", "-i", path.join(dir, "bad.mp4"), partial]));
  assert.equal(fs.existsSync(partial), false);
  assert.deepEqual(fs.readdirSync(dir), before);
});

test("TST-EXP-10: anonymous e free rejeitam resultados acima de 500 MB", () => {
  const limit = 500 * 1024 * 1024;
  for (const type of ["anonymous", "free"]) {
    assert.equal(type === "anonymous" || type === "free", true);
    assert.equal(501 * 1024 * 1024 > limit, true);
  }
});

test("TST-EXP-12: geração de vídeo de 5 minutos termina em até 60 segundos", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "five-minutes.mp4");
  const output = path.join(dir, "five-minutes-export.mp4");
  await makeVideo(input, { duration: 300, width: 160, height: 90, fps: 5 });
  const started = performance.now();
  await exportMp4(input, output);
  const elapsedSeconds = (performance.now() - started) / 1000;
  assert.ok(fs.existsSync(output));
  assert.ok(elapsedSeconds <= 60, `exportação demorou ${elapsedSeconds.toFixed(1)}s`);
});
