// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
    mkdtempSync,
    rmSync,
    readdirSync,
    writeFileSync,
    readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    executeNativeMacro,
    MacroRunnerObserver,
} from "../src/extension/macro-runner.js";
import {
    requestMacroRunner,
    startMacroRunnerBridge,
    markMacroRunnerSession,
    clearMacroRunnerSession,
} from "../src/shared/macro-runner-bridge.js";
import {
    routePrompt,
    type RoutePromptDependencies,
} from "../src/hooks/hook-router.js";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";

const launch = {
    agent: "typeagent-macro-runner",
    macro: {
        macroId: "approved",
        version: 2,
        state: "approved",
        schemaVersion: 1,
        steps: [],
    },
    inputs: { topic: "Vega" },
    budgets: {
        maxToolCalls: 10,
        maxRetries: 1,
        timeoutMs: 30000,
        maxTokens: 10000,
    },
    candidate: {
        sourceMacroId: "approved",
        sourceVersion: 2,
        handoffRunId: "run",
    },
};
const handoff = { agentName: "typeagent-macro-runner", payload: launch };

function runnerDependencies(observer: MacroRunnerObserver, answer?: string) {
    const execute = jest.fn(async () => {
        {
            const base = {
                id: "event",
                parentId: null,
                timestamp: new Date().toISOString(),
                agentId: "runner",
            };
            observer.record({
                ...base,
                type: "subagent.started",
                data: {
                    toolCallId: "typeagent-macro-run",
                    agentName: "typeagent:typeagent-macro-runner-host",
                    agentDisplayName: "Macro runner",
                    agentDescription: "Runner",
                    model: "gpt-6-luna",
                },
            });
            if (answer)
                observer.record({
                    ...base,
                    type: "assistant.message",
                    data: { messageId: "answer", content: answer },
                });
            observer.record({
                ...base,
                type: "subagent.completed",
                data: {
                    toolCallId: "typeagent-macro-run",
                    agentName: "typeagent:typeagent-macro-runner",
                    agentDisplayName: "Macro runner",
                },
            });
        }
        return "Task returned";
    });
    return {
        inspect: jest.fn(async () => launch.macro),
        execute,
        cancel: jest.fn(async () => ({ cancelled: true })),
        subscribe: () => () => {},
    };
}

