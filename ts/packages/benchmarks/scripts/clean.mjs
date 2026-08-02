// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Drop emit + incremental state so the next `tsc -b` fully rebuilds.
rmSync(path.join(root, "dist"), { recursive: true, force: true });
rmSync(path.join(root, "tsconfig.tsbuildinfo"), { force: true });
