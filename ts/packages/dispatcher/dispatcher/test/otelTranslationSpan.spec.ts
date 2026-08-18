// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";
import {
    emitTranslationCacheBypass,
    emitTranslationFallback,
    emitTranslationMatchResult,
    emitTranslationRetry,
    wrapTranslationSpan,
} from "../src/otel/translationSpan.js";

const ATTRIBUTES = {
    sessionId: "session-abc",
    activationId: "activation-123",
    traceId: "trace-xyz",
};

function getOnlySpan(manager: InMemorySpanManager, name: string): CapturedSpan {
    const spans = manager.findSpansByName(name);
    if (spans.length !== 1) {
        throw new Error(`Expected one ${name} span, got ${spans.length}`);
    }
    return spans[0]!;
}

describe("wrapTranslationSpan", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("creates one translation span with correlation attributes", async () => {
        await wrapTranslationSpan(ATTRIBUTES, async () => undefined);

        const span = getOnlySpan(manager, "typeagent.translation");
        expect(span.attributes["typeagent.session.id"]).toBe("session-abc");
        expect(span.attributes["typeagent.activation.id"]).toBe(
            "activation-123",
        );
        expect(span.attributes["typeagent.trace.id"]).toBe("trace-xyz");
        expect(span.status.code).toBe(SpanStatusCode.UNSET);
    });

    it("creates a child of the active request span", async () => {
        await wrapRootRequestSpan(ATTRIBUTES, async () => {
            await wrapTranslationSpan(ATTRIBUTES, async () => undefined);
            return {};
        });

        manager.assertParentChild(
            getOnlySpan(manager, "typeagent.request"),
            getOnlySpan(manager, "typeagent.translation"),
        );
    });

    it("keeps the translation span active through asynchronous work", async () => {
        let activeSpanId: string | undefined;

        await wrapTranslationSpan(ATTRIBUTES, async () => {
            await Promise.resolve();
            activeSpanId = trace.getActiveSpan()?.spanContext().spanId;
        });

        expect(activeSpanId).toBe(
            getOnlySpan(manager, "typeagent.translation").spanContext().spanId,
        );
    });

    it("reuses an active translation span instead of creating a nested duplicate", async () => {
        await wrapTranslationSpan(ATTRIBUTES, async (outerSpan) => {
            await wrapTranslationSpan(ATTRIBUTES, async (innerSpan) => {
                expect(innerSpan).toBe(outerSpan);
            });
        });

        expect(manager.findSpansByName("typeagent.translation")).toHaveLength(
            1,
        );
    });

    it("starts a new span when detached work inherits an ended translation context", async () => {
        let releaseDetached!: () => void;
        const gate = new Promise<void>((resolve) => {
            releaseDetached = resolve;
        });
        let detachedWork!: Promise<void>;

        await wrapTranslationSpan(ATTRIBUTES, async () => {
            detachedWork = (async () => {
                await gate;
                await wrapTranslationSpan(ATTRIBUTES, async () => undefined);
            })();
        });

        releaseDetached();
        await detachedWork;

        expect(manager.findSpansByName("typeagent.translation")).toHaveLength(
            2,
        );
    });

    it("records every grammar and cache lookup in order", async () => {
        await wrapTranslationSpan(ATTRIBUTES, async () => {
            emitTranslationMatchResult("grammar_hit");
            emitTranslationMatchResult("miss");
            emitTranslationMatchResult("cache_hit");
            emitTranslationCacheBypass("request_constraints");
        });

        const span = getOnlySpan(manager, "typeagent.translation");
        expect(span.events.map((event) => event.name)).toEqual([
            "translation.grammar.matched",
            "translation.grammar.no_match",
            "translation.cache.miss",
            "translation.cache.hit",
            "translation.cache.bypassed",
        ]);
        expect(span.events[0]!.attributes?.["result_kind"]).toBe("grammar");
        expect(span.events[3]!.attributes?.["result_kind"]).toBe(
            "construction",
        );
        expect(span.events[4]!.attributes?.["bypass_reason"]).toBe(
            "request_constraints",
        );
    });

    it("records fallback and globally sequential retry events", async () => {
        await wrapTranslationSpan(ATTRIBUTES, async () => {
            emitTranslationRetry("selected_actions_full");
            emitTranslationFallback();
            emitTranslationRetry("same_schema");
        });

        const span = getOnlySpan(manager, "typeagent.translation");
        const retries = span.events.filter(
            (event) => event.name === "translation.retry",
        );
        expect(retries).toHaveLength(2);
        expect(retries[0]!.attributes).toMatchObject({
            retry_number: 1,
            retry_kind: "selected_actions_full",
        });
        expect(retries[1]!.attributes).toMatchObject({
            retry_number: 2,
            retry_kind: "same_schema",
        });
        expect(
            span.events.find((event) => event.name === "translation.fallback")
                ?.attributes,
        ).toMatchObject({
            fallback_tier: "assistant_switch",
        });
    });

    it("uses privacy-safe exception details by default", async () => {
        const error = new Error(
            "translator exposed private request text and sk-secret12345678901234567890",
        );

        await expect(
            wrapTranslationSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.translation");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "translation failed",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe(
            "TranslationError",
        );
        expect(exception?.attributes?.["exception.message"]).toBe(
            "translation failed",
        );
        expect(exception?.attributes?.["exception.stacktrace"]).toBeUndefined();
    });

    it("classifies cancellation without exporting the abort message", async () => {
        const error = new DOMException(
            "private cancellation details",
            "AbortError",
        );

        await expect(
            wrapTranslationSpan(ATTRIBUTES, async () => {
                throw error;
            }),
        ).rejects.toBe(error);

        const span = getOnlySpan(manager, "typeagent.translation");
        expect(span.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "cancelled",
        });
        const exception = span.events.find(
            (event) => event.name === "exception",
        );
        expect(exception?.attributes?.["exception.type"]).toBe("AbortError");
        expect(exception?.attributes?.["exception.message"]).toBe("cancelled");
    });

    it("ends the span when the body throws", async () => {
        await expect(
            wrapTranslationSpan(ATTRIBUTES, async () => {
                throw new Error("failure");
            }),
        ).rejects.toThrow("failure");

        expect(manager.findSpansByName("typeagent.translation")).toHaveLength(
            1,
        );
    });
});

describe("translation event helpers", () => {
    it("are no-ops when no translation span is active", () => {
        expect(() => {
            emitTranslationMatchResult("cache_hit");
            emitTranslationCacheBypass("cache_disabled");
            emitTranslationFallback();
            emitTranslationRetry("same_schema");
        }).not.toThrow();
    });
});
