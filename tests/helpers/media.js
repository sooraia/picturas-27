const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function run(command, args) {
  return execFileAsync(command, args, { maxBuffer: 20 * 1024 * 1024 });
}

async function makeVideo(filePath, options = {}) {
  const {
    duration = 2,
    width = 320,
    height = 180,
    codec = "libx264",
    fps = 10,
  } = options;

  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `testsrc=size=${width}x${height}:rate=${fps}`,
    "-t", String(duration),
    "-c:v", codec,
    "-pix_fmt", "yuv420p",
    "-an",
    filePath,
  ]);
}

async function probe(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  return JSON.parse(stdout);
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "picturas-tests-"));
}

function sha256(filePath) {
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

module.exports = { makeVideo, probe, run, sha256, temporaryDirectory };
