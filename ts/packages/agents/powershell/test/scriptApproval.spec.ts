// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import type { SessionContext } from "@typeagent/agent-sdk";
import {
    authorizeLocalScript,
    consumeScriptApproval,
    revokeScriptApprovals,
    scriptApprovalStatus,
    type ScriptApprovalContext,
} from "../src/execution/scriptApproval.mjs";

function fixture(choice = 1) {
    const popupQuestion = jest.fn<SessionContext["popupQuestion"]>(
        async () => choice,
    );
    const sessionContext = {
        sessionContextId: randomUUID(),
        currentConnectionId: "client-one",
        popupQuestion,
        requestSecurityApproval: ({
            message,
            choices,
            defaultId,
        }: import("@typeagent/agent-sdk").SecurityApprovalRequest) =>
            popupQuestion(message, choices, defaultId),
    };
    const context: ScriptApprovalContext = {
        sessionContext,
        allowSessionReuse: true,
        definition: {
            actionName: "greeting",
            displayName: "Greeting",
            description: "Print a greeting",
            parameters: [
                {
                    name: "Name",
                    type: "string",
                    required: true,
                    description: "Name",
                },
            ],
            grammarPatterns: [],
        },
    };
    const request = {
        script: 'param([string]$Name)\nWrite-Output "Hello, $Name"',
        parameters: { Name: "Ada" },
        maxExecutionTime: 30,
        requiredModules: [] as string[],
        workingDirectory: process.cwd(),
    };
    return { context, sessionContext, popupQuestion, request };
}

