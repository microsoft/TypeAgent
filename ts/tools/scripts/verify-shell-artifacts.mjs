// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
    path.resolve(scriptsDir, "..", "..", "packages", "shell", "package.json"),
);
const yaml = require("js-yaml");
const policy = JSON.parse(
    readFileSync(path.join(scriptsDir, "windows-package-trust.json"), "utf8"),
);

function verifySignature(packagePath) {
    const result = spawnSync(
        path.join(
            process.env.SystemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
        ),
        [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            path.join(scriptsDir, "verify-windows-package.ps1"),
            "-Path",
            packagePath,
        ],
        {
            encoding: "utf8",
            env: Object.fromEntries(
                Object.entries(process.env).filter(
                    ([key]) => key.toLowerCase() !== "psmodulepath",
                ),
            ),
        },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Untrusted shell installer: ${result.stderr}`);
    }
}

export function verifyShellArtifacts(directory, verify = verifySignature) {
    const names = readdirSync(directory);
    // Electron-builder diagnostics share the output directory with channel metadata.
    const metadataNames = names.filter(
        (name) => name.endsWith(".yml") && name !== "builder-debug.yml",
    );
    if (metadataNames.length === 0) {
        throw new Error("No shell channel metadata found.");
    }
    const verified = new Set();
    for (const name of metadataNames) {
        const metadata = yaml.load(
            readFileSync(path.join(directory, name), "utf8"),
            { schema: yaml.JSON_SCHEMA },
        );
        const packageName = metadata?.path;
        if (
            typeof packageName !== "string" ||
            !/^typeagentshell-[A-Za-z0-9][A-Za-z0-9._-]*-win32-(x64|arm64)-setup\.exe$/.test(
                packageName,
            )
        ) {
            throw new Error(`Unsafe installer path in ${name}.`);
        }
        const packagePath = path.join(directory, packageName);
        const bytes = readFileSync(packagePath);
        const sha512 = createHash("sha512").update(bytes).digest("base64");
        if (
            metadata.sha512 !== sha512 ||
            metadata.files?.length !== 1 ||
            metadata.files[0].url !== packageName ||
            metadata.files[0].sha512 !== sha512 ||
            metadata.files[0].size !== bytes.length
        ) {
            throw new Error(
                `Shell metadata does not match final bytes: ${name}`,
            );
        }
        if (!verified.has(packageName)) {
            verify(packagePath);
            verified.add(packageName);
        }
    }
    for (const name of names.filter((name) => name.endsWith(".exe"))) {
        if (!verified.has(name)) {
            throw new Error(
                `Unreferenced executable in shell publication: ${name}`,
            );
        }
    }
    return verified.size;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    // Publication agents need only the public trust anchor, never the PFX.
    if (process.platform !== "win32") {
        throw new Error("Windows signature verification requires Windows.");
    }
    if (process.argv.length !== 3) {
        throw new Error("Usage: node verify-shell-artifacts.mjs <directory>");
    }
    console.log(
        `Verified ${verifyShellArtifacts(process.argv[2])} shell installer(s) for ${policy.publisher}.`,
    );
}
