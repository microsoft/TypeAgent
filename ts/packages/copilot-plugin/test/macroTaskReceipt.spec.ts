// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { ToolInvocation } from "@github/copilot-sdk";
import type { RecordingState } from "@typeagent/copilot-macros";
import { createMacroTaskReceiptTool } from "../src/extension/macro-task-receipt.js";

function claimedState(): RecordingState {
    return {
        status: "claimed",
        token: {
            id: "recording-token",
            status: "claimed",
            learning: true,
            sessionId: "root-session",
            promptHash: "prompt-hash",
            expiresAt: "2099-01-01T00:00:00.000Z",
        },
    };
}

function fixture(state = claimedState()) {
    const getState = jest.fn(async () => state);
    const tool = createMacroTaskReceiptTool(getState);
    const invocation: ToolInvocation = {
        sessionId: "root-session",
        toolCallId: "root-tool-call",
        toolName: tool.name,
        arguments: { summary: "Synthetic task completed." },
    };
    return {
        tool,
        state,
        getState,
        invocation,
        invoke: (input: unknown = invocation.arguments) =>
            tool.handler!(input as { summary: string }, invocation),
    };
}

describe("recorded task success attestation", () => {
    it("uses the SDK tool shape without permissions or terminal-turn overrides", () => {
        const { tool } = fixture();
        expect(tool.name).toBe("typeagent_recorded_task_succeeded");
        expect(tool.parameters).toMatchObject({
            type: "object",
            required: ["summary"],
            additionalProperties: false,
            properties: { summary: { minLength: 1, maxLength: 1024 } },
        });
        expect(tool.skipPermission).toBeUndefined();
        expect(tool.overridesBuiltInTool).toBeUndefined();
        expect(tool.isTerminal).toBeUndefined();
        expect(tool.description).toContain("does not independently verify");
    });

    it("returns exactly token-bound JSON and neither echoes nor mutates task data", async () => {
        const f = fixture();
        const before = structuredClone(f.state);
        await expect(f.invoke()).resolves.toEqual({
            resultType: "success",
            textResultForLlm: JSON.stringify({
                status: "succeeded",
                recordingTokenId: "recording-token",
                promptHash: "prompt-hash",
            }),
        });
        expect(f.getState).toHaveBeenCalledTimes(1);
        expect(f.state).toEqual(before);
    });

    it.each([
        undefined,
        null,
        "summary",
        {},
        { summary: 1 },
        { summary: "" },
        { summary: " \n\t " },
        { summary: "x".repeat(1025) },
        { summary: "done", recordingTokenId: "forged-token" },
    ])("rejects invalid input before reading state: %j", async (input) => {
        const f = fixture();
        await expect(
            Promise.resolve().then(() =>
                f.tool.handler!(input as { summary: string }, f.invocation),
            ),
        ).rejects.toThrow("Success receipt requires only a nonempty summary");
        expect(f.getState).not.toHaveBeenCalled();
    });

    it("accepts the maximum bounded summary without returning it", async () => {
        const f = fixture();
        await expect(
            f.invoke({ summary: "x".repeat(1024) }),
        ).resolves.toMatchObject({
            resultType: "success",
        });
    });

    it.each(["idle", "armed", "completed", "failed"] as const)(
        "rejects recording status %s",
        async (status) => {
            const f = fixture();
            f.state.status = status;
            await expect(f.invoke()).rejects.toThrow("claimed learning token");
        },
    );

    it.each([
        { status: "armed" },
        { learning: false },
        { learning: undefined },
        { sessionId: "another-session" },
        { id: "" },
        { promptHash: undefined },
        { promptHash: " " },
    ])("rejects an unbound or non-learning token: %j", async (override) => {
        const f = fixture();
        Object.assign(f.state.token!, override);
        await expect(f.invoke()).rejects.toThrow("claimed learning token");
    });

    it("rejects a missing token", async () => {
        const f = fixture({ status: "claimed" });
        await expect(f.invoke()).rejects.toThrow("claimed learning token");
    });

    it("propagates state lookup failure without inventing a receipt", async () => {
        const f = fixture();
        f.getState.mockRejectedValue(new Error("State unavailable"));
        await expect(f.invoke()).rejects.toThrow("State unavailable");
    });

    it("does not read state for a cancelled invocation", async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort(new Error("Receipt cancelled"));
        f.invocation.signal = controller.signal;
        await expect(f.invoke()).rejects.toThrow("Receipt cancelled");
        expect(f.getState).not.toHaveBeenCalled();
    });

    it("does not emit success if cancellation occurs during the state lookup", async () => {
        const f = fixture();
        const controller = new AbortController();
        f.invocation.signal = controller.signal;
        f.getState.mockImplementation(async () => {
            controller.abort(new Error("Receipt cancelled"));
            return f.state;
        });
        await expect(f.invoke()).rejects.toThrow("Receipt cancelled");
    });
});
