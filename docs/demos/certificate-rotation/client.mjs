// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(
    process.argv[2] ?? new URL("./local-config.json", import.meta.url),
    "utf8",
  ),
);
const response = await fetch("http://127.0.0.1:43187/report", {
  headers: { "x-demo-certificate-identity": config.certificateIdentity },
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) {
  console.error(`Request failed: HTTP ${response.status}`);
  process.exitCode = 1;
} else {
  console.log(await response.text());
}
