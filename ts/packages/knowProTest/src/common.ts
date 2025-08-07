// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextEmbeddingModel } from "aiclient";
import fs from "fs";
import {
    ArgDef,
    getBatchFileLines,
    NamedArgs,
    parseCommandLine,
} from "interactive-app";
import path from "path";
import {
    collections,
    dateTime,
    dotProduct,
    generateTextEmbeddingsWithRetry,
    getFileName,
    writeJsonFile,
} from "typeagent";
import { error, Result, Error, success } from "typechat";
import { BatchCallback, ComparisonResult } from "./types.js";

export function ensureDirSync(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    return folderPath;
}

export function ensureUniqueFilePath(filePath: string): string {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }

    for (let i = 1; i < 1000; ++i) {
        const tempPath = addFileNameSuffixToPath(filePath, `_${i}`);
        if (!fs.existsSync(tempPath)) {
            return tempPath;
        }
    }

    throw new Error(`Could not ensure unique ${filePath}`);
}

export function writeObjectToUniqueFile(filePath: string, obj: any): void {
    filePath = ensureUniqueFilePath(filePath);
    fs.writeFileSync(filePath, stringifyReadable(obj));
}

export function writeObjectToFile(filePath: string, obj: any): void {
    fs.writeFileSync(filePath, stringifyReadable(obj));
}

export function getCommandArgs(line: string | undefined): string[] {
    if (line !== undefined && line.length > 0) {
        const args = parseCommandLine(line);
        if (args !== null && args.length > 0) {
            if (args[0].startsWith("@")) {
                args.shift();
            }
            return args;
        }
    }
    return [];
}

export function dateRangeToTimeRange(
    range: dateTime.DateRange,
): dateTime.TimestampRange {
    return {
        startTimestamp: range.startDate.toISOString(),
        endTimestamp: range.stopDate ? range.stopDate.toISOString() : undefined,
    };
}

export async function execCommandLine<T>(
    line: string,
    cb: (args: string[], cmdLine: string) => Promise<Result<T>>,
): Promise<Result<T>> {
    const args = parseCommandLine(line);
    if (args !== null && args.length > 0) {
        if (args[0].startsWith("@")) {
            args.shift();
        }
        if (args && args.length > 0) {
            return await cb(args, line);
        }
    }

    return error("No args");
}

export async function runTestBatch<T>(
    batchFilePath: string,
    cmdHandler: (cmd: string, args: string[]) => Promise<Result<T>>,
    destFilePath?: string,
    cb?: BatchCallback<Result<T>>,
    stopOnError: boolean = false,
): Promise<Result<T[]>> {
    const batchLines = getBatchFileLines(batchFilePath);
    const results: T[] = [];
    for (let i = 0; i < batchLines.length; ++i) {
        const cmd = batchLines[i];
        const args = getCommandArgs(cmd);
        if (args.length === 0) {
            continue;
        }
        let response = await cmdHandler(cmd, args);
        if (!response.success) {
            response = queryError(cmd, response);
        }
        if (cb) {
            cb(response, i, batchLines.length);
        }
        if (response.success) {
            results.push(response.data);
        } else if (stopOnError) {
            return response;
        }
    }
    if (destFilePath) {
        await writeJsonFile(destFilePath, results);
    }
    return success(results);
}

export function argSourceFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to source file",
        type: "path",
        defaultValue,
    };
}

export function addFileNameSuffixToPath(sourcePath: string, suffix: string) {
    return path.join(
        path.dirname(sourcePath),
        getFileName(sourcePath) + suffix,
    );
}

const IndexFileSuffix = "_index.json";
export function sourcePathToMemoryIndexPath(
    sourcePath: string,
    indexFilePath?: string,
): string {
    return (
        indexFilePath ?? addFileNameSuffixToPath(sourcePath, IndexFileSuffix)
    );
}

export function memoryNameToIndexPath(
    basePath: string,
    memoryName: string,
): string {
    return path.join(basePath, memoryName + IndexFileSuffix);
}

export function shouldParseRequest(
    obj: string[] | NamedArgs | any,
): obj is string[] | NamedArgs {
    return Array.isArray(obj) || isNamedArgs(obj);
}

function isNamedArgs(obj: any): obj is NamedArgs {
    if (typeof obj === "object") {
        const na = obj as NamedArgs;
        return na.bind !== undefined && na.value !== undefined;
    }

    return false;
}

export function isJsonEqual(x: any | undefined, y: any | undefined): boolean {
    if (x === undefined && y === undefined) {
        return true;
    } else if (x !== undefined && y !== undefined) {
        const jx = JSON.stringify(x);
        const jy = JSON.stringify(y);
        return jx === jy;
    }
    return false;
}

