// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { loadMemoryServerConfig } from "../src/config.js";

describe("agent-memory configuration", () => {
    test("uses standalone defaults", () => {
        expect(loadMemoryServerConfig([], {}, "C:\\memory-test")).toEqual({
            databasePath: path.resolve("C:\\memory-test", "agent-memory.db"),
            logLevel: "info",
        });
    });

    test("command-line values override environment values", () => {
        const config = loadMemoryServerConfig(
            [
                "--database",
                "cli.db",
                "--allowed-scope",
                "workspace:demo",
                "--log-level",
                "debug",
            ],
            {
                AGENT_MEMORY_DATABASE: "environment.db",
                AGENT_MEMORY_ALLOWED_SCOPE: "workspace:other",
                AGENT_MEMORY_LOG_LEVEL: "error",
            },
            "C:\\memory-test",
        );

        expect(config).toEqual({
            databasePath: path.resolve("C:\\memory-test", "cli.db"),
            allowedScope: "workspace:demo",
            logLevel: "debug",
        });
    });

    test("rejects unknown arguments", () => {
        expect(() =>
            loadMemoryServerConfig(["--typeagent-config", "config.yaml"]),
        ).toThrow("Unknown argument: --typeagent-config");
    });
});
