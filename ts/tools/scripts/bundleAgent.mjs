#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    bundleEntry,
    copyFile,
    copyManifestReferences,
    copyRuntimeAssets,
    copyRuntimeTree,
    externalPackagesFromMetafile,
    fileMetrics,
    readJson,
    resolveExportTarget,
    runtimeDependencyVersions,
    workspacePackages,
    writeJson,
} from "./bundleUtils.mjs";

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--package") args.packageRoot = argv[++i];
        else if (arg === "--out") args.out = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.packageRoot || !args.out) {
        throw new Error("Usage: bundleAgent.mjs --package <dir> --out <dir>");
    }
    args.packageRoot = path.resolve(args.packageRoot);
    args.out = path.resolve(args.out);
    return args;
}

const requiredRuntimeExternals = new Set([
    "@anthropic-ai/claude-agent-sdk",
    "better-sqlite3",
    "puppeteer",
    "sharp",
]);

function loadBundleDefinition(packageRoot) {
    const sourcePackageJson = path.join(packageRoot, "package.json");
    const pkg = readJson(sourcePackageJson);
    if (!pkg.name) {
        throw new Error(`${sourcePackageJson} has no package name.`);
    }
    const packageExports = pkg.exports ?? {};
    const handlerTarget = resolveExportTarget(
        packageExports["./agent/handlers"],
    );
    const manifestTarget = resolveExportTarget(
        packageExports["./agent/manifest"],
    );
    if (!handlerTarget || !manifestTarget) {
        throw new Error(
            `${pkg.name} must export ./agent/handlers and ./agent/manifest.`,
        );
    }
    return {
        sourcePackageJson,
        pkg,
        packageExports,
        handlerTarget,
        manifestTarget,
    };
}

async function bundleDeclaredExports(packageRoot, out, pkg, packageExports) {
    const metafiles = [];
    const bundledExports = {};
    for (const [exportName, exportValue] of Object.entries(packageExports)) {
        const target = resolveExportTarget(exportValue);
        if (!target) {
            continue;
        }
        const source = path.resolve(packageRoot, target);
        if (!fs.existsSync(source)) {
            throw new Error(
                `${pkg.name}: export '${exportName}' is missing ${target}.`,
            );
        }
        if (/\.(?:js|mjs|cjs)$/i.test(target)) {
            const destination = path.resolve(out, target);
            const metafile = await bundleEntry({
                entryPoint: source,
                outfile: destination,
                assetRoot: out,
            });
            metafiles.push(metafile);
            bundledExports[exportName] = target;
        } else {
            copyFile(source, path.resolve(out, target));
            bundledExports[exportName] = target;
        }
    }
    return { metafiles, bundledExports };
}

async function bundleAdditionalEntries(packageRoot, out, pkg) {
    const additionalEntries = pkg.typeagent?.bundle?.entries ?? [];
    const metafiles = [];
    for (const target of additionalEntries) {
        const source = path.resolve(packageRoot, target);
        if (!fs.existsSync(source)) {
            throw new Error(`${pkg.name}: bundle entry is missing ${target}.`);
        }
        const destination = path.resolve(out, target);
        const metafile = await bundleEntry({
            entryPoint: source,
            outfile: destination,
            assetRoot: out,
        });
        metafiles.push(metafile);
    }
    return { additionalEntries, metafiles };
}

function copyConfiguredRuntimeAssets(packageRoot, out, pkg, assets) {
    for (const runtimePath of pkg.typeagent?.bundle?.assets ?? []) {
        const source = path.resolve(packageRoot, runtimePath);
        const destination = path.resolve(out, runtimePath);
        if (!fs.existsSync(source)) {
            throw new Error(
                `${pkg.name}: bundle runtime asset is missing ${runtimePath}.`,
            );
        }
        for (const relative of copyRuntimeTree(source, destination)) {
            assets.add(path.join(runtimePath, relative));
        }
    }
}

