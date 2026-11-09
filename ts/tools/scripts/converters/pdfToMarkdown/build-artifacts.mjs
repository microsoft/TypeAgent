// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const parent = new URL(
    "../../../../packages/agents/browserControlRpc/",
    import.meta.url,
);
const source = new URL("src/converters/pdfToMarkdown/", parent);
const output = new URL("dist/converters/pdfToMarkdown/", parent);
const require = createRequire(new URL("package.json", parent));
await mkdir(output, { recursive: true });
for (const name of [
    "index.d.ts",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "source-manifest.json",
]) {
    await cp(new URL(name, source), new URL(name, output));
}
await cp(
    path.join(
        path.dirname(require.resolve("pdfjs-dist/package.json")),
        "LICENSE",
    ),
    new URL("PDFJS-LICENSE", output),
);
