// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Command = {
    name: string;
    args?: string[];
};

export function parseCommandLine(line: string): Command | undefined {
    if (line.length == 0) {
        return undefined;
    }

    const args = line.split(/\s+/);
    if (args.length == 0) {
        return undefined;
    }

    const cmd: Command = {
        name: args[0],
    };
    args.shift();
    cmd.args = args;
    return cmd;
}
