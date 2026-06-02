// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for copilot.invoke (decision 0010 §5).
 *
 * These tests use a mock CopilotClient injected via
 * setCopilotClientFactory; the real @github/copilot-sdk is never
 * loaded. Per repo policy, integration tests against the live SDK
 * are out of scope (test:live).
 */

import {
    TaskRegistry,
    WorkflowEngine,
    copilotInvoke,
    setCopilotClientFactory,
    resetCopilotClientFactory,
    type MinimalCopilotClient,
    type MinimalCopilotSession,
} from "../src/index.js";
import { TaskPolicy, WorkflowIR, ConcreteTaskDefinition } from "workflow-model";
import type { MessageOptions, SessionConfig, Tool } from "@github/copilot-sdk";

// Allow-all policy for tests.
const allowAllPolicy: TaskPolicy = new Proxy({} as TaskPolicy, {
    get: () => "allow" as const,
});

// ---- Mock client ----

type SubmitResponseHandler = (args: unknown) => Promise<unknown>;

function makeMockClient(script: AgentScript[]): {
    client: MinimalCopilotClient;
    sessions: MockSession[];
    stopCount: { value: number };
} {
    let scriptIdx = 0;
    const sessions: MockSession[] = [];
    const stopCount = { value: 0 };

    const client: MinimalCopilotClient = {
        async start() {},
        async stop() {
            stopCount.value++;
            return [];
        },
        async createSession(config: SessionConfig) {
            const submitTool = (config.tools ?? []).find(
                (t: Tool) => t.name === "submit_response",
            );
            if (!submitTool) {
                throw new Error(
                    "mock createSession: expected a submit_response tool to be registered",
                );
            }
            // SDK ToolHandler is `(args, invocation)`; our submit_response
            // handler ignores `invocation`, so it's safe to call with one arg.
            const handler = submitTool.handler as SubmitResponseHandler;
            const session = new MockSession(config, handler, () => {
                if (scriptIdx >= script.length) {
                    throw new Error(
                        `mock client ran out of scripted turns (asked for #${scriptIdx + 1}, have ${script.length})`,
                    );
                }
                return script[scriptIdx++]!;
            });
            sessions.push(session);
            return session;
        },
    };

    return { client, sessions, stopCount };
}

interface AgentScript {
    /**
     * Function that, given the prompt and the submit_response tool
     * handler, simulates the agent's actions for one sendAndWait
     * call. Returns when the "session" goes idle. May call the
     * tool handler 0 or more times.
     */
    onSend: (
        prompt: string,
        callSubmit: SubmitResponseHandler,
    ) => Promise<void>;
}

class MockSession implements MinimalCopilotSession {
    public sessionId: string;
    public sentPrompts: string[] = [];
    public sentTimeouts: Array<number | undefined> = [];
    public disconnected = false;
    constructor(
        public config: SessionConfig,
        private submitHandler: SubmitResponseHandler,
        private nextScript: () => AgentScript,
    ) {
        this.sessionId = `mock-${Math.random().toString(36).slice(2, 8)}`;
    }
    async sendAndWait(opts: MessageOptions, timeout?: number) {
        this.sentPrompts.push(opts.prompt);
        this.sentTimeouts.push(timeout);
        const script = this.nextScript();
        await script.onSend(opts.prompt, this.submitHandler);
        return undefined;
    }
    async disconnect() {
        this.disconnected = true;
    }
}

// ---- Tests ----

