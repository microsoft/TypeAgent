#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const tsRoot = path.resolve(scriptsDir, "..", "..");

export const runtimeExternalPackages = [
    "@anthropic-ai/claude-agent-sdk",
    "@azure/msal-node-extensions",
    "@github/copilot-sdk",
    "@modelcontextprotocol/server-filesystem",
    "better-sqlite3",
    "graphology",
    "graphology-communities-louvain",
    "graphology-layout",
    "graphology-layout-forceatlas2",
    "graphology-layout-noverlap",
    "graphology-metrics",
    "keytar",
    "onnxruntime-node",
    "puppeteer",
    "puppeteer-extra",
    "puppeteer-extra-plugin-adblocker",
    "puppeteer-extra-plugin-stealth",
    "sharp",
];

export const optionalExternalPackages = [
    "@aws-sdk/credential-providers",
    "@img/sharp-libvips-dev",
    "@img/sharp-wasm32",
    "@mongodb-js/zstd",
    "aws4",
    "bufferutil",
    "kerberos",
    "mongodb-client-encryption",
    "snappy",
    "utf-8-validate",
];

const ignoredDirectoryNames = new Set([
    ".git",
    "benchmark",
    "benchmarks",
    "coverage",
    "deploy",
    "docs",
    "examples",
    "node_modules",
    "test",
    "tests",
]);

const ignoredFilePatterns = [
    /\.d\.(?:ts|mts|cts)(?:\.map)?$/i,
    /\.(?:js|mjs|cjs|css)\.map$/i,
    /\.tsbuildinfo$/i,
    /\.done\.build\.log$/i,
];

const runtimeAssetExtensions = new Set([
    ".ag.json",
    ".agr",
    ".bin",
    ".css",
    ".csv",
    ".gif",
    ".html",
    ".ico",
    ".jpeg",
    ".jpg",
    ".json",
    ".md",
    ".pas.json",
    ".png",
    ".svg",
    ".txt",
    ".wasm",
    ".yaml",
    ".yml",
]);

export function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function copyFile(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

export function resolveExportTarget(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value && typeof value === "object") {
        return (
            value.default ??
            value.import ??
            value.node ??
            value.require ??
            undefined
        );
    }
    return undefined;
}

export function packageNameFromSpecifier(specifier) {
    if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("node:")
    ) {
        return undefined;
    }
    const parts = specifier.split("/");
    return specifier.startsWith("@")
        ? parts.length >= 2
            ? `${parts[0]}/${parts[1]}`
            : undefined
        : parts[0];
}

function isBuiltin(specifier) {
    const name = specifier.replace(/^node:/, "");
    return builtinModules.includes(name);
}

function isIgnoredFile(name) {
    return ignoredFilePatterns.some((pattern) => pattern.test(name));
}

function isRuntimeAsset(file) {
    if (isIgnoredFile(path.basename(file))) {
        return false;
    }
    if (
        /^(?:readme|changelog|changes|contributing|history|security)(?:\..*)?$/i.test(
            path.basename(file),
        ) ||
        /^(?:tsconfig|jsconfig)(?:\..*)?\.json$/i.test(path.basename(file))
    ) {
        return false;
    }
    const lower = file.toLowerCase();
    for (const extension of runtimeAssetExtensions) {
        if (lower.endsWith(extension)) {
            return true;
        }
    }
    return /^(license|licence|notice)(\..*)?$/i.test(path.basename(file));
}

export function copyRuntimeAssets(sourceRoot, destinationRoot) {
    const copied = [];
    const stack = [sourceRoot];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const source = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignoredDirectoryNames.has(entry.name.toLowerCase())) {
                    stack.push(source);
                }
                continue;
            }
            if (!entry.isFile() || !isRuntimeAsset(source)) {
                continue;
            }
            const relative = path.relative(sourceRoot, source);
            copyFile(source, path.join(destinationRoot, relative));
            copied.push(relative);
        }
    }
    return copied;
}