describe("approved local script authorization", () => {
    it("never falls back to a model-answerable popup", async () => {
        const { context, request, popupQuestion } = fixture(0);
        delete context.sessionContext.requestSecurityApproval;
        await expect(authorizeLocalScript(request, context)).rejects.toThrow(
            "security approval channel",
        );
        expect(popupQuestion).not.toHaveBeenCalled();
    });

    it("shares approvals and revocation across RPC shims with the same host lifetime", async () => {
        const { context, request, popupQuestion } = fixture(1);
        const first = await authorizeLocalScript(request, context);
        const other = {
            ...context,
            sessionContext: { ...context.sessionContext },
        };
        const second = await authorizeLocalScript(request, other);
        expect(popupQuestion).toHaveBeenCalledTimes(1);
        revokeScriptApprovals(other.sessionContext);
        expect(consumeScriptApproval(first!, context)).toBe(false);
        expect(consumeScriptApproval(second!, other)).toBe(false);
        await authorizeLocalScript(request, context);
        expect(popupQuestion).toHaveBeenCalledTimes(2);
    });

    it("does not reuse authorization in a different session lifetime", async () => {
        const { context, request, popupQuestion } = fixture(1);
        await authorizeLocalScript(request, context);
        context.sessionContext = {
            ...context.sessionContext,
            sessionContextId: randomUUID(),
        };
        await authorizeLocalScript(request, context);
        expect(popupQuestion).toHaveBeenCalledTimes(2);
    });

    it("requires another decision when module dependencies change", async () => {
        const { context, request, popupQuestion } = fixture(1);
        await authorizeLocalScript(
            { ...request, requiredModules: ["One"] },
            context,
        );
        await authorizeLocalScript(
            { ...request, requiredModules: ["Two"] },
            context,
        );
        expect(popupQuestion).toHaveBeenCalledTimes(2);
    });

    it.each(["unverified", "changed"] as const)(
        "identifies %s stored versions in the summary",
        async (revisionStatus) => {
            const { context, request, popupQuestion } = fixture(0);
            await authorizeLocalScript({ ...request, revisionStatus }, context);
            expect(popupQuestion.mock.calls[0][0]).toContain(
                revisionStatus === "unverified"
                    ? "no recorded fingerprint"
                    : "differs from its recorded fingerprint",
            );
        },
    );

    it.each([-1, 2, 10, NaN])(
        "rejects non-approval response %s",
        async (choice) => {
            const { context, request } = fixture(choice);
            await expect(
                authorizeLocalScript(request, context),
            ).resolves.toBeUndefined();
            expect(scriptApprovalStatus(context, request.script)).toContain(
                "Not approved",
            );
        },
    );

    it("shows a compact summary with arguments, authority, and a cancellation default", async () => {
        const { context, request, popupQuestion } = fixture(0);
        await authorizeLocalScript(request, context);
        expect(popupQuestion).toHaveBeenCalledWith(
            expect.stringContaining('Run PowerShell flow "greeting"?'),
            [
                "Run once",
                "Allow this exact invocation for this session",
                "Cancel",
                "Review script and details",
            ],
            2,
        );
        expect(popupQuestion).toHaveBeenCalledWith(
            expect.stringContaining("NOT a sandbox"),
            expect.any(Array),
            2,
        );
        expect(popupQuestion).toHaveBeenCalledWith(
            expect.stringContaining('Arguments: {"Name":"Ada"}'),
            expect.any(Array),
            2,
        );
        const summary = popupQuestion.mock.calls[0][0];
        expect(summary).toContain(`Folder: ${request.workingDirectory}`);
        expect(summary).not.toContain(request.script);
        expect(summary).not.toContain("SHA-256");
        expect(summary).not.toContain("Definition (JSON)");
        expect(summary.length).toBeLessThan(600);
        expect(summary.split("\n")).toHaveLength(7);
    });

    it.each([true, false])(
        "provides complete review without granting authority (session reuse=%s)",
        async (allowSessionReuse) => {
            const { context, request, popupQuestion } = fixture();
            context.allowSessionReuse = allowSessionReuse;
            const reviewChoice = allowSessionReuse ? 3 : 2;
            const cancelChoice = allowSessionReuse ? 2 : 1;
            popupQuestion
                .mockResolvedValueOnce(reviewChoice)
                .mockResolvedValueOnce(cancelChoice);
            await expect(
                authorizeLocalScript(request, context),
            ).resolves.toBeUndefined();
            expect(popupQuestion).toHaveBeenCalledTimes(2);
            const [details, choices, defaultId] = popupQuestion.mock.calls[1];
            expect(details).toContain(request.script);
            expect(details).toContain(
                `Working directory: ${request.workingDirectory}`,
            );
            expect(details).toContain('"Name": "Ada"');
            expect(details).toContain("Version SHA-256:");
            expect(details).toContain("Account:");
            expect(details).toContain("Runtime:");
            expect(details).toContain("Timeout: 30 seconds");
            expect(details).toContain("Definition (JSON):");
            expect(details).toContain("NOT a sandbox");
            expect(choices?.[cancelChoice]).toBe("Cancel");
            expect(choices?.[reviewChoice]).toBe("Back to summary");
            expect(defaultId).toBe(cancelChoice);
            expect(scriptApprovalStatus(context, request.script)).toContain(
                "Not approved",
            );
        },
    );

    it("allows returning to the summary without approving", async () => {
        const { context, request, popupQuestion } = fixture();
        popupQuestion
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(3)
            .mockResolvedValueOnce(2);
        await expect(
            authorizeLocalScript(request, context),
        ).resolves.toBeUndefined();
        expect(popupQuestion).toHaveBeenCalledTimes(3);
        expect(popupQuestion.mock.calls[2]).toEqual(
            popupQuestion.mock.calls[0],
        );
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Not approved",
        );
    });

    it.each([0, 1])(
        "supports explicit approval from the details view (%s)",
        async (choice) => {
            const { context, request, popupQuestion } = fixture();
            popupQuestion
                .mockResolvedValueOnce(3)
                .mockResolvedValueOnce(choice);
            const approved = await authorizeLocalScript(request, context);
            if (!approved) throw new Error("Expected explicit approval");
            expect(approved).toEqual(request);
            expect(consumeScriptApproval(approved, context)).toBe(true);
            expect(scriptApprovalStatus(context, request.script)).toContain(
                choice === 1 ? "Version approved" : "Not approved",
            );
        },
    );

    it("bounds long summary fields and retains the complete data in review", async () => {
        const { context, request, popupQuestion } = fixture();
        context.definition.actionName = "long-name".repeat(200);
        request.workingDirectory += "\\folder".repeat(200);
        request.parameters.Name = "long-argument".repeat(200);
        request.script += "\n# " + "long-script".repeat(500);
        popupQuestion.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
        await authorizeLocalScript(request, context);
        const summary = popupQuestion.mock.calls[0][0];
        expect(summary.length).toBeLessThan(850);
        expect(summary.split("\n")).toHaveLength(7);
        expect(summary.match(/\[truncated; review details\]/g)).toHaveLength(3);
        expect(summary).toContain("NOT a sandbox");
        const details = popupQuestion.mock.calls[1][0];
        expect(details).toContain(context.definition.actionName);
        expect(details).toContain(request.workingDirectory);
        expect(details).toContain(request.parameters.Name);
        expect(details).toContain(request.script);
    });

    it("flags a changed version in the summary and retains both scripts in review", async () => {
        const { context, request, popupQuestion } = fixture();
        await authorizeLocalScript(request, context);
        const previous = request.script;
        request.script = "Write-Output 'replacement'";
        popupQuestion.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
        await expect(
            authorizeLocalScript(request, context),
        ).resolves.toBeUndefined();
        expect(popupQuestion.mock.calls[1][0]).toContain(
            "changed since approval",
        );
        expect(popupQuestion.mock.calls[2][0]).toContain(
            `Previously approved script:\n${previous}`,
        );
        expect(popupQuestion.mock.calls[2][0]).toContain(request.script);
    });

    it("does not remember run-once authorization", async () => {
        const { context, request, popupQuestion } = fixture(0);
        await authorizeLocalScript(request, context);
        await authorizeLocalScript(request, context);
        expect(popupQuestion).toHaveBeenCalledTimes(2);
    });

    it("uses single-use permits and cannot accept a serialized approval flag", async () => {
        const { context, request } = fixture(0);
        const approved = await authorizeLocalScript(request, context);
        expect(approved).toBeDefined();
        if (!approved) throw new Error("Expected approval");
        expect(
            consumeScriptApproval(
                JSON.parse(JSON.stringify(approved)),
                context,
            ),
        ).toBe(false);
        expect(consumeScriptApproval(approved, context)).toBe(true);
        expect(consumeScriptApproval(approved, context)).toBe(false);
    });

    it("checks revocation again at the launch boundary", async () => {
        const { context, request } = fixture(0);
        const approved = await authorizeLocalScript(request, context);
        if (!approved) throw new Error("Expected approval");
        revokeScriptApprovals(context.sessionContext);
        expect(consumeScriptApproval(approved, context)).toBe(false);
    });

    it("rejects modification of the authorized snapshot", async () => {
        const { context, request } = fixture(0);
        const approved = await authorizeLocalScript(request, context);
        if (!approved) throw new Error("Expected approval");
        approved.parameters.Name = "unreviewed";
        expect(consumeScriptApproval(approved, context)).toBe(false);
    });

    it("escapes terminal and bidirectional controls without changing executed code", async () => {
        const { context, request, popupQuestion } = fixture(0);
        request.script = "Write-Output '\u001b[2J\u202ehidden'";
        popupQuestion.mockResolvedValueOnce(3);
        const approved = await authorizeLocalScript(request, context);
        expect(approved?.script).toBe(request.script);
        expect(popupQuestion).toHaveBeenCalledWith(
            expect.stringContaining("\\u001b[2J\\u202e"),
            expect.any(Array),
            2,
        );
    });

    it("keeps summary fields on one line and makes controls visible", async () => {
        const { context, request, popupQuestion } = fixture(0);
        request.workingDirectory += "\\folder\n\t\u001b[2J\u202efake";
        request.parameters.Name = "value\n\u001b[2J";
        const approved = await authorizeLocalScript(request, context);
        const summary = popupQuestion.mock.calls[0][0];
        expect(summary.split("\n")).toHaveLength(7);
        expect(summary).toContain("folder\\n\\t\\u001b[2J\\u202efake");
        expect(summary).not.toContain("\u001b");
        expect(summary).not.toContain("\u202e");
        expect(approved?.parameters).toEqual(request.parameters);
    });

    it("requires fresh consent when a reasoning invocation sees a remembered version", async () => {
        const { context, request, popupQuestion } = fixture();
        await authorizeLocalScript(request, context);
        context.allowSessionReuse = false;
        popupQuestion.mockResolvedValue(1);
        await expect(
            authorizeLocalScript(request, context),
        ).resolves.toBeUndefined();
        expect(popupQuestion).toHaveBeenLastCalledWith(
            expect.stringContaining('Run PowerShell flow "greeting"?'),
            ["Run once", "Cancel", "Review script and details"],
            1,
        );
    });

    it("reuses only the exact approved invocation in the same session", async () => {
        const { context, request, popupQuestion } = fixture();
        await authorizeLocalScript(request, context);
        const snapshot = await authorizeLocalScript(request, context);
        expect(snapshot).toEqual(request);
        expect(popupQuestion).toHaveBeenCalledTimes(1);
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Version approved",
        );
    });

    it.each([
        "script",
        "arguments",
        "defaults",
        "grammar",
        "timeout",
        "directory",
    ] as const)(
        "requires new authorization when %s changes",
        async (change) => {
            const { context, request, popupQuestion } = fixture();
            await authorizeLocalScript(request, context);
            popupQuestion.mockResolvedValue(2);
            switch (change) {
                case "script":
                    request.script += "\nWrite-Output 'different'";
                    break;
                case "arguments":
                    request.parameters.Name = "Grace";
                    break;
                case "defaults":
                    context.definition.parameters[0].default = "changed";
                    break;
                case "grammar":
                    context.definition.grammarPatterns.push({
                        pattern: "another trigger",
                        isAlias: true,
                        examples: [],
                    });
                    break;
                case "timeout":
                    request.maxExecutionTime = 60;
                    break;
                case "directory":
                    request.workingDirectory += "\\another";
                    break;
            }
            await expect(
                authorizeLocalScript(request, context),
            ).resolves.toBeUndefined();
            expect(popupQuestion).toHaveBeenCalledTimes(2);
        },
    );

    it("executes the reviewed snapshot rather than mutable caller objects", async () => {
        const { context, request, popupQuestion } = fixture(0);
        const original = JSON.parse(JSON.stringify(request));
        popupQuestion.mockImplementation(async () => {
            request.script = "Write-Output 'replacement'";
            request.parameters.Name = "replacement";
            request.maxExecutionTime = 120;
            return 0;
        });
        await expect(authorizeLocalScript(request, context)).resolves.toEqual(
            original,
        );
    });

    it("reviews and executes the same snapshot even if the caller changes between views", async () => {
        const { context, request, popupQuestion } = fixture(0);
        const original = JSON.parse(JSON.stringify(request));
        popupQuestion.mockImplementationOnce(async () => {
            request.script = "Write-Output 'unreviewed'";
            request.parameters.Name = "changed";
            context.definition.description = "changed description";
            return 3;
        });
        const approved = await authorizeLocalScript(request, context);
        expect(approved).toEqual(original);
        const details = popupQuestion.mock.calls[1][0];
        expect(details).toContain(original.script);
        expect(details).not.toContain(request.script);
        expect(details).toContain("Print a greeting");
        expect(details).not.toContain("changed description");
    });

    it("does not remember or authorize after revocation during review", async () => {
        const { context, request, popupQuestion } = fixture();
        popupQuestion
            .mockResolvedValueOnce(3)
            .mockImplementationOnce(async () => {
                revokeScriptApprovals(context.sessionContext);
                return 1;
            });
        await expect(authorizeLocalScript(request, context)).rejects.toThrow(
            "scope changed",
        );
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Not approved",
        );
    });

    it("does not share approval with another client or session", async () => {
        const { context, request, sessionContext, popupQuestion } = fixture();
        await authorizeLocalScript(request, context);
        sessionContext.currentConnectionId = "client-two";
        await authorizeLocalScript(request, context);
        expect(popupQuestion).toHaveBeenCalledTimes(2);
        const other = fixture(2);
        await expect(
            authorizeLocalScript(request, other.context),
        ).resolves.toBeUndefined();
    });

    it("revokes remembered and pending approvals", async () => {
        const { context, request, popupQuestion } = fixture();
        await authorizeLocalScript(request, context);
        revokeScriptApprovals(context.sessionContext);
        popupQuestion.mockImplementation(async () => {
            revokeScriptApprovals(context.sessionContext);
            return 1;
        });
        await expect(authorizeLocalScript(request, context)).rejects.toThrow(
            "scope changed",
        );
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Not approved",
        );
    });

    it("cancels while waiting for a confirmation without accepting a late answer", async () => {
        const { context, request, popupQuestion } = fixture();
        popupQuestion.mockImplementation(() => new Promise<number>(() => {}));
        const controller = new AbortController();
        const approval = authorizeLocalScript(
            request,
            context,
            controller.signal,
        );
        const rejected = expect(approval).rejects.toThrow("cancelled by test");
        controller.abort(new Error("cancelled by test"));
        await rejected;
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Not approved",
        );
    });

    it("cancels while reviewing the details without granting authorization", async () => {
        const { context, request, popupQuestion } = fixture();
        const controller = new AbortController();
        popupQuestion
            .mockResolvedValueOnce(3)
            .mockImplementationOnce(async () => {
                controller.abort(new Error("cancelled during review"));
                return 1;
            });
        await expect(
            authorizeLocalScript(request, context, controller.signal),
        ).rejects.toThrow("cancelled during review");
        expect(popupQuestion).toHaveBeenCalledTimes(2);
        expect(scriptApprovalStatus(context, request.script)).toContain(
            "Not approved",
        );
    });
});
