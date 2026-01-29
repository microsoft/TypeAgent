// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { debugShell } from "./debug.js";

type ShellCommandLineArgs = {
    reset: boolean;
    clean: boolean;
    test: boolean;
    prod?: boolean;
    update?: string;
    data?: string;
    env?: string;
    mockGreetings?: boolean;
    inputOnly?: boolean;
    connect?: number;
};

export function parseShellCommandLine() {
    const result: ShellCommandLineArgs = {
        reset: false,
        clean: false,
        test: false,
    };
    for (let i = 1; i < process.argv.length; i++) {
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
                if (
                    i < process.argv.length ||
                    process.argv[i].startsWith("--")
                ) {
                    result.env = process.argv[i];
                } else {
                    debugShell("Missing value for --env argument");
                }
                continue;
            }

            if (arg === "--update") {
                i++;
                if (
                    i < process.argv.length ||
                    process.argv[i].startsWith("--")
                ) {
                    result.update = process.argv[i];
                } else {
                    debugShell("Missing value for --update argument");
                }
                continue;
            }

            if (arg === "--data") {
                i++;
                if (
                    i < process.argv.length ||
                    process.argv[i].startsWith("--")
                ) {
                    result.data = process.argv[i];
                } else {
                    debugShell("Missing value for --data argument");
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

            if (arg === "--test") {
                result.test = true;
                continue;
            }

            if (arg === "--mock-greetings") {
                result.mockGreetings = true;
                continue;
            }

            if (arg === "--input-only") {
                result.inputOnly = true;
                continue;
            }
            if (arg === "--connect") {
                i++;
                if (
                    i < process.argv.length &&
                    !process.argv[i].startsWith("--")
                ) {
                    const port = parseInt(process.argv[i]);

                    if (
                        isNaN(port) ||
                        port.toString() !== process.argv[i] ||
                        port <= 0 ||
                        port > 65535
                    ) {
                        debugShell(
                            `Invalid number value '${process.argv[i]}' for --connect argument`,
                        );
                    } else {
                        result.connect = port;
                    }
                } else {
                    result.connect = 8999; // default port
                }
                continue;
            }
        }

        debugShell("Unknown command line argument", arg);
    }

    if (result.connect !== undefined) {
        if (result.data !== undefined) {
            debugShell("--data ignored with --connect");
        }
        if (result.clean) {
            debugShell("--clean ignored with --connect");
        }
        if (result.reset) {
            debugShell("--reset ignored with --connect");
        }
    }
    return result;
}
