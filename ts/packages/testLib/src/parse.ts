// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CommandArgs = {
    args?: string[] | undefined;
    namedArgs?: Record<string, string> | undefined;
};

/**
 * Parse command line styled args
 * Handles both named and unnamed args
 * Unnamed parameters are anything before the first named arg
 * @param text
 */
export function parseCommandArgs(line: string): CommandArgs {
    const namedArgsStartAt = line.indexOf("--");
    let argPart =
        namedArgsStartAt >= 0 ? line.slice(0, namedArgsStartAt) : line;
    let namedArgPart =
        namedArgsStartAt >= 0 ? line.slice(namedArgsStartAt) : undefined;

    const commandArgs: CommandArgs = {};
    let match;
    if (argPart) {
        const argsRegex = /(?:(?<arg>\w+)|"(?<argQ>[^"]+)")/g;
        while ((match = argsRegex.exec(argPart)) !== null) {
            const arg = match.groups?.arg ?? match.groups?.argQ;
            if (arg) {
                commandArgs.args ??= [];
                commandArgs.args.push(arg);
            }
        }
    }
    if (namedArgPart) {
        const namedArgsRegEx =
            /--(?<key>\w+)\s+(?:(?<value>\w+)|"(?<valueQ>[^"]+)")/g;
        while ((match = namedArgsRegEx.exec(namedArgPart)) !== null) {
            const key = match.groups?.key;
            const value = match.groups?.value ?? match.groups?.valueQ;
            if (key && value) {
                commandArgs.namedArgs ??= {};
                commandArgs.namedArgs[key] = value;
            }
        }
    }
    return commandArgs;
}
