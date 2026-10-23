const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getVideoLimits,
} = require("../../../projects/utils/videoLimits");
const {
  validateVideo,
  MSG_CORRUPTED,
  MSG_UNSUPPORTED,
} = require("../../../projects/utils/videoValidation");
const { makeVideo, temporaryDirectory } = require("../../helpers/media");

test("TST-UP-05/TST-UP-17: ffprobe rejeita codec não suportado e ficheiro truncado", async (t) => {
  const dir = temporaryDirectory();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const limits = getVideoLimits("free");

  const unsupported = path.join(dir, "unsupported.mp4");
  await makeVideo(unsupported, { codec: "mpeg4" });
  assert.deepEqual(await validateVideo(unsupported, limits), {
    ok: false,
    reason: MSG_UNSUPPORTED,
  });

  const truncated = path.join(dir, "truncated.mp4");
  fs.writeFileSync(truncated, "truncated");
  assert.deepEqual(await validateVideo(truncated, limits), {
    ok: false,
    reason: MSG_CORRUPTED,
  });
});
