// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPowerShellExecutionGates } from "../src/config/executionGates.mjs";

describe("PowerShell execution gates", () => {
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const originalConfigLocal = process.env.TYPEAGENT_CONFIG_LOCAL;
    let configDirectory: string;

    beforeEach(async () => {
        configDirectory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-gates-"),
        );
        process.env.TYPEAGENT_CONFIG_DIR = configDirectory;
        delete process.env.TYPEAGENT_CONFIG_LOCAL;
    });

    afterEach(async () => {
        if (originalConfigDir === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DIR;
        } else {
            process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
        }
        if (originalConfigLocal === undefined) {
            delete process.env.TYPEAGENT_CONFIG_LOCAL;
        } else {
            process.env.TYPEAGENT_CONFIG_LOCAL = originalConfigLocal;
        }
        await rm(configDirectory, { recursive: true, force: true });
    });

    it("defaults dynamic execution to disabled", () => {
        expect(getPowerShellExecutionGates()).toEqual({
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled for an explicit false value", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: false\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled when configuration is malformed", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell: [\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled when configuration is unreadable", () => {
        process.env.TYPEAGENT_CONFIG_LOCAL = configDirectory;

        expect(getPowerShellExecutionGates()).toEqual({
            dynamicExecution: { enabled: false },
        });
    });

    it("enables dynamic execution only for an explicit true value", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            dynamicExecution: { enabled: true },
        });
    });
});