export function copyRuntimeTree(sourceRoot, destinationRoot) {
    const copied = [];
    const stack = [sourceRoot];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const source = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!ignoredDirectoryNames.has(entry.name.toLowerCase())) {
                    stack.push(source);
                }
                continue;
            }
            if (
                !entry.isFile() ||
                isIgnoredFile(entry.name) ||
                /^(?:readme|changelog|changes|contributing|history|security)(?:\..*)?$/i.test(
                    entry.name,
                )
            ) {
                continue;
            }
            const relative = path.relative(sourceRoot, source);
            copyFile(source, path.join(destinationRoot, relative));
            copied.push(relative);
        }
    }
    return copied;
}

function collectManifestFileReferences(value, result) {
    if (typeof value === "string") {
        if (/\.(?:ts|mts|cts|json|agr|yaml|yml|txt|md)$/i.test(value)) {
            result.add(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectManifestFileReferences(item, result);
        }
        return;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            collectManifestFileReferences(item, result);
        }
    }
}

export function copyManifestReferences(
    manifestSource,
    packageRoot,
    destinationRoot,
) {
    const manifest = readJson(manifestSource);
    const references = new Set();
    collectManifestFileReferences(manifest, references);
    const copied = [];
    for (const reference of references) {
        const source = path.resolve(path.dirname(manifestSource), reference);
        if (
            !source.startsWith(`${packageRoot}${path.sep}`) ||
            !fs.existsSync(source) ||
            !fs.statSync(source).isFile()
        ) {
            continue;
        }
        const relative = path.relative(packageRoot, source);
        copyFile(source, path.join(destinationRoot, relative));
        copied.push(relative);
    }
    return copied;
}

export async function bundleEntry({
    entryPoint,
    outfile,
    external = [],
    runtimeRootFromOutput,
    assetRoot,
}) {
    const runtimeBanner = runtimeRootFromOutput
        ? [
              `process.env.TYPEAGENT_RUNTIME_ROOT ??= __bundleFileURLToPath(new URL('${runtimeRootFromOutput}', import.meta.url));`,
          ].join(" ")
        : "";
    const result = await build({
        entryPoints: [entryPoint],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        external: [
            ...runtimeExternalPackages,
            ...optionalExternalPackages,
            ...external,
        ],
        metafile: true,
        sourcemap: false,
        legalComments: "none",
        keepNames: true,
        inject: [path.join(scriptsDir, "bundleNodeGlobals.mjs")],
        banner: {
            js:
                "import { createRequire as __createRequire } from 'node:module'; " +
                "import { fileURLToPath as __bundleFileURLToPath } from 'node:url'; " +
                "const require = __createRequire(import.meta.url); " +
                runtimeBanner,
        },
        logLevel: "warning",
    });
    if (assetRoot) {
        copyReferencedTypeScriptAssets(
            result.metafile,
            outfile,
            path.resolve(assetRoot),
        );
    }
    return result.metafile;
}

