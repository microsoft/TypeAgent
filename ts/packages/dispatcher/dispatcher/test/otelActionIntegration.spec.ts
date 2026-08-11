// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration coverage for the executeAction call site. Verifies that the
 * `typeagent.action` span classifications the wrapper contract exposes
 * (`action.setup.failed`, `action.result.error`, `ActionHandlerError`,
 * `AbortError`, and the plain-success unset status) are wired correctly by
 * actionHandlers.ts across the branches the review pass called out:
 *
 *   - handler_missing (no `executeAction` on the AppAgent)
 *   - a thrown handler exception (only `ActionHandlerError`, no
 *     `action.result.error` piggyback)
 *   - typed `ActionResult.error` returns (bounded `action.result.error`)
 *   - flow-interpreter throws that never reached the handler
 *   - auto-setup replacement results (status remains UNSET)
 *   - cancellation via AbortSignal
 *   - parentage under the active `typeagent.request` span
 *
 * The systemContext used here is a minimal typed fake sufficient to route
 * through `executeAction`; it does not exercise the full dispatcher
 * pipeline.
 */

import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";
import { SpanStatusCode } from "@opentelemetry/api";
import type {
    ActionContext,
    ActionResult,
    SessionContext,
} from "@typeagent/agent-sdk";
import { createExecutableAction } from "@typeagent/agent-cache";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { executeAction } from "../src/execute/actionHandlers.js";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";

function findSpan(manager: InMemorySpanManager, name: string): CapturedSpan {
    const spans = manager.findSpansByName(name);
    if (spans.length !== 1) {
        throw new Error(`expected one ${name} span, got ${spans.length}`);
    }
    return spans[0]!;
}

function makeExecutableAction(schemaName: string, actionName: string) {
    return createExecutableAction(schemaName, actionName, {});
}

interface HandlerContextFake {
    systemContext: CommandHandlerContext;
    context: ActionContext<CommandHandlerContext>;
    /** Every `setDisplay`/`appendDisplay`/`setDisplayInfo` call. */
    displayCalls: string[];
    abortController: AbortController;
}

function makeFakes(opts: {
    appAgent: any;
    flow?: unknown;
    readinessState?: "ready" | "unsupported" | "setup-required";
    readinessMessage?: string;
    setupOnFirstUse?: boolean;
    setupResult?: ActionResult;
}): HandlerContextFake {
    const displayCalls: string[] = [];
    const abortController = new AbortController();
    const sessionContext = {} as SessionContext;
    const clientIO: any = {
        setDisplayInfo: (...args: unknown[]) =>
            displayCalls.push(`setDisplayInfo:${JSON.stringify(args)}`),
        setDisplay: (...args: unknown[]) =>
            displayCalls.push(`setDisplay:${JSON.stringify(args)}`),
        appendDisplay: (...args: unknown[]) =>
            displayCalls.push(`appendDisplay:${JSON.stringify(args)}`),
        appendDiagnosticData: () => undefined,
        takeAction: () => undefined,
    };
    const agents: any = {
        getAppAgent: () => opts.appAgent,
        getFlow: () => opts.flow,
        getSessionContext: () => sessionContext,
        getActionConfig: () => ({ emojiChar: "T" }),
        getReadiness: () => ({
            state: opts.readinessState ?? "ready",
            message: opts.readinessMessage,
        }),
        getTransientState: () => undefined,
        runSetup: async () => opts.setupResult,
        hasSetup: () => false,
    };
    const systemContext: any = {
        activationId: "activation-fake",
        traceId: "trace-fake",
        telemetryOptions: { joinActiveTrace: false },
        currentRequestId: "req-1",
        currentAbortSignal: abortController.signal,
        currentOptions: undefined,
        agents,
        clientIO,
        session: {
            sessionDirPath: undefined,
            getConfig: () => ({
                execution: {
                    setupOnFirstUse: opts.setupOnFirstUse ?? false,
                },
            }),
        },
        streamingActionContext: undefined,
        commandProfiler: undefined,
        displayCount: 0,
        lastActionSchemaName: undefined,
        isInsideReasoningLoop: false,
        activityContext: undefined,
        pendingToggleTransientAgents: [],
        pendingChoiceRoutes: new Map(),
    };
    // The outer ActionContext<CommandHandlerContext> is what
    // executeAction / displayStatus receive. Its actionIO is a thin
    // no-op that funnels back into the display-calls log.
    const actionIO: any = {
        setDisplay: () => undefined,
        appendDisplay: () => undefined,
        takeAction: () => undefined,
        appendDiagnosticData: () => undefined,
    };
    const context: ActionContext<CommandHandlerContext> = {
        streamingContext: undefined,
        isFromReasoningLoop: false,
        activityContext: undefined,
        sessionContext: {
            agentContext: systemContext,
        } as unknown as SessionContext<CommandHandlerContext>,
        actionIO,
        get abortSignal() {
            return abortController.signal;
        },
        queueToggleTransientAgent: async () => undefined,
    } as unknown as ActionContext<CommandHandlerContext>;
    return { systemContext, context, displayCalls, abortController };
}

