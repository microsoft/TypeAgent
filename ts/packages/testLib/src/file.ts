// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import os from "node:os";

export function getAbsolutePath(relativePath: string): string {
    return path.join(process.cwd(), relativePath);
}

export function getRootDataPath() {
    return path.join(os.tmpdir(), "/data/tests");
}

export function getOutputDirPath(relativePath: string) {
    const absPath = path.join(getRootDataPath(), relativePath);
    return absPath;
}

export function readTestFile(filePath: string): string {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : getAbsolutePath(filePath);
    return fs.readFileSync(absolutePath, "utf-8");
}

/**
 * Reads all lines in a file
 * @param filePath
 * @returns
 */
export function readTestFileLines(filePath: string): string[] {
    const text = readTestFile(filePath);
    if (text) {
        let lines = text.split(/\r?\n/);
        lines = lines.map((l) => l.trim());
        lines = lines.filter((l) => l.length > 0);
        return lines;
    }
    return [];
}

export function readTestJsonFile(filePath: string): any {
    const json = readTestFile(filePath);
    return JSON.parse(json);
}

export function ensureDir(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.promises.mkdir(folderPath, { recursive: true });
    }
    return folderPath;
}

export function ensureOutputDir(name: string, clean: boolean = true): string {
    const dirPath = getOutputDirPath(name);
    if (clean) {
        removeDir(dirPath);
    }
    ensureDir(dirPath);
    return dirPath;
}

/**
 * Remove directory from given file system
 * @param folderPath
 * @param fSys
 * @returns true if success. False if folder does not exist
 */
export function removeDir(folderPath: string): boolean {
    try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        return true;
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return false;
}

export function cleanDir(folderPath: string): void {
    removeDir(folderPath);
    ensureDir(folderPath);
}

export function getDbPath(name: string, subDir?: string): string {
    const dbDirName = "databases";
    subDir = subDir ? path.join(subDir, dbDirName) : dbDirName;
    const dirPath = ensureOutputDir(subDir);
    return path.join(dirPath, name);
}