export function compareObject(
    x: any,
    y: any,
    label: string,
): string | undefined {
    if (isUndefinedOrEmpty(x) && isUndefinedOrEmpty(y)) {
        return undefined;
    }
    if (typeof x === "object" || typeof y === "object") {
        if (!isJsonEqual(x, y)) {
            return `${label}: ${stringifyReadable(x)}\n !== \n${stringifyReadable(y)}`;
        }
    } else if (x !== y) {
        return `${label}: ${x} !== ${y}`;
    }
    return undefined;
}

export async function compareObjectFuzzy(
    x: any,
    y: any,
    label: string,
    similarityModel: TextEmbeddingModel,
    threshold = 0.9,
): Promise<string | undefined> {
    // First do a straight compare
    let error = compareObject(x, y, label);
    if (error === undefined) {
        return undefined;
    }
    // Try compare again.. fuzzily
    return compareStringFuzzy(
        stringifyReadable(x),
        stringifyReadable(y),
        label,
        similarityModel,
        threshold,
    );
}

export function compareNumberArray(
    x: number[] | undefined,
    y: number[] | undefined,
    label: string,
    sort = true,
): string | undefined {
    if (isUndefinedOrEmpty(x) && isUndefinedOrEmpty(y)) {
        return undefined;
    }
    if (x === undefined || y === undefined || x.length != y.length) {
        return `${label}: length mismatch`;
    }
    if (sort) {
        const sortFn = (a: number, b: number) => a - b;
        x = [...x].sort(sortFn);
        y = [...y].sort(sortFn);
    }
    for (let i = 0; i < x.length; ++i) {
        if (x[i] !== y[i]) {
            return `${label}: [${i}] ${x[i]} !== ${y[i]}`;
        }
    }
    return undefined;
}

export function compareStringArray(
    x: string[] | undefined,
    y: string[] | undefined,
    label: string,
    sort = true,
    cmpFuzzy?: (x: string, y: string) => boolean,
): string | undefined {
    if (isUndefinedOrEmpty(x) && isUndefinedOrEmpty(y)) {
        return undefined;
    }
    if (x === undefined || y === undefined || x.length != y.length) {
        return `${label}: length mismatch`;
    }

    if (sort) {
        const sortFn = (a: string, b: string) =>
            collections.stringCompare(a, b, false);
        x = [...x].sort(sortFn);
        y = [...y].sort(sortFn);
    }
    for (let i = 0; i < x.length; ++i) {
        if (collections.stringCompare(x[i], y[i], false) !== 0) {
            if (!cmpFuzzy || !cmpFuzzy(x[i], y[i])) {
                return `${label}: [${i}] ${x[i]} !== ${y[i]}`;
            }
        }
    }
    return undefined;
}

export async function compareStringFuzzy(
    x: string | undefined,
    y: string | undefined,
    label: string,
    similarityModel: TextEmbeddingModel,
    threshold: number = 0.9,
): Promise<string | undefined> {
    if (x !== y) {
        if (x !== undefined && y !== undefined) {
            if (x.toLowerCase() === y.toLowerCase()) {
                return undefined;
            }
            // Strings definitely not equal. Try a fuzzy comparison
            const embeddings = await generateTextEmbeddingsWithRetry(
                similarityModel,
                [x, y],
            );
            const similarity = dotProduct(embeddings[0], embeddings[1]);
            if (similarity >= threshold) {
                return undefined;
            }
            return `${label}: ${x} !== ${y}\n$[${similarity} < ${threshold}]`;
        }
        return `${label}: ${x} !== ${y}`;
    }

    return undefined;
}

export function compareArray<T = any>(
    x: T[] | undefined,
    y: T[] | undefined,
    label: string,
    comparer: (x: T, y: T) => string | undefined,
): ComparisonResult {
    if (isUndefinedOrEmpty(x) && isUndefinedOrEmpty(y)) {
        return undefined;
    }
    if (x === undefined || y === undefined || x.length != y.length) {
        return `${label}: length mismatch`;
    }
    for (let i = 0; i < x.length; ++i) {
        let error = comparer(x[i], y[i]);
        if (error !== undefined) {
            return error;
        }
    }
    return undefined;
}

export function isUndefinedOrEmpty(x?: any): boolean {
    if (x === undefined) {
        return true;
    }
    if (Array.isArray(x)) {
        return x.length === 0;
    }
    if (typeof x === "string") {
        return x.length === 0;
    }
    return false;
}

export function queryError(query: string, result: Error): Error {
    return error(`${query}\n${result.message}`);
}

export function stringifyReadable(value: any): string {
    return JSON.stringify(value, undefined, 2);
}

export function isStem(x: string, y: string, stemLength = 2) {
    return x.startsWith(y) && x.length - y.length <= stemLength;
}
