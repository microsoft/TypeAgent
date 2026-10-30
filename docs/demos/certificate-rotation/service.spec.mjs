// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createAuthenticationService } from "./service.mjs";

test("localhost service accepts only the configured certificate identity", async (t) => {
  const { acceptedCertificateIdentity } = JSON.parse(
    await readFile(new URL("./service-config.json", import.meta.url), "utf8"),
  );
  const server = await createAuthenticationService();
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/report`;
  const accepted = await fetch(url, {
    headers: { "x-demo-certificate-identity": acceptedCertificateIdentity },
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, "ok");
  for (const identity of [
    "synthetic-certificate-original",
    "synthetic-certificate-unknown",
    "",
  ]) {
    const rejected = await fetch(url, {
      headers: { "x-demo-certificate-identity": identity },
    });
    assert.equal(rejected.status, 401);
    assert.equal(await rejected.text(), "Unauthorized\n");
  }
});
