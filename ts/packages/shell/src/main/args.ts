// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { debugShell } from "./debug.js";

type ShellCommandLineArgs = {
    reset: boolean;
    clean: boolean;
    prod?: boolean;
    update?: string;
    data?: string;
    env?: string;
};

export function parseShellCommandLine() {
    const result: ShellCommandLineArgs = {
        reset: false,
        clean: false,
    };
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith("--")) {
            if (arg === "--reset") {
                result.reset = true;
                continue;
            }

            if (arg === "--clean") {
                result.clean = true;
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

            if (arg === "--update") {
                i++;
                if (i < process.argv.length) {
                    result.update = process.argv[i];
                } else {
                    debugShell("Missing value for --update argument");
                }
                continue;
            }

            if (arg === "--data") {
                i++;
                if (i < process.argv.length) {
                    result.data = process.argv[i];
                } else {
                    debugShell("Missing value for --dir argument");
                }
                continue;
            }

            if (arg === "--prod") {
                result.prod = true;
                continue;
            }

            if (arg === "--dev") {
                result.prod = false;
                continue;
            }
        }

        debugShell("Unknown command line argument", arg);
    }
    return result;
}