describe("copilot.invoke (decision 0010)", () => {
    afterEach(() => {
        resetCopilotClientFactory();
    });

    function makeEngine() {
        const reg = new TaskRegistry();
        reg.register(copilotInvoke);
        return new WorkflowEngine(reg);
    }

    function makeIR(opts: {
        outputSchema: Record<string, unknown>;
        inputs: Record<string, unknown>;
    }): WorkflowIR {
        return {
            kind: "workflow",
            version: "1",
            entry: "copilotTest",
            workflows: {
                copilotTest: {
                    inputSchema: { type: "object" },
                    outputSchema: opts.outputSchema,
                    entry: "step",
                    nodes: {
                        step: {
                            kind: "task",
                            task: "copilot.invoke",
                            inputSchema: (
                                copilotInvoke as ConcreteTaskDefinition
                            ).inputSchema,
                            outputSchema: opts.outputSchema,
                            inputs: opts.inputs as any,
                            bind: "result",
                        },
                    },
                    output: { $from: "scope", name: "result" } as any,
                },
            },
        };
    }

    it("happy path: agent calls submit_response with valid args", async () => {
        const { client } = makeMockClient([
            {
                async onSend(_prompt, callSubmit) {
                    await callSubmit({ summary: "hi", count: 3 });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["summary", "count"],
                properties: {
                    summary: { type: "string" },
                    count: { type: "integer" },
                },
            },
            inputs: { prompt: "do the thing" },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ summary: "hi", count: 3 });
    });

    it("repair loop: invalid args first, valid on second turn", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    // Wrong shape — missing required `count`.
                    await callSubmit({ summary: "hi" });
                },
            },
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ summary: "hi", count: 7 });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["summary", "count"],
                properties: {
                    summary: { type: "string" },
                    count: { type: "integer" },
                },
            },
            inputs: { prompt: "do the thing" },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ summary: "hi", count: 7 });
        // Two sendAndWait turns were used.
        expect(sessions[0]!.sentPrompts.length).toBe(2);
        // Second prompt is a repair nudge.
        expect(sessions[0]!.sentPrompts[1]).toContain("submit_response");
    });

    it("repair loop: idle without calling submit_response is repaired", async () => {
        const { client, sessions } = makeMockClient([
            {
                // Agent says nothing useful and goes idle.
                async onSend() {},
            },
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ summary: "answer", count: 1 });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["summary", "count"],
                properties: {
                    summary: { type: "string" },
                    count: { type: "integer" },
                },
            },
            inputs: { prompt: "..." },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ summary: "answer", count: 1 });
        expect(sessions[0]!.sentPrompts[1]).toContain(
            "did not call `submit_response`",
        );
    });

    it("budget exhaustion fails with diagnostic data", async () => {
        // 3 attempts, all invalid; default budget is 3.
        const { client } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ wrong: "shape" });
                },
            },
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ wrong: "shape" });
                },
            },
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ wrong: "shape" });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["summary", "count"],
                properties: {
                    summary: { type: "string" },
                    count: { type: "integer" },
                },
            },
            inputs: { prompt: "..." },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(false);
        expect(result.error?.message).toMatch(/exhausted repair budget/);
        // error.data must surface the per-attempt diagnostics so the
        // CLI can print them. See copilotClientHost.ts (the failure
        // payload) and runner.ts RunResult (which now propagates `data`).
        const data = result.error?.data as
            | {
                  attempts?: number;
                  lastErrors?: string | null;
                  lastAssistantText?: string | null;
              }
            | undefined;
        expect(data).toBeDefined();
        expect(data?.attempts).toBe(3);
        expect(typeof data?.lastErrors).toBe("string");
        expect(data?.lastErrors).toMatch(/required|summary|count/);
    });

    it("respects custom repairBudget input", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ wrong: true });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["summary"],
                properties: { summary: { type: "string" } },
            },
            inputs: { prompt: "...", repairBudget: 1 },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(false);
        expect(sessions[0]!.sentPrompts.length).toBe(1);
    });

    it("string outputSchema: wraps submit_response and unwraps the bare value", async () => {
        let observedParams: unknown;
        const { client } = makeMockClient([
            {
                async onSend(_prompt, callSubmit) {
                    // Free-text mode: node declared `outputSchema: { type: "string" }`,
                    // so submit_response is wrapped as `{ value: <string> }`.
                    await callSubmit({ value: "hello world" });
                },
            },
        ]);
        // Spy on the synthetic tool's parameters via createSession.
        const wrappedClient: MinimalCopilotClient = {
            ...client,
            async createSession(config) {
                const submitTool = (config.tools ?? []).find(
                    (t: Tool) => t.name === "submit_response",
                );
                observedParams = (
                    submitTool as { parameters?: unknown } | undefined
                )?.parameters;
                return client.createSession(config);
            },
        };
        setCopilotClientFactory(async () => wrappedClient);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: { type: "string" },
            inputs: { prompt: "give me a string" },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        // Output is unwrapped to the bare string, not the `{value: ...}`
        // envelope.
        expect(result.output).toBe("hello world");
        // submit_response's params were wrapped so the LLM tool-call
        // constraint (object-typed params) is satisfied.
        expect(observedParams).toEqual({
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
        });
    });

    it("validates repairBudget bounds", async () => {
        const { client } = makeMockClient([]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "...", repairBudget: 99 },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        // The IR validates repairBudget (max 10) at IR validation time
        // because the input schema declares minimum/maximum.
        expect(result.success).toBe(false);
    });

    it("passes model, customAgents, availableTools through to SDK", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ ok: true });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["ok"],
                properties: { ok: { type: "boolean" } },
            },
            inputs: {
                prompt: "...",
                model: "gpt-5",
                customAgents: [
                    { name: "researcher", description: "x", prompt: "y" },
                ],
                allowedTools: ["view", "grep"],
                reasoningEffort: "high",
                systemMessage: "extra rules go here",
            },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        const cfg = sessions[0]!.config;
        expect(cfg.model).toBe("gpt-5");
        expect(cfg.customAgents).toEqual([
            { name: "researcher", description: "x", prompt: "y" },
        ]);
        // The host always merges `submit_response` into the SDK
        // `availableTools` allow-list so the synthetic termination
        // tool stays exposed alongside whatever built-ins the IR
        // permits. See copilotClientHost.ts.
        expect(cfg.availableTools).toEqual(
            expect.arrayContaining(["view", "grep", "submit_response"]),
        );
        expect(cfg.availableTools).toHaveLength(3);
        expect(cfg.reasoningEffort).toBe("high");
        // The SDK system-message scaffolding uses mode "append" and
        // includes the schema text plus the author's addendum.
        expect(cfg.systemMessage?.mode).toBe("append");
        expect(cfg.systemMessage?.content).toContain("submit_response");
        expect(cfg.systemMessage?.content).toContain("extra rules go here");
    });

    it("keeps submit_response available even when allowedTools is empty", async () => {
        // Regression: an `allowedTools: []` IR input (deny all CLI
        // built-ins) was previously forwarded as `availableTools: []`,
        // which the SDK reads as "no tools at all" — including the
        // synthetic `submit_response` — making it impossible for the
        // model to terminate the turn-loop. The host must always merge
        // `submit_response` into the allow-list.
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ ok: true });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["ok"],
                properties: { ok: { type: "boolean" } },
            },
            inputs: {
                prompt: "...",
                allowedTools: [],
            },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(sessions[0]!.config.availableTools).toEqual(["submit_response"]);
    });

    it("disposes the session after a successful call", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ x: "y" });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "..." },
        });

        await eng.run(ir, { policy: allowAllPolicy });
        expect(sessions[0]!.disconnected).toBe(true);
    });

    it("disposes the session even on failure", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend() {
                    throw new Error("boom");
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "..." },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(false);
        expect(sessions[0]!.disconnected).toBe(true);
    });

    it("rejects attachment paths outside the allowed roots", async () => {
        let factoryCalled = false;
        setCopilotClientFactory(async () => {
            factoryCalled = true;
            throw new Error("factory should not be called");
        });

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: {
                prompt: "...",
                attachments: [{ path: "/etc/passwd" }],
            },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(false);
        expect(result.error?.message).toMatch(/attachment.*rejected/);
        expect(factoryCalled).toBe(false);
    });

    it("respects ctx.signal cancellation", async () => {
        const ctrl = new AbortController();

        // Script that "hangs" until aborted, then resolves.
        const { client, sessions } = makeMockClient([
            {
                async onSend() {
                    return new Promise<void>((resolve) => {
                        ctrl.signal.addEventListener("abort", () => resolve(), {
                            once: true,
                        });
                    });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "..." },
        });

        const promise = eng.run(ir, {
            policy: allowAllPolicy,
            signal: ctrl.signal,
        });
        // Abort mid-flight.
        setTimeout(() => ctrl.abort(), 30);

        const result = await promise;
        expect(result.success).toBe(false);
        // Either via the engine's "Run cancelled" or copilot's abort path.
        expect(result.error?.message.toLowerCase()).toMatch(/cancel|abort/);
        // The session should still have been disconnected.
        expect(sessions[0]!.disconnected).toBe(true);
    });

    it("forwards timeoutMs as sendAndWait's second positional arg", async () => {
        // The SDK's sendAndWait signature is `(options, timeout?)` — not
        // a `timeout` field on `options`. This guards against drifting
        // back to the buggy options-bag form (which the SDK silently
        // ignores).
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ x: "ok" });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "...", timeoutMs: 12345 },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(sessions[0]!.sentTimeouts).toEqual([12345]);
    });

    it("omits timeout when timeoutMs is not provided", async () => {
        const { client, sessions } = makeMockClient([
            {
                async onSend(_p, callSubmit) {
                    await callSubmit({ x: "ok" });
                },
            },
        ]);
        setCopilotClientFactory(async () => client);

        const eng = makeEngine();
        const ir = makeIR({
            outputSchema: {
                type: "object",
                required: ["x"],
                properties: { x: { type: "string" } },
            },
            inputs: { prompt: "..." },
        });

        const result = await eng.run(ir, { policy: allowAllPolicy });
        expect(result.success).toBe(true);
        expect(sessions[0]!.sentTimeouts).toEqual([undefined]);
    });
});
