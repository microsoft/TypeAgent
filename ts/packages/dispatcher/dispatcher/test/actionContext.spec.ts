// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActionContext } from "../src/execute/actionContext.js";

// Builds the minimal CommandHandlerContext surface that getActionContext and
// makeClientIOMessage touch for non-error display content.
function makeContext(workingDirectory?: string) {
    const calls: { type: string; mode?: string }[] = [];
    const context = {
        displayCount: 0,
        reasoningSourceIcon: undefined,
        collectCommandResult: false,
        currentOptions:
            workingDirectory === undefined ? undefined : { workingDirectory },
        metricsManager: undefined,
        agents: {
            getSessionContext: () => ({}) as any,
            isAppAgentName: () => false,
            getAppAgentEmoji: () => undefined,
        },
        clientIO: {
            setDisplayInfo: () => {},
            setDisplay: () => calls.push({ type: "set" }),
            appendDisplay: (_msg: any, mode: string) =>
                calls.push({ type: "append", mode }),
        },
    } as any;
    return { context, calls };
}

describe("getActionContext displayCount tracking", () => {
    const requestId = { requestId: "r1" } as any;
    const content = { type: "text" as const, content: "hi" };

    it("setDisplay increments displayCount", () => {
        const { context } = makeContext();
        const { actionContext } = getActionContext(
            "agent",
            context,
            requestId,
            0,
        );
        actionContext.actionIO.setDisplay(content);
        expect(context.displayCount).toBe(1);
    });

    it("appendDisplay in block/inline mode increments displayCount", () => {
        const { context } = makeContext();
        const { actionContext } = getActionContext(
            "agent",
            context,
            requestId,
            0,
        );
        actionContext.actionIO.appendDisplay(content, "block");
        actionContext.actionIO.appendDisplay(content, "inline");
        expect(context.displayCount).toBe(2);
    });

    it("appendDisplay defaults to a counted mode", () => {
        const { context } = makeContext();
        const { actionContext } = getActionContext(
            "agent",
            context,
            requestId,
            0,
        );
        actionContext.actionIO.appendDisplay(content);
        expect(context.displayCount).toBe(1);
    });

    it("transient status (temporary mode) does not increment displayCount", () => {
        const { context } = makeContext();
        const { actionContext } = getActionContext(
            "agent",
            context,
            requestId,
            0,
        );
        actionContext.actionIO.appendDisplay(content, "temporary");
        expect(context.displayCount).toBe(0);
    });

    it("exposes the host-authorized working directory", () => {
        const workingDirectory = "C:\\workspace";
        const { context } = makeContext(workingDirectory);
        const { actionContext } = getActionContext(
            "agent",
            context,
            requestId,
            0,
        );

        expect(actionContext.workingDirectory).toBe(workingDirectory);
    });
});
