// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export function removeFile(filePath: string): boolean {
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch {}
    return false;
}

export function ensureDir(dirPath: string): string {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

export function getFileNamesInDir(dirPath: string): string[] {
    const fileNames = fs.readdirSync(dirPath);
    return fileNames.filter((name) =>
        fs.statSync(path.join(dirPath, name)).isFile(),
    );
}

export function getFilePathsInDir(dirPath: string): string[] {
    const fileNames = fs.readdirSync(dirPath);
    const filePaths = fileNames.map((name) => path.join(dirPath, name));
    return filePaths.filter((fPath) => fs.statSync(fPath).isFile());
}

export function getAbsolutePathFromUrl(baseUrl: string, relativePath: string) {
    return fileURLToPath(new URL(relativePath, baseUrl));
}

/**
 * Read a JSON object from the given file.
 * @param filePath
 * @param validator
 * @returns
 */
export function readJsonFile<T>(
    filePath: string,
    defaultValue?: T | undefined,
    validator?: ((obj: any) => T) | undefined,
): T | undefined {
    try {
        let json;
        json = fs.readFileSync(filePath, {
            encoding: "utf-8",
        });
        if (json.length > 0) {
            const obj = JSON.parse(json);
            return validator ? validator(obj) : <T>obj;
        }
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return defaultValue ?? undefined;
}

export function readAllText(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return undefined;
}

export function readAllLines(
    filePath: string,
    trim: boolean = true,
): string[] | undefined {
    let fileText = readAllText(filePath);
    if (!fileText) {
        return undefined;
    }
    let lines = fileText.split(/\r?\n/);
    if (trim) {
        lines = lines.map((l) => l.trim());
    }
    lines = lines.filter((l) => l.length > 0);
    return lines;
}

export function filePathToUrlString(filePath: string): string {
    const url = new URL(`file://${filePath}`);
    return url.toString();
}
