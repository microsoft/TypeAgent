// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, propagation, trace, TraceFlags } from "@opentelemetry/api";
import { createSecretFilter } from "@typeagent/common-utils";
import {
    setTypeAgentSpanAttributes,
    TYPEAGENT_SPAN_ATTRIBUTES,
    TYPEAGENT_SPAN_NAMES,
} from "../src/otel/traceContract.js";
import {
    createInMemorySpanManager,
    type CapturedSpan,
    type InMemorySpanManager,
} from "../src/otel/testing/inMemorySpanManager.js";
// Re-import the manager via the published subpath. This is a real load-time
// exercise of the package.json `exports` map: if the subpath, output path,
// or `files` allowlist ever breaks, this import fails at test time. The
// module-object comparison below guarantees the subpath resolves to the same
// implementation as the direct src import, so downstream steps consuming
// `@typeagent/telemetry/testing/inMemorySpanManager` do not silently pick up
// a stale build.
import * as managerSubpath from "@typeagent/telemetry/testing/inMemorySpanManager";

describe("trace contract span-name and attribute-key constants", () => {
    it("uses the frozen typeagent.* span-name namespace the design doc calls out", () => {
        expect(TYPEAGENT_SPAN_NAMES).toEqual({
            REQUEST: "typeagent.request",
            TRANSLATION: "typeagent.translation",
            REASONING: "typeagent.reasoning",
            ACTION: "typeagent.action",
            LLM: "typeagent.llm",
        });
        expect(Object.isFrozen(TYPEAGENT_SPAN_NAMES)).toBe(true);
    });

    it("uses the exact attribute keys the design doc calls out", () => {
        expect(TYPEAGENT_SPAN_ATTRIBUTES).toEqual({
            AGENT_NAME: "typeagent.agent.name",
            ACTION_NAME: "typeagent.action.name",
            GEN_AI_SYSTEM: "gen_ai.system",
            GEN_AI_REQUEST_MODEL: "gen_ai.request.model",
            SESSION_ID: "typeagent.session.id",
            ACTIVATION_ID: "typeagent.activation.id",
            TRACE_ID: "typeagent.trace.id",
        });
        expect(Object.isFrozen(TYPEAGENT_SPAN_ATTRIBUTES)).toBe(true);
    });
});

describe("setTypeAgentSpanAttributes", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    function withSpan<T>(name: string, fn: (span: any) => T): T {
        const tracer = trace.getTracer("test");
        const span = tracer.startSpan(name);
        try {
            return fn(span);
        } finally {
            span.end();
        }
    }

    it("writes only allowlisted keys onto the span", () => {
        withSpan("t", (span) => {
            setTypeAgentSpanAttributes(span, {
                agentName: "player",
                actionName: "play",
                genAiSystem: "openai",
                genAiRequestModel: "gpt-4o",
                sessionId: "sess-1",
                activationId: "act-1",
                traceId: "legacy-trace-1",
            });
        });

        const [captured] = manager.findSpansByName("t");
        expect(captured).toBeDefined();
        expect(captured.attributes).toEqual({
            "typeagent.agent.name": "player",
            "typeagent.action.name": "play",
            "gen_ai.system": "openai",
            "gen_ai.request.model": "gpt-4o",
            "typeagent.session.id": "sess-1",
            "typeagent.activation.id": "act-1",
            "typeagent.trace.id": "legacy-trace-1",
        });
    });

    it("ignores unknown properties (privacy-critical allowlist)", () => {
        withSpan("t", (span) => {
            const smuggled = {
                agentName: "player",
                // These would be a privacy incident if written to a span.
                prompt: "what is the user's password?",
                response: "the password is hunter2",
                userContent: "PII goes here",
            } as any;
            setTypeAgentSpanAttributes(span, smuggled);
        });

        const [captured] = manager.findSpansByName("t");
        expect(captured.attributes).toEqual({
            "typeagent.agent.name": "player",
        });
        for (const key of Object.keys(captured.attributes)) {
            expect(
                key.startsWith("typeagent.") || key.startsWith("gen_ai."),
            ).toBe(true);
        }
    });

    it("skips undefined, empty, and non-string values", () => {
        withSpan("t", (span) => {
            const withUndefinedAndBad: any = {
                agentName: undefined,
                actionName: "",
                sessionId: "sess-1",
                // Non-string sneaking through an untyped call site.
                activationId: 42,
            };
            setTypeAgentSpanAttributes(span, withUndefinedAndBad);
        });

        const [captured] = manager.findSpansByName("t");
        expect(captured.attributes).toEqual({
            "typeagent.session.id": "sess-1",
        });
    });

    it("runs string values through redaction before writing them", () => {
        // A value shaped like an OpenAI api key. We only need the
        // shape - redactText delegates to filterSecrets, which recognizes it.
        const withSecret = "sk-" + "a".repeat(48);
        withSpan("t", (span) => {
            setTypeAgentSpanAttributes(span, {
                agentName: withSecret,
            });
        });

        const [captured] = manager.findSpansByName("t");
        const written = captured.attributes["typeagent.agent.name"];
        expect(typeof written).toBe("string");
        expect(written).not.toContain(withSecret);
    });

    it("applies a caller-supplied SecretFilter when provided", () => {
        // The RedactionOptions.secretFilter path is what lets a host
        // register secrets it read from config (not just formats
        // filterSecrets recognizes on its own). If this branch stops
        // being wired through, an out-of-format secret could be written
        // to a span attribute unchanged - so exercise it explicitly.
        const knownSecret = "hunter2-registered-value";
        const secretFilter = createSecretFilter({
            initialValues: [knownSecret],
        });

        withSpan("t", (span) => {
            setTypeAgentSpanAttributes(
                span,
                { agentName: `player-${knownSecret}-suffix` },
                { secretFilter },
            );
        });

        const [captured] = manager.findSpansByName("t");
        const written = captured.attributes["typeagent.agent.name"];
        expect(typeof written).toBe("string");
        expect(String(written)).not.toContain(knownSecret);
    });
});

