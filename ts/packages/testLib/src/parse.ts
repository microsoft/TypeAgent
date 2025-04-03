// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CommandArgs = {
    args?: string[] | undefined;
    namedArgs?: Record<string, string> | undefined;
};
/**
 * Parse command line styled args
 * Handles both named and unnamed parameters
 * @param text
 */
export function parseCommandArgs(line: string): CommandArgs {
    const commandArgs: CommandArgs = {};
    const argsRegex = /(?:(?<arg>\w+)|"(?<argQ>[^"]+)")/g;
    let match;
    while ((match = argsRegex.exec(line)) !== null) {
        const arg = match.groups?.arg ?? match.groups?.argQ;
        if (arg) {
            commandArgs.args ??= [];
            commandArgs.args.push(arg);
        }
    }
    const namedArgsRegEx =
        /--(?<key>\w+)\s+(?:(?<value>\w+)|"(?<valueQ>[^"]+)")/g;
    while ((match = namedArgsRegEx.exec(line)) !== null) {
        const key = match.groups?.key;
        const value = match.groups?.value ?? match.groups?.valueQ;
        if (key && value) {
            commandArgs.namedArgs ??= {};
            commandArgs.namedArgs[key] = value;
        }
    }
    return commandArgs;
}
