// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import fs from "fs";

export function removeFile(filePath: string): boolean {
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch {}
    return false;
}

export function ensureDir(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    return folderPath;
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