function copyMappedAssets(packageRoot, out, pkg, assets) {
    const packages = workspacePackages();
    for (const mapping of pkg.typeagent?.bundle?.assetMappings ?? []) {
        const sourcePackage = packages.get(mapping.package);
        if (!sourcePackage) {
            throw new Error(
                `${pkg.name}: bundle asset package is missing ${mapping.package}.`,
            );
        }
        const source = path.resolve(sourcePackage.directory, mapping.source);
        const destination = path.resolve(out, mapping.destination);
        if (
            destination !== out &&
            !destination.startsWith(`${out}${path.sep}`)
        ) {
            throw new Error(
                `${pkg.name}: bundle asset destination escapes the package: ${mapping.destination}.`,
            );
        }
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
            throw new Error(
                `${pkg.name}: bundle mapped asset is missing ${mapping.package}/${mapping.source}.`,
            );
        }
        copyFile(source, destination);
        assets.add(mapping.destination);
    }
}

function copyBundleAssets(packageRoot, out, pkg, manifestTarget) {
    const manifestSource = path.resolve(packageRoot, manifestTarget);
    const assets = new Set(copyRuntimeAssets(packageRoot, out));
    for (const asset of copyManifestReferences(
        manifestSource,
        packageRoot,
        out,
    )) {
        assets.add(asset);
    }
    copyConfiguredRuntimeAssets(packageRoot, out, pkg, assets);
    copyMappedAssets(packageRoot, out, pkg, assets);
    return assets;
}

function collectExternalPackages(metafiles, pkg) {
    const externalPackages = new Set();
    for (const metafile of metafiles) {
        for (const packageName of externalPackagesFromMetafile(metafile)) {
            externalPackages.add(packageName);
        }
    }
    for (const packageName of Object.keys(pkg.dependencies ?? {})) {
        if (requiredRuntimeExternals.has(packageName)) {
            externalPackages.add(packageName);
        }
    }
    return externalPackages;
}

function writeGeneratedPackage(
    out,
    pkg,
    handlerTarget,
    bundledExports,
    externalPackages,
    sourcePackageJson,
) {
    const generatedPackage = {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        license: pkg.license,
        author: pkg.author,
        type: "module",
        keywords: pkg.keywords,
        exports: bundledExports,
        main: handlerTarget,
        dependencies: runtimeDependencyVersions(
            externalPackages,
            sourcePackageJson,
        ),
        typeagent: pkg.typeagent,
    };
    writeJson(path.join(out, "package.json"), generatedPackage);
}

function collectBundledInputs(packageRoot, metafiles) {
    const inputs = new Set();
    for (const metafile of metafiles) {
        for (const input of Object.keys(metafile.inputs)) {
            inputs.add(path.relative(packageRoot, path.resolve(input)));
        }
    }
    return inputs;
}

function writeBundleManifest(
    out,
    pkg,
    bundledExports,
    additionalEntries,
    externalPackages,
    assets,
    inputs,
    metrics,
) {
    writeJson(path.join(out, "bundle-manifest.json"), {
        package: pkg.name,
        version: pkg.version,
        exports: bundledExports,
        additionalEntries,
        runtimeExternals: [...externalPackages].sort(),
        assets: [...assets].sort(),
        bundledInputs: [...inputs].sort(),
        metrics,
    });
}

export async function bundleAgentPackage(packageRoot, out) {
    const {
        sourcePackageJson,
        pkg,
        packageExports,
        handlerTarget,
        manifestTarget,
    } = loadBundleDefinition(packageRoot);

    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    const declared = await bundleDeclaredExports(
        packageRoot,
        out,
        pkg,
        packageExports,
    );
    const additional = await bundleAdditionalEntries(packageRoot, out, pkg);
    const metafiles = [...declared.metafiles, ...additional.metafiles];
    const assets = copyBundleAssets(packageRoot, out, pkg, manifestTarget);
    const externalPackages = collectExternalPackages(metafiles, pkg);

    writeGeneratedPackage(
        out,
        pkg,
        handlerTarget,
        declared.bundledExports,
        externalPackages,
        sourcePackageJson,
    );

    const inputs = collectBundledInputs(packageRoot, metafiles);
    const metrics = fileMetrics(out);
    writeBundleManifest(
        out,
        pkg,
        declared.bundledExports,
        additional.additionalEntries,
        externalPackages,
        assets,
        inputs,
        metrics,
    );
    return {
        packageName: pkg.name,
        metrics,
        runtimeExternals: externalPackages,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const result = await bundleAgentPackage(args.packageRoot, args.out);
    console.log(
        `Bundled ${result.packageName}: ${result.metrics.files} files, ` +
            `${(result.metrics.bytes / 1024 / 1024).toFixed(1)} MB`,
    );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
    await main();
}