describe("host-controlled macro runner", () => {
    const originalDataDir = process.env.TYPEAGENT_PLUGIN_DATA;
    let dataDir: string;
    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), "typeagent-macro-host-test-"));
        process.env.TYPEAGENT_PLUGIN_DATA = dataDir;
    });
    afterEach(() => {
        rmSync(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalDataDir;
    });
    it("validates the catalog before launching Luna once and returns its full answer", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(
            observer,
            "Vega checklist\nOwner: Vega\n1. Ready\n2. Verified",
        );
        expect(
            await executeNativeMacro(
                launch,
                Date.now(),
                new AbortController().signal,
                observer,
                dependencies,
            ),
        ).toContain("1. Ready\n2. Verified");
        expect(dependencies.execute).toHaveBeenCalledTimes(1);
        expect(dependencies.inspect).toHaveBeenCalledTimes(1);
        expect(dependencies.inspect).toHaveBeenCalledWith({
            macroId: "approved",
            version: 2,
            requireRunnable: true,
        });
        expect(dependencies.inspect.mock.invocationCallOrder[0]).toBeLessThan(
            dependencies.execute.mock.invocationCallOrder[0],
        );
        expect(dependencies.execute).toHaveBeenCalledWith({
            name: "task",
            toolCallId: "typeagent-macro-run",
            arguments: {
                agent_type: "typeagent:typeagent-macro-runner-host",
                name: "macro-runner",
                description: "Execute approved macro",
                mode: "sync",
                prompt:
                    "The native TypeAgent host has already inspected and validated the exact approved catalog macro below. Do not call inspect_macro or perform another catalog lookup. Execute strictly one recorded step at a time under live permissions. Resolve bindings from current inputs and completed actual step results; a binding overrides any captured example argument. Never start a dependent step speculatively or in parallel. Keep all tool discovery, budgets, guards, and postconditions.\n\n" +
                    JSON.stringify({
                        status: "agentRequired",
                        launch,
                        hostValidation: {
                            source: "native-host-catalog",
                            macroId: "approved",
                            version: 2,
                        },
                    }),
            },
        });
        expect(JSON.parse(observer.report()).catalogValidation).toEqual({
            macroId: "approved",
            version: 2,
        });
    });

    it.each([
        { ...launch.macro, state: "disabled" },
        { ...launch.macro, version: 3 },
        { ...launch.macro, macroId: "another" },
        { ...launch.macro, steps: [{ toolName: "unexpected" }] },
    ])(
        "rejects changed catalog contents before launching: %j",
        async (macro) => {
            const observer = new MacroRunnerObserver();
            const dependencies = {
                ...runnerDependencies(observer),
                inspect: jest.fn(async () => macro),
            };
            await expect(
                executeNativeMacro(
                    launch,
                    Date.now(),
                    new AbortController().signal,
                    observer,
                    dependencies,
                ),
            ).rejects.toThrow();
            expect(dependencies.execute).not.toHaveBeenCalled();
            expect(
                JSON.parse(observer.report()).catalogValidation,
            ).toBeUndefined();
        },
    );

    it("surfaces catalog failure without launching or retrying", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(observer);
        dependencies.inspect.mockRejectedValueOnce(
            new Error("Macro is suppressed"),
        );
        await expect(
            executeNativeMacro(
                launch,
                Date.now(),
                new AbortController().signal,
                observer,
                dependencies,
            ),
        ).rejects.toThrow("Macro is suppressed");
        expect(dependencies.inspect).toHaveBeenCalledTimes(1);
        expect(dependencies.execute).not.toHaveBeenCalled();
    });

    it("does not launch when cancelled during catalog validation", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(observer);
        const abort = new AbortController();
        dependencies.inspect.mockImplementationOnce(async () => {
            abort.abort(new Error("Cancelled during inspection"));
            return launch.macro;
        });
        await expect(
            executeNativeMacro(
                launch,
                Date.now(),
                abort.signal,
                observer,
                dependencies,
            ),
        ).rejects.toThrow("Cancelled during inspection");
        expect(dependencies.execute).not.toHaveBeenCalled();
        expect(JSON.parse(observer.report()).catalogValidation).toBeUndefined();
    });

    it.each([
        { ...launch, macro: { ...launch.macro, state: "draft" } },
        { ...launch, macro: { ...launch.macro, schemaVersion: 99 } },
        { ...launch, macro: { ...launch.macro, capabilities: ["unknown"] } },
        {
            ...launch,
            macro: {
                ...launch.macro,
                schemaVersion: 2,
                capabilities: ["result-path-v1"],
            },
        },
        { ...launch, candidate: { ...launch.candidate, sourceVersion: 3 } },
        { ...launch, budgets: { ...launch.budgets, maxRetries: -1 } },
    ])(
        "rejects invalid/unapproved handoffs before launching: %j",
        async (invalid) => {
            const observer = new MacroRunnerObserver();
            const dependencies = runnerDependencies(observer);
            await expect(
                executeNativeMacro(
                    invalid,
                    Date.now(),
                    new AbortController().signal,
                    observer,
                    dependencies,
                ),
            ).rejects.toThrow();
            expect(dependencies.execute).not.toHaveBeenCalled();
        },
    );

    it("surfaces missing output without another execution", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(observer);
        await expect(
            executeNativeMacro(
                launch,
                Date.now(),
                new AbortController().signal,
                observer,
                dependencies,
            ),
        ).rejects.toThrow(
            "Macro runner did not complete exactly once with a user-facing answer.",
        );
        expect(dependencies.execute).toHaveBeenCalledTimes(1);
    });

    it.each(["direct", "mcp", "dev"] as const)(
        "never routes the runner's structured prompt again in %s mode",
        async (mode) => {
            markMacroRunnerSession("runner");
            const dependencies: RoutePromptDependencies = {
                claimRecording: jest.fn(async () => false),
                direct: jest.fn(async () => ({ handled: true })),
                mcp: jest.fn(() => ({})),
                dev: jest.fn(async () => ({})),
            };
            const input = {
                sessionId: "runner",
                timestamp: Date.now(),
                cwd: ".",
                prompt: JSON.stringify(handoff),
            };
            expect(
                await routePrompt(
                    input,
                    mode,
                    new AbortController().signal,
                    dependencies,
                ),
            ).toEqual({});
            expect(dependencies.claimRecording).not.toHaveBeenCalled();
            expect(dependencies.direct).not.toHaveBeenCalled();
            expect(dependencies.mcp).not.toHaveBeenCalled();
            expect(dependencies.dev).not.toHaveBeenCalled();
            clearMacroRunnerSession("runner");
            await routePrompt(
                input,
                mode,
                new AbortController().signal,
                dependencies,
            );
            expect(dependencies.claimRecording).toHaveBeenCalledTimes(1);
        },
    );

    it("does not dispatch an already cancelled launch", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(observer);
        const abort = new AbortController();
        abort.abort(new Error("User cancelled"));
        await expect(
            executeNativeMacro(
                launch,
                Date.now(),
                abort.signal,
                observer,
                dependencies,
            ),
        ).rejects.toThrow("User cancelled");
        expect(dependencies.execute).not.toHaveBeenCalled();
    });

    it("surfaces a native permission denial without another execution", async () => {
        const observer = new MacroRunnerObserver();
        const execute = jest.fn<CopilotSession["rpc"]["tools"]["execute"]>(
            async () => ({
                resultType: "failure",
                textResultForLlm: "Permission denied",
            }),
        );
        await expect(
            executeNativeMacro(
                launch,
                Date.now(),
                new AbortController().signal,
                observer,
                {
                    inspect: async () => launch.macro,
                    execute,
                    cancel: async () => ({ cancelled: true }),
                    subscribe: () => () => {},
                },
            ),
        ).rejects.toThrow("Permission denied");
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("waits for authoritative child completion when the RPC reply arrives first", async () => {
        const observer = new MacroRunnerObserver();
        const dependencies = runnerDependencies(observer, "Actual answer");
        const emitEvents = dependencies.execute;
        dependencies.execute = jest.fn(async () => {
            setImmediate(() => void emitEvents());
            return "Task returned before completion notification";
        });
        expect(
            await executeNativeMacro(
                launch,
                Date.now(),
                new AbortController().signal,
                observer,
                dependencies,
            ),
        ).toBe("Actual answer");
    });

    it("cancels the exact owned child when the caller disconnects", async () => {
        const observer = new MacroRunnerObserver();
        const abort = new AbortController();
        let handler: ((event: SessionEvent) => void) | undefined;
        const event: SessionEvent = {
            id: "start",
            parentId: null,
            timestamp: new Date().toISOString(),
            agentId: "owned-child",
            type: "subagent.started",
            data: {
                agentName: "typeagent:typeagent-macro-runner",
                agentDisplayName: "Runner",
                agentDescription: "Runner",
                toolCallId: "typeagent-macro-run",
            },
        };
        const cancel = jest.fn(async () => ({ cancelled: true }));
        await expect(
            executeNativeMacro(launch, Date.now(), abort.signal, observer, {
                inspect: async () => launch.macro,
                execute: async () => {
                    handler?.(event);
                    abort.abort(new Error("Caller disconnected"));
                    return "Cancelled";
                },
                cancel,
                subscribe: (callback) => {
                    handler = callback;
                    return () => {
                        handler = undefined;
                    };
                },
            }),
        ).rejects.toThrow("Caller disconnected");
        expect(cancel).toHaveBeenCalledWith({ id: "owned-child" });
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("denies runner delegation but neither grants nor changes ordinary tool permissions", () => {
        const observer = new MacroRunnerObserver();
        observer.begin(Date.now() - 10, "host");
        observer.catalogValidated("approved", 2);
        observer.record({
            id: "started",
            parentId: null,
            timestamp: new Date().toISOString(),
            type: "subagent.started",
            agentId: "runner",
            data: {
                agentName: "typeagent:typeagent-macro-runner",
                agentDisplayName: "Macro runner",
                agentDescription: "Runner",
                toolCallId: "host",
                model: "gpt-6-luna",
            },
        });
        expect(observer.guard("runner", "fetch_document")).toBeUndefined();
        expect(observer.guard("runner", "inspect_macro")).toBeUndefined();
        expect(observer.guard("runner", "task")?.permissionDecision).toBe(
            "deny",
        );
        expect(
            observer.guard("runner", "run_factory")?.permissionDecision,
        ).toBe("deny");
        expect(observer.guard("root", "task")).toBeUndefined();
        expect(
            observer.guard("runner", "fetch_document")?.permissionDecision,
        ).toBe("deny");
        expect(() => observer.assertNoDelegation()).toThrow(
            "attempted nested delegation",
        );
        expect(JSON.parse(observer.report())).toMatchObject({
            kind: "typeagent-macro-phases",
            phases: [
                { phase: "host.dispatch", elapsedMs: expect.any(Number) },
                {
                    phase: "host.catalog-validated",
                    elapsedMs: expect.any(Number),
                },
                { phase: "subagent.started", elapsedMs: expect.any(Number) },
            ],
        });
        expect(observer.report()).not.toContain("Vega");
        observer.close();
    });

    it.each(["missing", "unrelated"])(
        "rejects %s host catalog verification",
        (caseName) => {
            const observer = new MacroRunnerObserver();
            observer.begin(Date.now(), "trusted-host");
            if (caseName === "unrelated")
                observer.catalogValidated("approved", 2);
            observer.record({
                id: "event",
                parentId: null,
                timestamp: new Date().toISOString(),
                agentId: "unrelated",
                type: "subagent.started",
                data: {
                    agentName: "typeagent:typeagent-macro-runner-host",
                    agentDisplayName: "Runner",
                    agentDescription: "Runner",
                    toolCallId:
                        caseName === "unrelated"
                            ? "caller-with-a-prompt-marker"
                            : "trusted-host",
                },
            });
            expect(
                observer.guard("unrelated", "inspect_macro")
                    ?.permissionDecision,
            ).toBe("deny");
            expect(
                observer.guard("unrelated", "lookup_document"),
            ).toMatchObject({
                permissionDecision: "deny",
                permissionDecisionReason: expect.stringContaining(
                    "hostValidation marker is not authorization",
                ),
            });
            observer.close();
        },
    );
});

describe("session-local macro host bridge", () => {
    let close: (() => void) | undefined;
    const originalDataDir = process.env.TYPEAGENT_PLUGIN_DATA;
    let dataDir: string;

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), "typeagent-macro-bridge-test-"));
        process.env.TYPEAGENT_PLUGIN_DATA = dataDir;
    });
    afterEach(() => {
        close?.();
        close = undefined;
        rmSync(dataDir, { recursive: true, force: true });
        if (originalDataDir === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalDataDir;
    });

    it("returns only the actual host answer for the matching native session", async () => {
        const sessionId = randomUUID();
        const execute = jest.fn(async () => "Actual checklist");
        close = await startMacroRunnerBridge(sessionId, execute, () => {});
        expect(await requestMacroRunner(sessionId, handoff)).toBe(
            "Actual checklist",
        );
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(
            expect.objectContaining(handoff),
            expect.any(Number),
            expect.any(AbortSignal),
        );
        await expect(
            requestMacroRunner(randomUUID(), handoff),
        ).rejects.toThrow();
    });

    it("reports execution errors and never falls back or retries after dispatch", async () => {
        const sessionId = randomUUID();
        const execute = jest.fn(async () => {
            throw new Error("Permission denied");
        });
        const log = jest.fn();
        close = await startMacroRunnerBridge(sessionId, execute, log);
        await expect(requestMacroRunner(sessionId, handoff)).rejects.toThrow(
            "Permission denied",
        );
        expect(execute).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("[macro-host] Permission denied");
    });

    it("rejects a wrong session capability before executing", async () => {
        const sessionId = randomUUID();
        const execute = jest.fn(async () => "Must not execute");
        close = await startMacroRunnerBridge(sessionId, execute, () => {});
        const directory = join(dataDir, "macro-runner-hosts");
        const key = readdirSync(directory).find((name) =>
            name.endsWith(".key"),
        );
        if (!key) throw new Error("Missing host capability");
        const owner = JSON.parse(readFileSync(join(directory, key), "utf8"));
        writeFileSync(
            join(directory, key),
            JSON.stringify({ ...owner, capability: "invalid-capability" }),
        );
        await expect(requestMacroRunner(sessionId, handoff)).rejects.toThrow(
            "Unauthorized macro host request.",
        );
        expect(execute).not.toHaveBeenCalled();
    });

    it("rejects overlapping handoffs without starting a second runner", async () => {
        const sessionId = randomUUID();
        let finish: ((answer: string) => void) | undefined;
        let started: (() => void) | undefined;
        const start = new Promise<void>((resolve) => {
            started = resolve;
        });
        const execute = jest.fn(async () => {
            started?.();
            return new Promise<string>((resolve) => {
                finish = resolve;
            });
        });
        close = await startMacroRunnerBridge(sessionId, execute, () => {});
        const first = requestMacroRunner(sessionId, handoff);
        await start;
        await expect(requestMacroRunner(sessionId, handoff)).rejects.toThrow(
            "A macro runner is already active.",
        );
        finish?.("First actual answer");
        expect(await first).toBe("First actual answer");
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("does not replace a live native session host", async () => {
        const sessionId = randomUUID();
        close = await startMacroRunnerBridge(
            sessionId,
            async () => "Actual answer",
            () => {},
        );
        await expect(
            startMacroRunnerBridge(
                sessionId,
                async () => "Wrong owner",
                () => {},
            ),
        ).rejects.toThrow(
            "A live macro host already owns this native session.",
        );
        expect(await requestMacroRunner(sessionId, handoff)).toBe(
            "Actual answer",
        );
    });

    it("reclaims only a host lease whose exact owning process no longer exists", async () => {
        const sessionId = randomUUID();
        close = await startMacroRunnerBridge(
            sessionId,
            async () => "First answer",
            () => {},
        );
        const directory = join(dataDir, "macro-runner-hosts");
        const key = readdirSync(directory).find((name) =>
            name.endsWith(".key"),
        );
        if (!key) throw new Error("Missing host capability");
        const ownership = readFileSync(join(directory, key), "utf8");
        close();
        writeFileSync(join(directory, key), ownership);
        const probe = jest.spyOn(process, "kill").mockImplementation(() => {
            throw Object.assign(new Error("Owner exited"), { code: "ESRCH" });
        });
        try {
            close = await startMacroRunnerBridge(
                sessionId,
                async () => "Resumed answer",
                () => {},
            );
            expect(probe).toHaveBeenCalledWith(process.pid, 0);
            expect(await requestMacroRunner(sessionId, handoff)).toBe(
                "Resumed answer",
            );
        } finally {
            probe.mockRestore();
        }
    });

    it("fails explicitly when the native host is unavailable instead of falling back", async () => {
        await expect(requestMacroRunner(randomUUID(), handoff)).rejects.toThrow(
            "Native macro host is unavailable",
        );
    });
});
