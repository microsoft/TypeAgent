#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";

const removableDirectoryNames = new Set([
    "__tests__",
    "benchmark",
    "benchmarks",
    "coverage",
    "doc",
    "docs",
    "example",
    "examples",
    "test",
    "tests",
]);

const removableDocumentNames =
    /^(authors|changelog|changes|contributing|history|readme|security)(\..*)?$/i;
const sourceMapExtensions = [".js.map", ".mjs.map", ".cjs.map", ".css.map"];
const declarationExtensions = [".d.ts", ".d.mts", ".d.cts"];

function parseArgs(argv) {
    const args = { dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--dir") args.dir = argv[++i];
        else if (arg === "--dry-run") args.dryRun = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.dir) throw new Error("Missing --dir <deployDir>.");
    args.dir = path.resolve(args.dir);
    return args;
}

function isPackageDirectory(directory) {
    const parent = path.dirname(directory);
    if (path.basename(parent).toLowerCase() === "node_modules") {
        return true;
    }
    return (
        path.basename(path.dirname(parent)).toLowerCase() === "node_modules" &&
        path.basename(parent).startsWith("@")
    );
}

function shouldRemoveFile(name) {
    const lower = name.toLowerCase();
    return (
        sourceMapExtensions.some((extension) => lower.endsWith(extension)) ||
        declarationExtensions.some((extension) => lower.endsWith(extension)) ||
        removableDocumentNames.test(name)
    );
}

function getSize(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function removeDevelopmentFiles(root, dryRun) {
    const stack = [root];
    let removedBytes = 0;
    let removedFiles = 0;
    let removedDirectories = 0;

    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                const removeDirectory =
                    isPackageDirectory(current) &&
                    removableDirectoryNames.has(entry.name.toLowerCase());
                if (removeDirectory) {
                    const files = [];
                    const pending = [fullPath];
                    while (pending.length > 0) {
                        const directory = pending.pop();
                        for (const child of fs.readdirSync(directory, {
                            withFileTypes: true,
                        })) {
                            const childPath = path.join(directory, child.name);
                            if (child.isDirectory()) pending.push(childPath);
                            else if (child.isFile()) files.push(childPath);
                        }
                    }
                    removedBytes += files.reduce(
                        (total, file) => total + getSize(file),
                        0,
                    );
                    removedFiles += files.length;
                    removedDirectories++;
                    if (!dryRun) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    }
                } else {
                    stack.push(fullPath);
                }
            } else if (entry.isFile() && shouldRemoveFile(entry.name)) {
                removedBytes += getSize(fullPath);
                removedFiles++;
                if (!dryRun) fs.rmSync(fullPath, { force: true });
            }
        }
    }

    return { removedBytes, removedFiles, removedDirectories };
}

function formatSize(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
    const args = parseArgs(process.argv);
    const nodeModules = path.join(args.dir, "node_modules");
    if (!fs.existsSync(nodeModules)) {
        throw new Error(`node_modules not found under ${args.dir}.`);
    }

    const result = removeDevelopmentFiles(nodeModules, args.dryRun);
    console.log(
        `${args.dryRun ? "Would remove" : "Removed"} ${result.removedFiles} development-only files ` +
            `and ${result.removedDirectories} directories (${formatSize(result.removedBytes)}).`,
    );
}

main();
