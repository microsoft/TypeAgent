// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

export type MemoryServerConfig = {
    databasePath: string;
    allowedScope?: string;
    logLevel: LogLevel;
};

export type ConfigEnvironment = {
    [key: string]: string | undefined;
    AGENT_MEMORY_DATABASE?: string;
    AGENT_MEMORY_ALLOWED_SCOPE?: string;
    AGENT_MEMORY_LOG_LEVEL?: string;
};

export function loadMemoryServerConfig(
    args: string[],
    environment: ConfigEnvironment = process.env,
    workingDirectory: string = process.cwd(),
): MemoryServerConfig {
    const options = parseArguments(args);
    const databasePath =
        options.databasePath ??
        environment.AGENT_MEMORY_DATABASE ??
        path.join(workingDirectory, "agent-memory.db");
    const allowedScope =
        options.allowedScope ?? environment.AGENT_MEMORY_ALLOWED_SCOPE;
    const logLevel = parseLogLevel(
        options.logLevel ?? environment.AGENT_MEMORY_LOG_LEVEL ?? "info",
    );

    return {
        databasePath: path.resolve(workingDirectory, databasePath),
        ...(allowedScope === undefined ? {} : { allowedScope }),
        logLevel,
    };
}

type ParsedArguments = {
    databasePath?: string;
    allowedScope?: string;
    logLevel?: string;
};

function parseArguments(args: string[]): ParsedArguments {
    const result: ParsedArguments = {};

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        const value = args[index + 1];

        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${argument}`);
        }

        switch (argument) {
            case "--database":
                result.databasePath = value;
                break;
            case "--allowed-scope":
                result.allowedScope = value;
                break;
            case "--log-level":
                result.logLevel = value;
                break;
            default:
                throw new Error(`Unknown argument: ${argument}`);
        }

        index++;
    }

    return result;
}

function parseLogLevel(value: string): LogLevel {
    switch (value) {
        case "error":
        case "warn":
        case "info":
        case "debug":
            return value;
        default:
            throw new Error(`Invalid log level: ${value}`);
    }
}