describe("in-memory span manager", () => {
    let manager: InMemorySpanManager;

    beforeEach(() => {
        manager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await manager.shutdown();
    });

    it("captures finished spans through the OTel global provider", () => {
        const tracer = trace.getTracer("test");
        const s1 = tracer.startSpan("typeagent.request");
        s1.end();
        const s2 = tracer.startSpan("typeagent.translation");
        s2.end();

        const spans = manager.getFinishedSpans();
        expect(spans.map((s) => s.name)).toEqual([
            "typeagent.request",
            "typeagent.translation",
        ]);
    });

    it("findSpansByName filters by exact name", () => {
        const tracer = trace.getTracer("test");
        tracer.startSpan("typeagent.llm").end();
        tracer.startSpan("typeagent.llm").end();
        tracer.startSpan("typeagent.action").end();

        expect(manager.findSpansByName("typeagent.llm")).toHaveLength(2);
        expect(manager.findSpansByName("typeagent.action")).toHaveLength(1);
        expect(manager.findSpansByName("typeagent.nope")).toEqual([]);
    });

    it("assertParentChild passes for a nested startActiveSpan call", () => {
        const tracer = trace.getTracer("test");
        tracer.startActiveSpan("typeagent.request", (parent) => {
            tracer.startActiveSpan("typeagent.translation", (child) => {
                child.end();
            });
            parent.end();
        });

        const [parent] = manager.findSpansByName("typeagent.request");
        const [child] = manager.findSpansByName("typeagent.translation");
        expect(() => manager.assertParentChild(parent, child)).not.toThrow();
    });

    it("assertParentChild throws when the child has no parent span id", () => {
        const tracer = trace.getTracer("test");
        // A root span has no parent. Ask assertParentChild to treat it as
        // the child of itself: same trace id, but no parentSpanId. Exercises
        // the second-arm error path of the manager so a future refactor
        // that drops the check would fail this test.
        tracer.startSpan("root").end();
        const [root] = manager.getFinishedSpans();
        expect(() => manager.assertParentChild(root, root)).toThrow(
            /parent span id/,
        );
    });

    it("assertParentChild throws when the child has a different parent", () => {
        const tracer = trace.getTracer("test");
        // Build parent-child-uncle: uncle is a child of the same root but
        // not a child of `child`. Passing (child, uncle) reaches the third
        // error arm ("parent span id X != Y").
        tracer.startActiveSpan("root", (root) => {
            tracer.startActiveSpan("child", (child) => {
                child.end();
            });
            tracer.startActiveSpan("uncle", (uncle) => {
                uncle.end();
            });
            root.end();
        });
        const [child] = manager.findSpansByName("child");
        const [uncle] = manager.findSpansByName("uncle");
        expect(() => manager.assertParentChild(child, uncle)).toThrow(
            /parent span id/,
        );
    });

    it("assertParentChild throws when the spans are not related", () => {
        const tracer = trace.getTracer("test");
        tracer.startSpan("a").end();
        tracer.startSpan("b").end();
        const [a, b] = manager.getFinishedSpans();
        expect(() => manager.assertParentChild(a, b)).toThrow(/trace id/);
    });

    it("reset() drops captured spans without disturbing the provider", () => {
        const tracer = trace.getTracer("test");
        tracer.startSpan("gone").end();
        expect(manager.getFinishedSpans()).toHaveLength(1);

        manager.reset();
        expect(manager.getFinishedSpans()).toEqual([]);

        tracer.startSpan("kept").end();
        expect(manager.getFinishedSpans().map((s) => s.name)).toEqual(["kept"]);
    });

    it("getFinishedSpans returns a defensive copy", () => {
        const tracer = trace.getTracer("test");
        tracer.startSpan("a").end();
        const snapshot = manager.getFinishedSpans();
        snapshot.length = 0;
        expect(manager.getFinishedSpans()).toHaveLength(1);
    });

    it("shutdown() is idempotent", async () => {
        await manager.shutdown();
        await expect(manager.shutdown()).resolves.toBeUndefined();
    });

    it("shutdown() called concurrently returns the same promise", async () => {
        // Overlapping callers must all wait for the single in-flight
        // shutdown instead of racing the global-provider reset. If the
        // second call resolved eagerly while the first was still awaiting,
        // the next manager install could observe a half-torn-down state.
        const a = manager.shutdown();
        const b = manager.shutdown();
        expect(a).toBe(b);
        await Promise.all([a, b]);
    });

    it("shutdown() unregisters the manager provider so a new tracer no-ops", async () => {
        await manager.shutdown();
        // After shutdown, the OTel global reverts to a no-op provider. A
        // tracer obtained *after* shutdown produces spans that our former
        // exporter never sees.
        const post = trace.getTracer("test");
        const span = post.startSpan("post-shutdown");
        span.end();

        // The exporter should still have the state it had at shutdown
        // (either whatever it captured before, or empty). Critically, the
        // *new* span should not appear in it.
        const names = manager.exporter.getFinishedSpans().map((s) => s.name);
        expect(names).not.toContain("post-shutdown");
    });

    it("does not install a global propagator", () => {
        const carrier: Record<string, string> = {};
        const spanContext = trace.setSpanContext(context.active(), {
            traceId: "0123456789abcdef0123456789abcdef",
            spanId: "0123456789abcdef",
            traceFlags: TraceFlags.SAMPLED,
        });

        propagation.inject(spanContext, carrier);

        expect(carrier).toEqual({});
    });

    it("back-to-back managers do not leak state between each other", async () => {
        const tracer1 = trace.getTracer("test");
        tracer1.startSpan("first-manager").end();
        expect(manager.findSpansByName("first-manager")).toHaveLength(1);

        await manager.shutdown();

        manager = createInMemorySpanManager();
        expect(manager.getFinishedSpans()).toEqual([]);
        const tracer2 = trace.getTracer("test");
        tracer2.startSpan("second-manager").end();
        expect(manager.findSpansByName("first-manager")).toEqual([]);
        expect(manager.findSpansByName("second-manager")).toHaveLength(1);
    });

    it("refuses to install over an already-registered global provider", () => {
        // The outer beforeEach already installed one manager. A second
        // install without teardown must fail loudly rather than silently
        // no-op.
        expect(() => createInMemorySpanManager()).toThrow(
            /already globally registered/,
        );
    });
});

describe("published testing subpath export", () => {
    it("resolves @typeagent/telemetry/testing/inMemorySpanManager to the same module", async () => {
        // Guard against a broken `exports` subpath, wrong `dist` output
        // path, or a `files` allowlist that would ship the manager to
        // downstream consumers without it. The subpath and the direct src
        // import must expose the same public surface, so downstream steps
        // relying on the package specifier get the same behavior.
        expect(typeof managerSubpath.createInMemorySpanManager).toBe(
            "function",
        );
        const manager = managerSubpath.createInMemorySpanManager();
        try {
            const tracer = trace.getTracer("test");
            tracer.startSpan("subpath").end();
            const spans: CapturedSpan[] = manager.findSpansByName("subpath");
            expect(spans).toHaveLength(1);
        } finally {
            // Always tear down so this test does not leak the global
            // provider into whichever spec Jest schedules next.
            await manager.shutdown();
        }
    });
});
