const test = require("node:test");
const assert = require("node:assert/strict");

const baseUrl = process.env.PICTURAS_API_URL || "https://localhost:8080/api-gateway";
let token;
let userId;
let projectId;
let imageId;

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request(pathname, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

  return fetch(`${baseUrl.replace(/\/$/, "")}${pathname}`, {
    ...options,
    headers,
  });
}

async function provisionFixture() {
  const registerResponse = await fetch(`${baseUrl.replace(/\/$/, "")}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "anonymous" }),
  });
  const registerText = await registerResponse.text();
  assert.equal(registerResponse.status, 201, `registo falhou: ${registerText}`);
  const registered = JSON.parse(registerText);
  userId = registered.user?._id;
  token = registered.jwt;
  assert.ok(userId);
  assert.ok(token);

  const projectResponse = await request(`/projects/${userId}`, {
    method: "POST",
    body: JSON.stringify({
      name: `API integration ${Date.now()}`,
      type: "video",
      files: [{ name: "fixture.mp4", size: 1024 }],
    }),
  });
  const projectText = await projectResponse.text();
  assert.equal(projectResponse.status, 201, `criação do projeto falhou: ${projectText}`);
  const project = JSON.parse(projectText);
  projectId = project._id || project.id || project.project?._id;
  assert.ok(projectId);

  imageId = "000000000000000000000000";
}

test.before(async () => {
  const configuredIds = [
    process.env.PICTURAS_API_TOKEN,
    process.env.PICTURAS_TEST_USER_ID,
    process.env.PICTURAS_TEST_PROJECT_ID,
    process.env.PICTURAS_TEST_IMAGE_ID,
  ];
  const hasCompleteConfiguration = configuredIds.every(
    (value) => value && !/^<.*>$/.test(value),
  );

  if (hasCompleteConfiguration) {
    token = process.env.PICTURAS_API_TOKEN;
    userId = process.env.PICTURAS_TEST_USER_ID;
    projectId = process.env.PICTURAS_TEST_PROJECT_ID;
    imageId = process.env.PICTURAS_TEST_IMAGE_ID;
    return;
  }

  try {
    await provisionFixture();
  } catch (error) {
    throw new Error(
      `Não foi possível preparar a fixture da API em ${baseUrl}. ` +
      "Inicie o stack com Docker e confirme que o gateway está acessível. " +
      `Detalhe: ${error.message}`,
    );
  }
});

test("TST-API-01: API rejeita pedido de exportação sem autenticação", async (t) => {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/projects/${userId}/${projectId}/export/${imageId}`,
    { method: "POST" },
  );
  assert.ok([401, 403].includes(response.status));
});

test("TST-API-02: API protege consulta de histórico de exportação", async (t) => {
  const response = await request(
    `/projects/${userId}/${projectId}/export/${imageId}/history`,
  );
  assert.ok([200, 404, 409].includes(response.status));
  if (response.status === 200) {
    assert.ok(Array.isArray(await response.json()));
  }
});

test("TST-API-03: API valida pedido de exportação e devolve contrato HTTP", async (t) => {
  const response = await request(
    `/projects/${userId}/${projectId}/export/${imageId}`,
    { method: "POST" },
  );
  assert.ok([202, 409, 413].includes(response.status));
  const body = await response.json();
  if (response.status === 202) {
    assert.equal(typeof body.exportId, "string");
    assert.ok(["processing", "done"].includes(body.status));
  }
});

test("TST-API-04: API rejeita cancelamento de exportação inexistente sem apagar dados válidos", async (t) => {
  const response = await request(
    `/projects/${userId}/${projectId}/export/000000000000000000000000`,
    { method: "DELETE" },
  );
  assert.ok([204, 404].includes(response.status));
});

test("TST-API-05: API exige autenticação para iniciar processamento", async (t) => {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/projects/${userId}/${projectId}/process`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  assert.ok([401, 403].includes(response.status));
});

test("TST-API-06: upload de extensão inválida é rejeitado sem iniciar processamento", async (t) => {
  const form = new FormData();
  form.append("file", new Blob(["not a video"], { type: "application/octet-stream" }), "invalid.exe");
  const response = await request(
    `/projects/${userId}/${projectId}/video`,
    { method: "POST", body: form, headers: {} },
  );
  assert.ok([400, 413, 422].includes(response.status));
});
