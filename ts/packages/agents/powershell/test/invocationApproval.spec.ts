// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { approveInvocation } from "../src/execution/invocationApproval.mjs";
import type { ScriptExecutionRequest } from "../src/execution/powershellRunner.mjs";
import { PowerShellIntegrityError } from "@typeagent/agent-flows/powershell/integrity";

function request(): ScriptExecutionRequest {
    return {
        script: "param([string]$Value)\r\nWrite-Output $Value\n",
        parameters: { Value: "$env:SYNTHETIC_SECRET" },
        provenance: "generated",
        sandbox: {
            allowedCmdlets: ["Write-Output"],
            allowedPaths: [],
            allowedModules: [],
            maxExecutionTime: 30,
            networkAccess: false,
        },
    };
}

describe("PowerShell invocation approval", () => {
    it("fails closed without an interaction", async () => {
        expect(await approveInvocation(request())).toMatchObject({
            failure: { errorCode: "powershell.approvalRequired" },
        });
    });

    it.each([0, -1, 2, NaN])(
        "rejects non-affirmative choice %s",
        async (choice) => {
            expect(
                await approveInvocation({
                    ...request(),
                    requestApproval: async () => choice,
                }),
            ).toMatchObject({
                failure: { errorCode: "powershell.approvalDenied" },
            });
        },
    );

    it("surfaces an unavailable interaction instead of executing", async () => {
        expect(
            await approveInvocation({
                ...request(),
                requestApproval: async () => {
                    throw new Error("client disconnected");
                },
            }),
        ).toMatchObject({
            failure: {
                errorCode: "powershell.approvalRequired",
                stderr: expect.stringContaining("client disconnected"),
            },
        });
    });

    it("shows exact script, arguments and effective policy on every invocation", async () => {
        const candidate = request();
        const prompt = jest.fn(async (_message: string) => 1);
        candidate.requestApproval = prompt;
        const first = await approveInvocation(candidate);
        const second = await approveInvocation(candidate);
        expect(first).toHaveProperty("snapshot");
        expect(second).toHaveProperty("snapshot");
        expect(prompt).toHaveBeenCalledTimes(2);
        const message = prompt.mock.calls[0]?.[0];
        expect(message).toContain(candidate.script);
        expect(message).toContain("$env:SYNTHETIC_SECRET");
        expect(message).toContain("Network: denied");
        expect(message).toContain("Child processes: denied");
        expect(message).toContain("Timeout: 30 seconds");
        expect(message).toContain("Private sandbox scratch directory");
        if ("snapshot" in first && first.snapshot) {
            candidate.script = "Write-Output 'replaced'";
            candidate.parameters.Value = "replaced";
            expect(first.snapshot.script).not.toContain("replaced");
            expect(first.snapshot.parameters.Value).toBe(
                "$env:SYNTHETIC_SECRET",
            );
        }
    });

    it.each(["script", "parameters", "policy"])(
        "rejects %s changes while approval is pending",
        async (field) => {
            const candidate = request();
            candidate.requestApproval = async () => {
                if (field === "script") candidate.script += " ";
                if (field === "parameters") {
                    candidate.parameters.Value = "changed";
                }
                if (field === "policy") candidate.sandbox.maxExecutionTime = 40;
                return 1;
            };
            expect(await approveInvocation(candidate)).toMatchObject({
                failure: { errorCode: "powershell.stalePlan" },
            });
        },
    );

    it("rejects a concurrently edited persisted revision", async () => {
        expect(
            await approveInvocation({
                ...request(),
                requestApproval: async () => 1,
                assertCurrent: async () => {
                    throw new PowerShellIntegrityError("Revision changed.");
                },
            }),
        ).toMatchObject({ failure: { errorCode: "powershell.stalePlan" } });
    });

    it("does not reuse approval after cancellation", async () => {
        const controller = new AbortController();
        const candidate = {
            ...request(),
            abortSignal: controller.signal,
            requestApproval: async () => {
                controller.abort();
                return 1;
            },
        };
        expect(await approveInvocation(candidate)).toMatchObject({
            failure: { errorCode: "powershell.cancelled", cancelled: true },
        });
    });
});
