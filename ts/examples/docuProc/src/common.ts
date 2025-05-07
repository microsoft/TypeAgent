// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { fileURLToPath } from "url";
import * as fsp from "fs/promises";
import * as fs from "fs";
import { lock } from "proper-lockfile";

import {
    ArgDef,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
} from "interactive-app";
import { dateTime } from "typeagent";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up two levels: from src/common to dist
const distRoot = path.resolve(__dirname, "../dist");

export const DIST_ROOT = distRoot;
export const OUTPUT_DIR = path.join(distRoot, "output-data");
export const CHUNKED_DOCS_DIR = path.join(OUTPUT_DIR, "chunked-docs");
export const LOGS_DIR = path.join(OUTPUT_DIR, "logs");
export const SRAG_MEM_DIR = path.join(OUTPUT_DIR, "knowpro-mem");

export const PAPER_DOWNLOAD_DIR = path.join(OUTPUT_DIR, "papers/downloads");

export const PAPER_CATALOG_PATH = path.join(
    OUTPUT_DIR,
    "papers",
    "downloaded_papers.json",
);

export function resolveFilePath(filePath: string): string {
    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(__dirname, filePath);
}

export function resolveAndValidateFiles(filenames: string[]): string[] {
    const missingFiles: string[] = [];

    const absFilenames = filenames.map((f) => {
        const absPath = resolveFilePath(f);
        if (!fs.existsSync(absPath)) {
            missingFiles.push(absPath);
        }
        return absPath;
    });

    if (missingFiles.length > 0) {
        console.error("❌ The following files were not found:");
        missingFiles.forEach((file) => console.error("  -", file));
        throw new Error("One or more input files do not exist.");
    }

    return absFilenames;
}

export async function withFileLock<T>(
    file: string,
    fn: () => Promise<T>,
): Promise<T> {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "", { flag: "a" }); // touch – ensures file exists

    const release = await lock(file, {
        retries: { retries: 5, factor: 2, minTimeout: 50, maxTimeout: 200 },
        realpath: false,
    });

    try {
        return await fn();
    } finally {
        await release();
    }
}
export function argDestFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to output file",
        type: "string",
        defaultValue,
    };
}

export function argSourceFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to source file",
        type: "path",
        defaultValue,
    };
}

export function argToDate(value: string | undefined): Date | undefined {
    return value ? dateTime.stringToDate(value) : undefined;
}

export function parseFreeAndNamedArguments(
    args: string[],
    argDefs: CommandMetadata,
): [string[], NamedArgs] {
    const namedArgsStartAt = args.findIndex((v) => v.startsWith("--"));
    if (namedArgsStartAt < 0) {
        return [args, parseNamedArguments([], argDefs)];
    }
    return [
        args.slice(0, namedArgsStartAt),
        parseNamedArguments(args.slice(namedArgsStartAt), argDefs),
    ];
}

export function keyValuesFromNamedArgs(
    args: NamedArgs,
    metadata?: CommandMetadata,
): Record<string, string> {
    const record: Record<string, string> = {};
    const keys = Object.keys(args);
    for (const key of keys) {
        const value = args[key];
        if (typeof value !== "function") {
            record[key] = value;
        }
    }
    if (metadata !== undefined) {
        if (metadata.args) {
            removeKeysFromRecord(record, Object.keys(metadata.args));
        }
        if (metadata.options) {
            removeKeysFromRecord(record, Object.keys(metadata.options));
        }
    }
    return record;
}

function removeKeysFromRecord(record: Record<string, string>, keys: string[]) {
    for (const key of keys) {
        delete record[key];
    }
}
