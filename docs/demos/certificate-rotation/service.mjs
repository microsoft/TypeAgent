// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function createAuthenticationService() {
  const config = JSON.parse(
    await readFile(new URL("./service-config.json", import.meta.url), "utf8"),
  );
  if (
    typeof config.acceptedCertificateIdentity !== "string" ||
    !config.acceptedCertificateIdentity
  ) {
    throw new Error(
      "Missing acceptedCertificateIdentity in service-config.json",
    );
  }
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/report") {
      response.writeHead(404).end("Not found\n");
    } else if (
      request.headers["x-demo-certificate-identity"] !==
      config.acceptedCertificateIdentity
    ) {
      response.writeHead(401).end("Unauthorized\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"report":"Synthetic localhost report","status":"ok"}\n');
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await createAuthenticationService();
  server.listen(43187, "127.0.0.1", () => {
    console.log(
      "Synthetic certificate demo listening at http://127.0.0.1:43187",
    );
  });
}
