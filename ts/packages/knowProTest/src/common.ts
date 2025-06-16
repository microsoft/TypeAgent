// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { ArgDef, NamedArgs, parseCommandLine } from "interactive-app";
import path from "path";
import { getFileName } from "typeagent";
import { error, Result } from "typechat";

export function ensureDirSync(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    return folderPath;
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

export function isNamedArgs(obj: any): obj is NamedArgs {
    if (typeof obj === "object") {
        const na = obj as NamedArgs;
        return na.bind !== undefined && na.value !== undefined;
    }

    return false;
}
