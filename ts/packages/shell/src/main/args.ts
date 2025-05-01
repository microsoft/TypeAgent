// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { debugShell } from "./debug.js";

type ShellCommandLineArgs = {
    reset: boolean;
    env?: string;
};

export function parseShellCommandLine() {
    const result: ShellCommandLineArgs = {
        reset: false,
    };
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith("--")) {
            if (arg === "--reset") {
                result.reset = true;
                continue;
            }

            if (arg === "--env") {
                i++;
                if (i < process.argv.length) {
                    result.env = process.argv[i];
                } else {
                    debugShell("Missing value for --env argument");
                }
                continue;
            }
        }

        debugShell("Unknown command line argument", arg);
    }
    return result;
}
