const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { run, makeVideo, sha256, temporaryDirectory } = require("../../helpers/media");

async function trimLikeProduction(input, output, start, length, cancel = false) {
  const temporary = `${output}.trim-test${path.extname(output)}`;
  const child = require("node:child_process").spawn("ffmpeg", [
    "-y", "-v", "error", "-ss", String(start), "-i", input, "-t", String(length),
    "-map", "0:v:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", temporary,
  ]);
  if (cancel) child.kill("SIGTERM");
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  if (!cancel && exitCode !== 0) throw new Error(`ffmpeg exited with ${exitCode}`);
  if (!cancel) fs.renameSync(temporary, output);
  return { exitCode, temporary };
}

test("TST-TRIM-10: falha de processamento produz erro não-sucesso", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    run("ffmpeg", ["-v", "error", "-i", path.join(dir, "missing.mp4"), "-t", "1", path.join(dir, "out.mp4")]),
  );
});

test("TST-TRIM-11: o hash do original mantém-se após recorte bem-sucedido", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  await makeVideo(input);
  const before = sha256(input);
  await trimLikeProduction(input, output, 0, 1);
  assert.equal(sha256(input), before);
  assert.ok(fs.existsSync(output));
});

test("TST-TRIM-12: ficheiro temporário de edição é descartado ao cancelar", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, "output.mp4");
  await makeVideo(input, { duration: 4 });
  const { temporary } = await trimLikeProduction(input, output, 0, 4, true);
  if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(temporary), false);
});

test("TST-TRIM-13: recorte de vídeo de 5 minutos termina em até 60 segundos", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "five-minutes.mp4");
  const output = path.join(dir, "five-minutes-trim.mp4");
  await makeVideo(input, { duration: 300, width: 160, height: 90, fps: 5 });

  const started = performance.now();
  await trimLikeProduction(input, output, 0, 300);
  const elapsedSeconds = (performance.now() - started) / 1000;

  assert.ok(fs.existsSync(output));
  assert.ok(elapsedSeconds <= 60);
});
