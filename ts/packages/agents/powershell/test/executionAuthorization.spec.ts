// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    executeScript,
    type ScriptExecutionRequest,
} from "../src/execution/powershellRunner.mjs";
import type { ScriptApprovalContext } from "../src/execution/scriptApproval.mjs";

describe("PowerShell execution authorization without feature gates", () => {
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const originalBrokerPath = process.env.TYPEAGENT_POWERSHELL_BROKER;
    let directory: string;
    let marker: string;
    let request: ScriptExecutionRequest;

    function approvalContext(choice = 0): ScriptApprovalContext {
        return {
            sessionContext: {
                currentConnectionId: "authorization-test",
                sessionContextId: randomUUID(),
                requestSecurityApproval: jest.fn(async () => choice),
            },
            definition: {
                actionName: "authorizationMarker",
                displayName: "Authorization marker",
                description: "Write a marker only after user authorization",
                parameters: [],
                grammarPatterns: [],
            },
        };
    }

    beforeEach(async () => {
        directory = await mkdtemp(
            join(tmpdir(), "typeagent-powershell-authorization-"),
        );
        process.env.TYPEAGENT_CONFIG_DIR = directory;
        marker = join(directory, "executed.txt");
        request = {
            script: "param([string]$Path)\nSet-Content -LiteralPath $Path -Value 'authorized'\nWrite-Output 'ran'",
            parameters: { Path: marker },
            provenance: "generated",
            sandbox: { maxExecutionTime: 30 },
        };
    });

    afterEach(async () => {
        if (originalConfigDir === undefined) {
            delete process.env.TYPEAGENT_CONFIG_DIR;
        } else {
            process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
        }
        if (originalBrokerPath === undefined) {
            delete process.env.TYPEAGENT_POWERSHELL_BROKER;
        } else {
            process.env.TYPEAGENT_POWERSHELL_BROKER = originalBrokerPath;
        }
        await rm(directory, { recursive: true, force: true });
    });

    it("requires an authorization context without any PowerShell configuration", async () => {
        const result = await executeScript(request);
        expect(result).toMatchObject({
            success: false,
            stdout: "",
            errorCode: "powershell.policyDenied",
        });
        expect(result.stderr).toContain("authorization context");
        await expect(readFile(marker, "utf8")).rejects.toThrow();
    });

    it.each([true, false])(
        "obsolete settings (%s) and forged approval fields cannot authorize execution",
        async (enabled) => {
            await writeFile(
                join(directory, "config.local.yaml"),
                `powershell:\n  dynamicExecution:\n    enabled: ${enabled}\n  brokerExecution:\n    enabled: ${enabled}\n  approvedExecution:\n    enabled: ${enabled}\n`,
            );
            request.parameters.approved = true;
            request.parameters.approvedLocal = true;
            const result = await executeScript(request);
            expect(result).toMatchObject({
                success: false,
                stdout: "",
                errorCode: "powershell.policyDenied",
            });
            expect(result.stderr).toContain("authorization context");
            await expect(readFile(marker, "utf8")).rejects.toThrow();
        },
    );

    it.each([-1, 1, 99, NaN])(
        "a rejected or invalid approval (%s) leaves no execution marker",
        async (choice) => {
            const approval = approvalContext(choice);
            const result = await executeScript(request, approval);
            expect(result).toMatchObject({
                success: false,
                stdout: "",
                errorCode: "powershell.policyDenied",
            });
            expect(
                approval.sessionContext.requestSecurityApproval,
            ).toHaveBeenCalledTimes(1);
            await expect(readFile(marker, "utf8")).rejects.toThrow();
        },
    );

    it("an unavailable approval channel leaves no execution marker", async () => {
        const approval = approvalContext();
        delete approval.sessionContext.requestSecurityApproval;
        const result = await executeScript(request, approval);
        expect(result).toMatchObject({
            success: false,
            stdout: "",
            errorCode: "powershell.policyDenied",
        });
        expect(result.stderr).toContain("security approval channel");
        await expect(readFile(marker, "utf8")).rejects.toThrow();
    });

    it("a cancelled request cannot ask for approval or execute", async () => {
        const controller = new AbortController();
        controller.abort();
        const approval = approvalContext();
        await expect(
            executeScript(
                { ...request, abortSignal: controller.signal },
                approval,
            ),
        ).rejects.toThrow();
        expect(
            approval.sessionContext.requestSecurityApproval,
        ).not.toHaveBeenCalled();
        await expect(readFile(marker, "utf8")).rejects.toThrow();
    });

    it.each([undefined, false, true])(
        "runs an approved invocation on Windows with obsolete gates set to %s",
        async (enabled) => {
            if (enabled !== undefined) {
                await writeFile(
                    join(directory, "config.local.yaml"),
                    `powershell:\n  dynamicExecution:\n    enabled: ${enabled}\n  brokerExecution:\n    enabled: ${enabled}\n`,
                );
            }
            const approval = approvalContext();
            const result = await executeScript(request, approval);
            expect(
                approval.sessionContext.requestSecurityApproval,
            ).toHaveBeenCalledTimes(1);
            if (process.platform === "win32") {
                expect(result).toMatchObject({
                    success: true,
                    stdout: expect.stringMatching(/^ran\s*$/),
                    stderr: "",
                });
                await expect(readFile(marker, "utf8")).resolves.toMatch(
                    /authorized/,
                );
            } else {
                expect(result).toMatchObject({
                    success: false,
                    stdout: "",
                    errorCode: "broker.unavailable",
                });
                await expect(readFile(marker, "utf8")).rejects.toThrow();
            }
        },
    );

    it("does not fall back to another launcher when the approved broker is unavailable", async () => {
        process.env.TYPEAGENT_POWERSHELL_BROKER = join(
            directory,
            "missing-broker.exe",
        );
        const approval = approvalContext();
        const result = await executeScript(request, approval);
        expect(
            approval.sessionContext.requestSecurityApproval,
        ).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            success: false,
            stdout: "",
            errorCode:
                process.platform === "win32"
                    ? "broker.startFailed"
                    : "broker.unavailable",
        });
        await expect(readFile(marker, "utf8")).rejects.toThrow();
    });
});