describe("executeAction OTel classification", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("succeeds with a plain result and leaves span status UNSET", async () => {
        const appAgent = {
            executeAction: jest.fn(async () => ({
                literalText: "ok",
                entities: [],
            })),
        };
        const fake = makeFakes({ appAgent });

        await wrapRootRequestSpan({}, async () => {
            const result: ActionResult = await executeAction(
                makeExecutableAction("test", "act"),
                fake.context,
                0,
            );
            expect(result.error).toBeUndefined();
            return {};
        });

        const requestSpan = findSpan(manager, "typeagent.request");
        const actionSpan = findSpan(manager, "typeagent.action");
        manager.assertParentChild(requestSpan, actionSpan);
        expect(actionSpan.status.code).toBe(SpanStatusCode.UNSET);
        expect(actionSpan.events).toHaveLength(0);
        expect(actionSpan.attributes["typeagent.agent.name"]).toBe("test");
        expect(actionSpan.attributes["typeagent.action.name"]).toBe("act");
        expect(actionSpan.attributes["typeagent.activation.id"]).toBe(
            "activation-fake",
        );
    });

    it("records handler_missing when the AppAgent has no executeAction", async () => {
        const appAgent = {};
        const fake = makeFakes({ appAgent });

        await executeAction(
            makeExecutableAction("test", "act"),
            fake.context,
            0,
        );

        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "handler_missing",
        });
        expect(actionSpan.events.map((e) => e.name)).toEqual([
            "action.setup.failed",
        ]);
    });

    it("records ActionHandlerError when the handler throws", async () => {
        const appAgent = {
            executeAction: (async () => {
                throw new Error("secret private handler error 1234567890");
            }) as any,
        };
        const fake = makeFakes({ appAgent });

        const result: ActionResult = await executeAction(
            makeExecutableAction("test", "act"),
            fake.context,
            0,
        );

        expect(result.error).toBeDefined();
        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action handler failed",
        });
        const exception = actionSpan.events.find((e) => e.name === "exception");
        expect(exception?.attributes?.["exception.type"]).toBe(
            "ActionHandlerError",
        );
        expect(exception?.attributes?.["exception.message"]).toBe(
            "action handler failed",
        );
        // No `action.result.error` piggyback on top of the exception.
        expect(
            actionSpan.events.some((e) => e.name === "action.result.error"),
        ).toBe(false);
    });

    it("records action.result.error when the handler returns typed error", async () => {
        const appAgent = {
            executeAction: async () =>
                ({
                    literalText: "",
                    entities: [],
                    error: "expected typed failure",
                }) as unknown as ActionResult,
        };
        const fake = makeFakes({ appAgent });

        await executeAction(
            makeExecutableAction("test", "act"),
            fake.context,
            0,
        );

        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "result_error",
        });
        expect(actionSpan.events.map((e) => e.name)).toEqual([
            "action.result.error",
        ]);
    });

    it("classifies flow-interpreter exceptions separately", async () => {
        const appAgent = {
            executeAction: jest.fn(async () => ({
                literalText: "ok",
                entities: [],
            })),
        };
        const fake = makeFakes({
            appAgent,
            flow: { steps: [{ type: "throw" }] },
        });

        const result = await executeAction(
            makeExecutableAction("test", "act"),
            fake.context,
            0,
        );

        expect(result.error).toBeDefined();
        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "action flow failed",
        });
        const exception = actionSpan.events.find((e) => e.name === "exception");
        expect(exception?.attributes?.["exception.type"]).toBe(
            "ActionFlowError",
        );
        expect(
            actionSpan.events.some((e) => e.name === "action.result.error"),
        ).toBe(false);
        expect(appAgent.executeAction).not.toHaveBeenCalled();
    });

    it("leaves auto-setup replacement results unclassified", async () => {
        const appAgent = {
            executeAction: jest.fn(async () => ({
                literalText: "unused",
                entities: [],
            })),
        };
        const setupResult = {
            literalText: "setup required",
            entities: [],
            error: "setup is still in progress",
        } as unknown as ActionResult;
        const fake = makeFakes({
            appAgent,
            readinessState: "setup-required",
            setupOnFirstUse: true,
            setupResult,
        });

        const result = await executeAction(
            makeExecutableAction("test", "act"),
            fake.context,
            0,
        );

        expect(result).toBe(setupResult);
        expect(appAgent.executeAction).not.toHaveBeenCalled();
        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status.code).toBe(SpanStatusCode.UNSET);
        expect(actionSpan.events).toHaveLength(0);
    });

    it("throws AbortError and marks the span cancelled on cancellation", async () => {
        const appAgent = {
            executeAction: (async () => {
                throw new DOMException("aborted", "AbortError");
            }) as any,
        };
        const fake = makeFakes({ appAgent });
        fake.abortController.abort();

        await expect(
            executeAction(makeExecutableAction("test", "act"), fake.context, 0),
        ).rejects.toMatchObject({ name: "AbortError" });

        const actionSpan = findSpan(manager, "typeagent.action");
        expect(actionSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "cancelled",
        });
        const exception = actionSpan.events.find((e) => e.name === "exception");
        expect(exception?.attributes?.["exception.type"]).toBe("AbortError");
        expect(exception?.attributes?.["exception.message"]).toBe("cancelled");
    });
});
