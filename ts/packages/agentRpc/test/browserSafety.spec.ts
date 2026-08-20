// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

/**
 * The `agentRpc` package ships to browser bundles (browser extension,
 * webview, content scripts). Its core `rpc.ts` therefore must not reach into
 * the Node-only `@typeagent/telemetry` root - only the browser-safe subpaths
 * (`/traceContext`, `/errorClassification`) are permitted. This test locks
 * that boundary in at the source level; a regression would either force a
 * Node-only dep into a browser bundle or crash bundling with an unresolvable
 * `node:*` import.
 */
describe("agentRpc browser-safety", () => {
    const here = dirname(fileURLToPath(import.meta.url));

    function readSource(relativeFromPackageRoot: string): string {
        // Tests run from `dist/test/`, so climb back to the package root.
        const packageRoot = resolve(here, "..", "..");
        return readFileSync(resolve(packageRoot, relativeFromPackageRoot), {
            encoding: "utf8",
        });
    }

    const BROWSER_SAFE_SUBPATHS = new Set([
        "@typeagent/telemetry/traceContext",
        "@typeagent/telemetry/errorClassification",
    ]);

    function extractTelemetryImports(source: string): string[] {
        const imports: string[] = [];
        // Match ES-module import specifiers regardless of default vs
        // named vs type-only import shape.
        const re = /from\s+["']([^"']+)["']/g;
        let match: RegExpExecArray | null;
        while ((match = re.exec(source)) !== null) {
            if (match[1].startsWith("@typeagent/telemetry")) {
                imports.push(match[1]);
            }
        }
        return imports;
    }

    it("rpc.ts imports only browser-safe telemetry subpaths", () => {
        const source = readSource("src/rpc.ts");
        const telemetryImports = extractTelemetryImports(source);
        expect(telemetryImports.length).toBeGreaterThan(0);
        for (const specifier of telemetryImports) {
            expect(BROWSER_SAFE_SUBPATHS.has(specifier)).toBe(true);
        }
    });

    it("common.ts and rpc.ts import no Node builtins", () => {
        for (const path of ["src/rpc.ts", "src/common.ts"]) {
            const source = readSource(path);
            // `node:` protocol is unambiguously Node-only; a browser bundler
            // has no shim for `node:crypto`, `node:buffer`, etc.
            expect(source).not.toMatch(/from\s+["']node:/);
            // Bare Node builtins that agentRpc historically avoids in the
            // browser-safe files.
            expect(source).not.toMatch(/from\s+["'](crypto|fs|path|os)["']/);
        }
    });
});