function copyReferencedTypeScriptAssets(metafile, outfile, assetRoot) {
    const outputDirectory = path.dirname(outfile);
    const referencePattern = /(["'`])([^"'`]+\.(?:ts|mts|cts))\1/g;
    for (const input of Object.keys(metafile.inputs)) {
        const inputFile = path.isAbsolute(input)
            ? input
            : path.resolve(tsRoot, input);
        if (!fs.existsSync(inputFile)) {
            continue;
        }
        const sourceText = fs.readFileSync(inputFile, "utf8");
        for (const match of sourceText.matchAll(referencePattern)) {
            const reference = match[2];
            if (path.isAbsolute(reference)) {
                continue;
            }
            if (/\.d\.(?:ts|mts|cts)$/i.test(reference)) {
                continue;
            }
            const source = path.resolve(path.dirname(inputFile), reference);
            if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
                continue;
            }
            const destination = path.resolve(outputDirectory, reference);
            if (
                destination !== assetRoot &&
                !destination.startsWith(`${assetRoot}${path.sep}`)
            ) {
                throw new Error(
                    `Bundled runtime asset escapes the artifact: ${reference}`,
                );
            }
            if (fs.existsSync(destination)) {
                const existing = fs.readFileSync(destination);
                const incoming = fs.readFileSync(source);
                if (!existing.equals(incoming)) {
                    throw new Error(
                        `Bundled runtime assets conflict at ${destination}.`,
                    );
                }
                continue;
            }
            copyFile(source, destination);
        }
    }
}

export function externalPackagesFromMetafile(metafile) {
    const packages = new Set();
    for (const output of Object.values(metafile.outputs)) {
        for (const imported of output.imports) {
            if (!imported.external || isBuiltin(imported.path)) {
                continue;
            }
            const packageName = packageNameFromSpecifier(imported.path);
            if (packageName) {
                packages.add(packageName);
            }
        }
    }
    return packages;
}

function findPackageJsonFromResolved(resolved, packageName) {
    let current = path.dirname(resolved);
    while (current !== path.dirname(current)) {
        const candidate = path.join(current, "package.json");
        if (fs.existsSync(candidate)) {
            const pkg = readJson(candidate);
            if (pkg.name === packageName) {
                return candidate;
            }
        }
        current = path.dirname(current);
    }
    return undefined;
}

export function resolveInstalledPackage(packageName, fromPackageJson) {
    const require = createRequire(fromPackageJson);
    let packageJson;
    try {
        packageJson = require.resolve(`${packageName}/package.json`);
    } catch {
        try {
            const resolved = require.resolve(packageName);
            packageJson = findPackageJsonFromResolved(resolved, packageName);
        } catch {
            const storePrefix = `${packageName.replace("/", "+")}@`;
            const store = path.join(tsRoot, "node_modules", ".pnpm");
            const match = fs
                .readdirSync(store, { withFileTypes: true })
                .find(
                    (entry) =>
                        entry.isDirectory() &&
                        entry.name.startsWith(storePrefix),
                );
            if (match) {
                const candidate = path.join(
                    store,
                    match.name,
                    "node_modules",
                    ...packageName.split("/"),
                    "package.json",
                );
                if (fs.existsSync(candidate)) {
                    packageJson = candidate;
                }
            }
        }
    }
    if (!packageJson) {
        throw new Error(
            `Unable to locate package.json for runtime external '${packageName}'.`,
        );
    }
    return { packageJson, package: readJson(packageJson) };
}

export function runtimeDependencyVersions(packageNames, fromPackageJson) {
    const dependencies = {};
    for (const packageName of [...packageNames].sort()) {
        if (!runtimeExternalPackages.includes(packageName)) {
            continue;
        }
        const resolved = resolveInstalledPackage(packageName, fromPackageJson);
        dependencies[packageName] = resolved.package.version;
    }
    return dependencies;
}

export function workspacePackages() {
    const roots = [
        path.join(tsRoot, "packages"),
        path.join(tsRoot, "examples"),
    ];
    const packages = new Map();
    for (const root of roots) {
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            for (const entry of fs.readdirSync(current, {
                withFileTypes: true,
            })) {
                if (
                    !entry.isDirectory() ||
                    ignoredDirectoryNames.has(entry.name.toLowerCase())
                ) {
                    continue;
                }
                const directory = path.join(current, entry.name);
                const packageJson = path.join(directory, "package.json");
                if (fs.existsSync(packageJson)) {
                    const pkg = readJson(packageJson);
                    if (pkg.name) {
                        packages.set(pkg.name, {
                            directory,
                            packageJson,
                            package: pkg,
                        });
                    }
                } else {
                    stack.push(directory);
                }
            }
        }
    }
    return packages;
}

export function packageInstallPath(root, packageName) {
    return path.join(root, ...packageName.split("/"));
}

export function fileMetrics(root) {
    let files = 0;
    let bytes = 0;
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                files++;
                bytes += fs.statSync(full).size;
            }
        }
    }
    return { files, bytes };
}
