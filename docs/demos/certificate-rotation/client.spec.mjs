// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const clientPath = fileURLToPath(new URL("./client.mjs", import.meta.url));

async function runClient(t, config, fetchBody) {
  const directory = await mkdtemp(join(tmpdir(), "certificate-client-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "config.json");
  if (config !== undefined) {
    await writeFile(configPath, config);
  }
  const preload = `globalThis.fetch = async (url, options) => {
    if (url !== "http://127.0.0.1:43187/report" ||
        options.headers["x-demo-certificate-identity"] !== "test-identity") {
      throw new Error("Unexpected request");
    }
    ${fetchBody}
  };`;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      clientPath,
      configPath,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  return { ...result, configPath };
}

test("401 explains how to update the selected configuration without a fallback or retry", async (t) => {
  const result = await runClient(
    t,
    '{"certificateIdentity":"test-identity"}',
    `globalThis.fetch = () => { throw new Error("Must not retry"); };
     return new Response("Unauthorized", { status: 401 });`,
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr.trim(),
    `Authentication failed: HTTP 401. The service rejected the configured certificate identity.\nUpdate certificateIdentity in ${result.configPath} to the service's accepted identity (synthetic-certificate-replacement for this demo).\nThe original identity is retired; retrying it will not help. Do not restore it as a service fallback.`,
  );
  assert.ok(!result.stderr.includes("test-identity"));
});

test("successful requests still print the report", async (t) => {
  const result = await runClient(
    t,
    '{"certificateIdentity":"test-identity"}',
    'return new Response(\'{"status":"ok"}\');',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '{"status":"ok"}');
  assert.equal(result.stderr, "");
});

test("other HTTP failures retain their status without rotation guidance", async (t) => {
  const result = await runClient(
    t,
    '{"certificateIdentity":"test-identity"}',
    'return new Response("Unavailable", { status: 503 });',
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "Request failed: HTTP 503");
});

test("connection failures provide service startup guidance", async (t) => {
  const result = await runClient(
    t,
    '{"certificateIdentity":"test-identity"}',
    'throw new TypeError("fetch failed");',
  );
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    "Could not reach the report service at http://127.0.0.1:43187/report within 5 seconds.\nEnsure service.mjs is running and try again.",
  );
});

for (const config of [undefined, "{invalid"]) {
  test(`unreadable configuration provides file guidance (${config === undefined ? "missing" : "invalid JSON"})`, async (t) => {
    const result = await runClient(
      t,
      config,
      'throw new Error("Must not fetch");',
    );
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `Could not read configuration: ${result.configPath}\nEnsure the file exists and contains valid JSON.`,
    );
  });
}

for (const config of [
  "null",
  "{}",
  '{"certificateIdentity":42}',
  '{"certificateIdentity":"  "}',
]) {
  test(`invalid identity is rejected before requesting (${config})`, async (t) => {
    const result = await runClient(
      t,
      config,
      'throw new Error("Must not fetch");',
    );
    assert.equal(result.status, 1);
    assert.equal(
      result.stderr.trim(),
      `Invalid configuration: ${result.configPath}\nSet certificateIdentity to a nonempty string.`,
    );
  });
}
