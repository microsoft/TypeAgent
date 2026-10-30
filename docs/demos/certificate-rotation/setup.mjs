// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { writeFile } from "node:fs/promises";

await writeFile(
  new URL("./local-config.json", import.meta.url),
  JSON.stringify(
    { certificateIdentity: "synthetic-certificate-original" },
    null,
    2,
  ) + "\n",
);
console.log(
  "Created demo local-config.json with the original synthetic certificate identity.",
);
