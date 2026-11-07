// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const semver = require("semver");
const yaml = require("js-yaml");
const tsRoot = fileURLToPath(new URL("../../../", import.meta.url));
const lock = yaml.load(
    readFileSync(path.join(tsRoot, "pnpm-lock.yaml"), "utf8"),
);
const packageDirectory = fileURLToPath(
    new URL("../../../packages/commandExecutor/", import.meta.url),
);
const packageRequire = createRequire(
    path.join(packageDirectory, "package.json"),
);
const sdkImports = [
    "@modelcontextprotocol/sdk/client/index.js",
    "@modelcontextprotocol/sdk/client/stdio.js",
    "@modelcontextprotocol/sdk/client/sse.js",
    "@modelcontextprotocol/sdk/client/streamableHttp.js",
    "@modelcontextprotocol/sdk/server/index.js",
    "@modelcontextprotocol/sdk/server/mcp.js",
    "@modelcontextprotocol/sdk/server/stdio.js",
    "@modelcontextprotocol/sdk/server/streamableHttp.js",
    "@modelcontextprotocol/sdk/types.js",
];

test("lockfile excludes versions affected by the remaining S360 dependency alerts", () => {
    for (const [name, vulnerableRange] of Object.entries({
        "@modelcontextprotocol/sdk": "<1.32.0",
        "@vue/server-renderer": "<3.5.42 || >=3.6.0-rc.0 <3.6.0-rc.6",
        electron:
            "<41.10.6 || >=42.0.0-alpha.1 <42.9.2 || >=43.0.0-alpha.1 <43.4.1 || >=44.0.0-alpha.1 <44.0.0-beta.5",
        "prosemirror-view": "<1.42.3",
    })) {
        const prefix = `${name}@`;
        const versions = Object.keys(lock.packages)
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length));
        assert.ok(versions.length > 0, `${name} is present in the lockfile`);
        for (const version of versions) {
            assert.ok(semver.valid(version), `${name}@${version} is valid`);
            assert.ok(
                !semver.satisfies(version, vulnerableRange, {
                    includePrerelease: true,
                }),
                `${name}@${version} must not match ${vulnerableRange}`,
            );
        }
    }
});

test("standalone MCP consumers declare a patched SDK minimum", () => {
    let checked = 0;
    for (const importer of Object.keys(lock.importers)) {
        const pkg = JSON.parse(
            readFileSync(path.join(tsRoot, importer, "package.json"), "utf8"),
        );
        for (const section of ["dependencies", "devDependencies"]) {
            const range = pkg[section]?.["@modelcontextprotocol/sdk"];
            if (!range) {
                continue;
            }
            const minimum = semver.minVersion(range);
            assert.ok(minimum, `${importer}: valid SDK range`);
            assert.ok(
                semver.gte(minimum, "1.32.0"),
                `${importer}: ${range} must require SDK 1.32.0 or later`,
            );
            checked++;
        }
    }
    assert.ok(checked > 0);
});

test("MCP SDK .js imports resolve to declarations under Node16", () => {
    const ts = packageRequire("typescript");
    for (const specifier of sdkImports) {
        const { resolvedModule } = ts.resolveModuleName(
            specifier,
            path.join(packageDirectory, "src", "index.ts"),
            {
                module: ts.ModuleKind.Node16,
                moduleResolution: ts.ModuleResolutionKind.Node16,
            },
            ts.sys,
            undefined,
            undefined,
            ts.ModuleKind.ESNext,
        );
        assert.ok(
            resolvedModule?.resolvedFileName.endsWith(".d.ts"),
            `${specifier} must resolve to a declaration file`,
        );
    }
});

test("MCP SDK .js imports load through the ESM export map", () => {
    const result = spawnSync(
        process.execPath,
        [
            "--input-type=module",
            "--eval",
            `await Promise.all(${JSON.stringify(sdkImports)}.map((specifier) => import(specifier)));`,
        ],
        {
            cwd: packageDirectory,
            encoding: "utf8",
            timeout: 30_000,
        },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
});
