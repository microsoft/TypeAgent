// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPowerShellExecutionGates } from "../src/config/executionGates.mjs";
import {
    executeReviewedStaticScript,
    executeScript,
} from "../src/execution/powershellRunner.mjs";

const itOnWindows = process.platform === "win32" ? it : it.skip;

describe("PowerShell execution gates", () => {
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const originalConfigDefaults = process.env.TYPEAGENT_CONFIG_DEFAULTS;
    const originalConfigLocal = process.env.TYPEAGENT_CONFIG_LOCAL;
    const originalDotEnv = process.env.TYPEAGENT_DOTENV;
    let configDirectory: string;

    beforeEach(async () => {
        configDirectory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-gates-"),
        );
        process.env.TYPEAGENT_CONFIG_DIR = configDirectory;
        delete process.env.TYPEAGENT_CONFIG_DEFAULTS;
        delete process.env.TYPEAGENT_CONFIG_LOCAL;
        delete process.env.TYPEAGENT_DOTENV;
    });

    afterEach(async () => {
        if (originalConfigDir === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DIR;
        } else {
            process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
        }
        if (originalConfigDefaults === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DEFAULTS;
        } else {
            process.env.TYPEAGENT_CONFIG_DEFAULTS = originalConfigDefaults;
        }
        if (originalConfigLocal === undefined) {
            delete process.env.TYPEAGENT_CONFIG_LOCAL;
        } else {
            process.env.TYPEAGENT_CONFIG_LOCAL = originalConfigLocal;
        }
        if (originalDotEnv === undefined) {
            delete process.env.TYPEAGENT_DOTENV;
        } else {
            process.env.TYPEAGENT_DOTENV = originalDotEnv;
        }
        await rm(configDirectory, { recursive: true, force: true });
    });

    it("defaults dynamic execution to disabled", () => {
        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled for an explicit false value", async () => {
        await writeFile(
            join(configDirectory, "config.defaults.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: false\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled when configuration is malformed", async () => {
        await writeFile(
            join(configDirectory, "config.defaults.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell: [\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: false },
        });
    });

    it("keeps dynamic execution disabled when configuration is unreadable", async () => {
        await writeFile(
            join(configDirectory, "config.defaults.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );
        process.env.TYPEAGENT_CONFIG_LOCAL = configDirectory;

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: false },
        });
    });

    it("does not enable dynamic execution from legacy .env", async () => {
        await writeFile(
            join(configDirectory, ".env"),
            "POWERSHELL_DYNAMICEXECUTION_ENABLED=1\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: false },
        });
    });

    it("enables dynamic execution only for an explicit true value", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: true },
        });
    });

    it("allows an explicit true value in defaults YAML", async () => {
        await writeFile(
            join(configDirectory, "config.defaults.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: false },
            dynamicExecution: { enabled: true },
        });
    });

    it("enables broker execution only for an explicit YAML true value", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  brokerExecution:\n    enabled: true\n",
        );

        expect(getPowerShellExecutionGates()).toEqual({
            brokerExecution: { enabled: true },
            dynamicExecution: { enabled: false },
        });
    });

    it("denies dynamic execution when the broker gate is disabled", async () => {
        await writeFile(
            join(configDirectory, "config.local.yaml"),
            "powershell:\n  dynamicExecution:\n    enabled: true\n",
        );

        const result = await executeScript({
            script: "Write-Output 'should not run'",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        });

        expect(result).toMatchObject({
            success: false,
            stdout: "",
            stderr: expect.stringMatching(/broker execution is disabled/i),
        });
    });

    it("denies direct dynamic runner calls when execution is disabled", async () => {
        const result = await executeScript({
            script: "Write-Output 'should not run'",
            parameters: {},
            provenance: "generated",
            sandbox: {
                allowedCmdlets: ["Write-Output"],
                allowedPaths: [],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        });

        expect(result).toMatchObject({
            success: false,
            stdout: "",
            stderr: expect.stringMatching(
                /denied dynamic script execution because it is disabled/i,
            ),
        });
    });

    itOnWindows(
        "allows direct dynamic runner calls with an explicit YAML opt-in",
        async () => {
            await writeFile(
                join(configDirectory, "config.local.yaml"),
                "powershell:\n  dynamicExecution:\n    enabled: true\n  brokerExecution:\n    enabled: true\n",
            );

            const result = await executeScript({
                script: "Write-Output 'ran'",
                parameters: {},
                provenance: "generated",
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: 10,
                    networkAccess: false,
                },
            });

            expect(result).toMatchObject({
                success: true,
                stdout: expect.stringMatching(/^ran\s*$/),
                stderr: "",
            });
        },
    );

    itOnWindows(
        "keeps reviewed static runner calls available while dynamic execution is disabled",
        async () => {
            const result = await executeReviewedStaticScript({
                script: "Write-Output 'reviewed'",
                parameters: {},
                sandbox: {
                    allowedCmdlets: ["Write-Output"],
                    allowedPaths: [],
                    allowedModules: [],
                    maxExecutionTime: 10,
                    networkAccess: false,
                },
            });

            expect(result).toMatchObject({
                success: true,
                stdout: expect.stringMatching(/^reviewed\s*$/),
                stderr: "",
            });
        },
    );
});
