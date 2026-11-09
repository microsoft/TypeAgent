// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

describe("agentRpc browser safety", () => {
    const packageRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
    );

    function readSource(path: string): string {
        return readFileSync(resolve(packageRoot, path), "utf8");
    }

    it("uses only browser-safe telemetry subpaths", () => {
        const source = readSource("src/rpc.ts");
        const imports = Array.from(
            source.matchAll(/from\s+["']([^"']+)["']/g),
            (match) => match[1]!,
        ).filter((specifier) => specifier.startsWith("@typeagent/telemetry"));

        expect(imports).toEqual(["@typeagent/telemetry/errorClassification"]);
    });

    it.each(["src/rpc.ts", "src/common.ts"])(
        "%s imports no Node builtins",
        (path) => {
            const source = readSource(path);
            expect(source).not.toMatch(/from\s+["']node:/);
            expect(source).not.toMatch(/from\s+["'](crypto|fs|path|os)["']/);
        },
    );
});
