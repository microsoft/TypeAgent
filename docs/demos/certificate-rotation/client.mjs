// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = resolve(
  process.argv[2] ??
    fileURLToPath(new URL("./local-config.json", import.meta.url)),
);
try {
  await requestReport();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Request failed.");
  process.exitCode = 1;
}

async function requestReport() {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    throw new Error(
      `Could not read configuration: ${configPath}\nEnsure the file exists and contains valid JSON.`,
    );
  }
  if (
    typeof config?.certificateIdentity !== "string" ||
    !config.certificateIdentity.trim()
  ) {
    throw new Error(
      `Invalid configuration: ${configPath}\nSet certificateIdentity to a nonempty string.`,
    );
  }

  let response;
  try {
    response = await fetch("http://127.0.0.1:43187/report", {
      headers: { "x-demo-certificate-identity": config.certificateIdentity },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error(
      "Could not reach the report service at http://127.0.0.1:43187/report within 5 seconds.\nEnsure service.mjs is running and try again.",
    );
  }
  if (response.status === 401) {
    throw new Error(
      `Authentication failed: HTTP 401. The service rejected the configured certificate identity.\nUpdate certificateIdentity in ${configPath} to the service's accepted identity (synthetic-certificate-replacement for this demo).\nThe original identity is retired; retrying it will not help. Do not restore it as a service fallback.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Request failed: HTTP ${response.status}`);
  }
  console.log(await response.text());
}
