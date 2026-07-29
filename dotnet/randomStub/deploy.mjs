#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-command build + deploy for the randomStub demo CLI.
//
// Publishes a framework-dependent single-file binary for the current OS and
// copies it to a directory that is already on PATH, so TypeAgent Studio's
// onboarding Discovery phase (which runs the bare command name) can find it.
//
// Usage:
//   node dotnet/randomStub/deploy.mjs                 # auto-pick a PATH dir
//   node dotnet/randomStub/deploy.mjs --to <dir>      # deploy to a specific dir
//   node dotnet/randomStub/deploy.mjs --print-target  # just show where it would go

import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csproj = path.join(__dirname, "randomStub.csproj");

function rid() {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    switch (process.platform) {
        case "win32":
            return `win-${arch}`;
        case "darwin":
            return `osx-${arch}`;
        case "linux":
            return `linux-${arch}`;
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

function exeName() {
    return process.platform === "win32" ? "randomstub.exe" : "randomstub";
}

// Directories we must never deploy into even if they look writable
// (Windows reports false-positive write access on some protected stores).
function isSystemDir(dir) {
    const d = dir.toLowerCase();
    return (
        d.includes("\\windows\\") ||
        d.includes("\\windowsapps") ||
        d.endsWith("\\windows") ||
        d.includes("\\program files") ||
        d === "/usr/bin" ||
        d === "/bin" ||
        d === "/sbin"
    );
}

// Reliable writability probe: accessSync(W_OK) is unreliable on Windows, so
// actually create and delete a temp file.
function isWritable(dir) {
    if (!fs.existsSync(dir) || isSystemDir(dir)) return false;
    const probe = path.join(dir, `.randomstub-write-test-${process.pid}`);
    try {
        fs.writeFileSync(probe, "");
        fs.rmSync(probe);
        return true;
    } catch {
        return false;
    }
}

// The npm global bin dir is reliably on PATH once npm is installed. On Windows
// it IS the global prefix; on Unix it is <prefix>/bin.
function npmGlobalBinDir() {
    try {
        // execSync (shell string, no args array) avoids the Node DEP0190
        // warning that execFile+shell:true emits.
        const prefix = execSync("npm prefix -g", {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (!prefix) return undefined;
        return process.platform === "win32" ? prefix : path.join(prefix, "bin");
    } catch {
        return undefined;
    }
}

// Pick a writable directory that is already on PATH. Prefer the npm global bin
// dir; fall back to the first genuinely writable, non-system PATH entry.
function autoTargetDir() {
    const candidates = [];
    const npmBin = npmGlobalBinDir();
    if (npmBin) candidates.push(npmBin);
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    candidates.push(...pathDirs);

    for (const dir of candidates) {
        if (isWritable(dir)) return dir;
    }
    throw new Error(
        "Could not find a writable directory on PATH. Pass one explicitly: --to <dir>",
    );
}

function parseArgs(argv) {
    const args = { to: undefined, printTarget: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--to") args.to = argv[++i];
        else if (argv[i] === "--print-target") args.printTarget = true;
        else throw new Error(`Unknown argument: ${argv[i]}`);
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const targetDir = path.resolve(args.to ?? autoTargetDir());

    if (args.printTarget) {
        console.log(targetDir);
        return;
    }

    const publishDir = path.join(__dirname, "bin", "deploy", rid());
    console.log(`Publishing randomStub (${rid()}, framework-dependent single-file)...`);
    execFileSync(
        "dotnet",
        [
            "publish",
            csproj,
            "-c",
            "Release",
            "-r",
            rid(),
            "--self-contained",
            "false",
            "-p:PublishSingleFile=true",
            "-o",
            publishDir,
        ],
        { stdio: "inherit" },
    );

    const src = path.join(publishDir, exeName());
    if (!fs.existsSync(src)) {
        throw new Error(`Expected published binary not found: ${src}`);
    }
    const dest = path.join(targetDir, exeName());
    fs.copyFileSync(src, dest);
    if (process.platform !== "win32") fs.chmodSync(dest, 0o755);

    console.log(`\nDeployed: ${dest}`);
    console.log(`Verify:   ${exeName().replace(/\.exe$/, "")} number --min 1 --max 10`);
}

main();
