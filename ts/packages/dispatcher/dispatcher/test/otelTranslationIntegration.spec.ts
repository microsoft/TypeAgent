// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    describe,
    it,
    expect,
    jest,
    beforeEach,
    afterEach,
} from "@jest/globals";
import type { ActionContext } from "@typeagent/agent-sdk";
import { RequestAction } from "@typeagent/agent-cache";
import {
    createInMemorySpanManager,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";

const mockMatchRequest =
    jest.fn<
        (...args: unknown[]) => Promise<Record<string, unknown> | undefined>
    >();

jest.unstable_mockModule("../src/translation/matchRequest.js", () => ({
    getActivityActiveSchemas: jest.fn(),
    getActivityCacheSpec: jest.fn(),
    getActivityNamespaceSuffix: jest.fn(),
    getMatchRequestBypassReason: jest.fn(() => undefined),
    getNonActivityActiveSchemas: jest.fn(),
    matchRequest: mockMatchRequest,
}));

const { interpretRequest } = await import(
    "../src/translation/interpretRequest.js"
);
const { readTranslationRoutingFromError } = await import(
    "../src/otel/translationSpan.js"
);

function createContext(
    translationEnabled: boolean,
): ActionContext<CommandHandlerContext> {
    const agentContext = {
        activationId: "activation-123",
        traceId: "trace-xyz",
        telemetryOptions: {
            joinActiveTrace: false,
        },
        session: {
            sessionDirPath: undefined,
            getConfig: () => ({
                translation: {
                    enabled: translationEnabled,
                },
            }),
        },
        agents: {
            getActiveSchemas: () => ["test"],
        },
        devTrace: {
            beginTranslation: jest.fn(),
            writeTranslationCapture: jest.fn(async () => undefined),
        },
        batchMode: true,
        confirmActions: false,
        developerMode: false,
        currentAbortSignal: undefined,
        currentOptions: undefined,
        logger: undefined,
        metricsManager: undefined,
        conversationSignal: {
            recordRequest: jest.fn(),
        },
    };

    return {
        sessionContext: { agentContext },
    } as unknown as ActionContext<CommandHandlerContext>;
}

describe("translation entry-point instrumentation", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
        mockMatchRequest.mockReset();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("records a grammar hit on one translation child span", async () => {
        const requestAction = RequestAction.create(
            "test request",
            [],
            undefined,
        );
        mockMatchRequest.mockResolvedValue({
            type: "grammar",
            requestAction,
            elapsedMs: 1,
            config: {},
        });

        let result;
        await wrapRootRequestSpan({}, async () => {
            result = await interpretRequest(
                createContext(true),
                "test request",
                undefined,
                undefined,
            );
            return {};
        });

        const requestSpans = manager.findSpansByName("typeagent.request");
        const translationSpans = manager.findSpansByName(
            "typeagent.translation",
        );
        expect(requestSpans).toHaveLength(1);
        expect(translationSpans).toHaveLength(1);
        manager.assertParentChild(requestSpans[0]!, translationSpans[0]!);
        expect(translationSpans[0]!.events.map((event) => event.name)).toEqual([
            "translation.grammar.matched",
        ]);
        // The routing summary threaded out of interpretRequest reflects the
        // grammar cache hit with no fallback/retry. `routes` records the
        // grammar mechanism additively alongside the terminal `matchOutcome`.
        expect(result!.routing).toEqual({
            matchOutcome: "grammar_hit",
            routes: ["grammar"],
            fallback: false,
            retryCount: 0,
        });
    });

    it("retains the captured routing when confirmTranslation cancels after the span closes", async () => {
        const requestAction = RequestAction.create(
            "test request",
            [],
            undefined,
        );
        mockMatchRequest.mockResolvedValue({
            type: "grammar",
            requestAction,
            elapsedMs: 1,
            config: {},
        });

        // Drive confirmTranslation to cancel: this runs *after* the translation
        // span's async context has been torn down, so the routing rationale
        // must be re-attached from the summary captured inside the span.
        const context = createContext(true);
        const agentContext = context.sessionContext
            .agentContext as unknown as Record<string, unknown>;
        agentContext.batchMode = false;
        agentContext.confirmActions = true;
        agentContext.currentRequestId = { requestId: "req-cancel" };
        agentContext.clientIO = {
            proposeAction: jest.fn(async () => null),
        };

        const error = await wrapRootRequestSpan({}, async () =>
            interpretRequest(
                context,
                "test request",
                undefined,
                undefined,
            ).catch((e) => e),
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Request cancelled");
        // The grammar-hit routing captured before the span closed survives the
        // post-span cancellation and rides out on the thrown error.
        expect(readTranslationRoutingFromError(error)).toEqual({
            matchOutcome: "grammar_hit",
            routes: ["grammar"],
            fallback: false,
            retryCount: 0,
        });
    });

    it("reuses the interpretRequest span when a miss enters translateRequest", async () => {
        mockMatchRequest.mockResolvedValue(undefined);
        const context = createContext(false);

        const error = await interpretRequest(
            context,
            "test request",
            undefined,
            undefined,
        ).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("Translation is disabled.");

        const translationSpans = manager.findSpansByName(
            "typeagent.translation",
        );
        expect(translationSpans).toHaveLength(1);
        expect(translationSpans[0]!.events.map((event) => event.name)).toEqual([
            "translation.grammar.no_match",
            "translation.cache.miss",
            "exception",
        ]);
        // The cache-miss routing decision is carried on the thrown error so the
        // completion boundary can log a truthful reason for the failure.
        expect(readTranslationRoutingFromError(error)).toEqual({
            matchOutcome: "miss",
            fallback: false,
            retryCount: 0,
        });
    });
});
