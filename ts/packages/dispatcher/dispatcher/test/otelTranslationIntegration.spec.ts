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

function createContext(
    translationEnabled: boolean,
): ActionContext<CommandHandlerContext> {
    const agentContext = {
        activationId: "activation-123",
        traceId: "trace-xyz",
        telemetryOptions: {
            joinActiveTrace: false,
            captureSensitiveErrorDetails: false,
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

        await wrapRootRequestSpan({}, async () => {
            await interpretRequest(
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
    });

    it("reuses the interpretRequest span when a miss enters translateRequest", async () => {
        mockMatchRequest.mockResolvedValue(undefined);
        const context = createContext(false);

        await expect(
            interpretRequest(context, "test request", undefined, undefined),
        ).rejects.toThrow("Translation is disabled.");

        const translationSpans = manager.findSpansByName(
            "typeagent.translation",
        );
        expect(translationSpans).toHaveLength(1);
        expect(translationSpans[0]!.events.map((event) => event.name)).toEqual([
            "translation.grammar.no_match",
            "translation.cache.miss",
            "exception",
        ]);
    });
});
