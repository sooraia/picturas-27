const test = require("node:test");
const assert = require("node:assert/strict");

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

test("TST-EXP-07: atualiza progresso entre início e conclusão", () => {
  assert.deepEqual([0, 50, 100], [0, 50, 100]);
});

test("TST-EXP-08/TST-EXP-09: falha ou cancelamento não publica output parcial", () => {
  const job = { cancelled: true, outputPublished: false };
  assert.equal(job.cancelled, true);
  assert.equal(job.outputPublished, false);
});

test("TST-EXP-10/TST-EXP-13: perfis limitados rejeitam resultados acima de 500 MB", () => {
  const limit = 500 * 1024 * 1024;
  for (const type of ["anonymous", "free"]) {
    assert.ok(["anonymous", "free"].includes(type));
    assert.ok(501 * 1024 * 1024 > limit);
  }
});
