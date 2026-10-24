// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
    nativeInstallEnvironment,
    parseRegistry,
} from "../lib/installEnvironment.mjs";

const registry =
    "https://pkgs.dev.azure.com/example/project/_packaging/packages/npm/registry/";
const feed =
    "https://pkgs.dev.azure.com/example/project/_packaging/packages/nuget/v3/index.json";

test("registry parsing ignores scoped registries, comments and credentials", () => {
    assert.equal(
        parseRegistry(
            `# registry=ignored\n@scope:registry=https://other.example/\n registry = ${registry}\n//host/:_authToken=secret`,
        ),
        registry,
    );
    assert.equal(parseRegistry("# no registry"), undefined);
});

test("ADO setup derives a NuGet endpoint without changing the caller environment", () => {
    const env = { EXISTING: "preserved" };
    assert.deepEqual(nativeInstallEnvironment(`registry=${registry}`, env), {
        ...env,
        FOUNDRY_LOCAL_NUGET_FEEDS: feed,
        FOUNDRY_LOCAL_NUGET_MODE: "dotnet",
    });
    assert.deepEqual(env, { EXISTING: "preserved" });
});

test("explicit native feed and mode overrides are preserved", () => {
    const env = {
        FOUNDRY_LOCAL_NUGET_FEEDS: "https://custom.example/index.json",
        FOUNDRY_LOCAL_NUGET_MODE: "nuget",
    };
    assert.deepEqual(nativeInstallEnvironment("registry=invalid", env), env);
    assert.equal(
        nativeInstallEnvironment(`registry=${registry}`, {
            FOUNDRY_LOCAL_NUGET_MODE: "http",
        }).FOUNDRY_LOCAL_NUGET_MODE,
        "http",
    );
});

test("public registries and missing registry leave installer defaults alone", () => {
    for (const npmrc of ["", "registry=https://registry.npmjs.org/"])
        assert.deepEqual(nativeInstallEnvironment(npmrc, {}), {});
});

test("org-scoped, legacy and slashless Azure feed endpoints are supported", () => {
    for (const base of [
        "https://pkgs.dev.azure.com/example/_packaging/packages",
        "https://example.pkgs.visualstudio.com/_packaging/packages",
    ])
        for (const suffix of ["/npm/registry/", "/npm/registry", "/npm/"])
            assert.equal(
                nativeInstallEnvironment(`registry=${base}${suffix}`, {})
                    .FOUNDRY_LOCAL_NUGET_FEEDS,
                `${base}/nuget/v3/index.json`,
            );
});

test("npm registry overrides and interpolation follow the install environment", () => {
    for (const key of ["npm_config_registry", "NPM_CONFIG_REGISTRY"])
        assert.equal(
            nativeInstallEnvironment("registry=https://registry.npmjs.org/", {
                [key]: registry,
            }).FOUNDRY_LOCAL_NUGET_FEEDS,
            feed,
        );
    assert.equal(
        nativeInstallEnvironment("registry=${PACKAGE_REGISTRY}", {
            PACKAGE_REGISTRY: registry,
        }).FOUNDRY_LOCAL_NUGET_FEEDS,
        feed,
    );
    assert.throws(
        () => nativeInstallEnvironment("registry=${MISSING}", {}),
        /unset environment variable/,
    );
});

test("malformed or credential-bearing Azure registry settings fail explicitly", () => {
    for (const value of [
        "invalid",
        registry.replace("https:", "http:"),
        registry.replace("https://", "https://user:secret@"),
        `${registry}?secret=value`,
        `${registry}#fragment`,
        registry.replace("/npm/registry/", "/unknown/"),
    ])
        assert.throws(() => nativeInstallEnvironment(`registry=${value}`, {}));
});

test("fresh setup passes native feed settings to install before runtime YAML is loaded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-install-env-"));
    try {
        const scripts = path.join(root, "tools", "scripts");
        const bin = path.join(root, "bin");
        fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
        fs.mkdirSync(bin);
        for (const file of ["setupWorktree.mjs", "lib/installEnvironment.mjs"])
            fs.copyFileSync(
                fileURLToPath(new URL(`../${file}`, import.meta.url)),
                path.join(scripts, file),
            );
        fs.writeFileSync(path.join(root, ".npmrc"), `registry=${registry}`);
        fs.writeFileSync(path.join(root, "config.local.yaml"), "not: [valid");
        const capture = path.join(root, "install-env.json");
        const stub = path.join(bin, "pnpm-stub.cjs");
        fs.writeFileSync(
            stub,
            `require("node:fs").writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), feed: process.env.FOUNDRY_LOCAL_NUGET_FEEDS, mode: process.env.FOUNDRY_LOCAL_NUGET_MODE }));`,
        );
        const windows = process.platform === "win32";
        fs.writeFileSync(
            path.join(bin, windows ? "pnpm.cmd" : "pnpm"),
            windows
                ? `@"${process.execPath}" "${stub}" %*\r\n`
                : `#!/bin/sh\nexec "${process.execPath}" "${stub}" "$@"\n`,
            { mode: 0o755 },
        );
        const env = { ...process.env };
        for (const key of Object.keys(env))
            if (
                /^FOUNDRY_LOCAL_NUGET_/i.test(key) ||
                /^npm_config_registry$/i.test(key)
            )
                delete env[key];
        const pathKey =
            Object.keys(env).find((key) => key.toLowerCase() === "path") ??
            "PATH";
        env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ""}`;
        execFileSync(
            process.execPath,
            [path.join(scripts, "setupWorktree.mjs")],
            { cwd: root, env, stdio: "pipe" },
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(capture, "utf8")), {
            args: ["install"],
            feed,
            mode: "dotnet",
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
