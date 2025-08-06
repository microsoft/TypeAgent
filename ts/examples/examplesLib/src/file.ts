// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { isFilePath } from "typeagent";

export function readBatchFile(filePath: string, commentPrefix = "#"): string[] {
    const text = fs.readFileSync(filePath, "utf-8");
    if (!text) {
        return [];
    }

    let lines = text.split(/\r?\n/);
    lines = lines.map((l) => l.trim());
    lines = lines.filter((l) => l.length > 0 && !l.startsWith(commentPrefix));
    return lines;
}

export function getAbsolutePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }
    return path.join(process.cwd(), relativePath);
}

export function getTextOrFile(text: string): string {
    return isFilePath(text) ? fs.readFileSync(text, "utf-8") : text;
}

export function toUrl(str: string): URL | undefined {
    try {
        return new URL(str);
    } catch {}
    return undefined;
}

export function isUrl(str: string): boolean {
    return toUrl(str) !== undefined;
}

export function getFileNameFromUrl(url: string | URL): string | undefined {
    if (typeof url === "string") {
        url = new URL(url);
    }
    const urlParts = url.pathname.split("/");
    if (urlParts) {
        return urlParts.length > 0 ? urlParts[urlParts.length - 1] : "";
    }
    return undefined;
}
