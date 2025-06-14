// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { parseCommandLine } from "interactive-app";
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
