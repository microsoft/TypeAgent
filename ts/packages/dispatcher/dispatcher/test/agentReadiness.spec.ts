// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the AppAgentManager readiness/setup framework and the
 * dispatcher's pre-flight gate (`checkAgentReady`).
 *
 * AppAgentManager has heavy collaborators (provider loading, grammar
 * compilation, schema cache); these tests construct an empty manager and
 * seed its private `agents` / `readiness` maps directly via `as any`, which
 * keeps the tests focused on the readiness logic without dragging in agent
 * loading.
 */

import { AppAgentManager } from "../src/context/appAgentManager.js";
import { PortRegistrar } from "../src/context/portRegistrar.js";
import { checkAgentReady } from "../src/execute/actionHandlers.js";
import type {
    ActionContext,
    ActionResult,
    AppAgent,
    ReadinessReport,
} from "@typeagent/agent-sdk";

// Build a minimally-populated manager. Tests poke at internals to set up
// agent records — the alternative is to load real agents via providers,
// which crosses too many seams for a unit test.
function makeManager(): AppAgentManager {
    return new AppAgentManager(undefined, new PortRegistrar());
}

test("AppAgentManager can disable action-schema semantic embeddings", () => {
    const manager = new AppAgentManager(
        undefined,
        new PortRegistrar(),
        undefined,
        undefined,
        false,
    );

    expect(manager.getActionEmbeddings()).toBeUndefined();
});

// Drop a synthetic agent record so getReadiness/runSetup/refresh see it.
function seedAgent(
    mgr: AppAgentManager,
    name: string,
    opts: {
        appAgent?: Partial<AppAgent>;
        sessionContext?: any;
    } = {},
): void {
    const record = {
        name,
        schemas: new Set<string>(),
        actions: new Set<string>(),
        commands: false,
        manifest: { description: name, emojiChar: "🤖" },
        appAgent: opts.appAgent as AppAgent | undefined,
        sessionContext: opts.sessionContext ?? {},
        schemaErrors: new Map(),
    };
    (mgr as any).agents.set(name, record);
}

function setReadiness(
    mgr: AppAgentManager,
    name: string,
    report: ReadinessReport,
): void {
    (mgr as any).readiness.set(name, report);
}

describe("AppAgentManager.getReadiness", () => {
    test("returns {state: 'ready'} when no entry is cached", () => {
        const mgr = makeManager();
        expect(mgr.getReadiness("missing")).toEqual({ state: "ready" });
    });

    test("returns the cached entry when set", () => {
        const mgr = makeManager();
        const report: ReadinessReport = {
            state: "setup-required",
            message: "needs config",
        };
        setReadiness(mgr, "agentX", report);
        expect(mgr.getReadiness("agentX")).toBe(report);
    });
});

describe("AppAgentManager.getNotReadyAgents", () => {
    test("returns empty when nothing is cached", () => {
        const mgr = makeManager();
        expect(mgr.getNotReadyAgents()).toEqual([]);
    });

    test("filters out ready agents and surfaces the non-ready ones", () => {
        const mgr = makeManager();
        setReadiness(mgr, "ready1", { state: "ready" });
        setReadiness(mgr, "needsSetup", {
            state: "setup-required",
            message: "missing exe",
        });
        setReadiness(mgr, "unsupported", {
            state: "unsupported",
            message: "macOS",
        });
        const out = mgr.getNotReadyAgents();
        const names = out.map((e) => e.name).sort();
        expect(names).toEqual(["needsSetup", "unsupported"]);
        expect(out.find((e) => e.name === "needsSetup")?.report.message).toBe(
            "missing exe",
        );
    });
});

describe("AppAgentManager.hasSetup", () => {
    test("false when agent record is missing", () => {
        const mgr = makeManager();
        expect(mgr.hasSetup("missing")).toBe(false);
    });

    test("false when agent has no setup hook", () => {
        const mgr = makeManager();
        seedAgent(mgr, "noSetup", { appAgent: {} });
        expect(mgr.hasSetup("noSetup")).toBe(false);
    });

    test("true when agent implements setup", () => {
        const mgr = makeManager();
        seedAgent(mgr, "withSetup", {
            appAgent: { setup: async () => undefined },
        });
        expect(mgr.hasSetup("withSetup")).toBe(true);
    });
});

describe("AppAgentManager.refreshReadiness", () => {
    test("preserves the existing entry when agent is missing", async () => {
        const mgr = makeManager();
        setReadiness(mgr, "stale", {
            state: "setup-required",
            message: "old",
        });
        const out = await mgr.refreshReadiness("stale");
        expect(out).toEqual({ state: "setup-required", message: "old" });
    });

    test("returns ready when agent doesn't implement checkReadiness", async () => {
        const mgr = makeManager();
        seedAgent(mgr, "agentA", { appAgent: {} });
        const out = await mgr.refreshReadiness("agentA");
        expect(out).toEqual({ state: "ready" });
    });

    test("calls checkReadiness and stores the result in the cache", async () => {
        const mgr = makeManager();
        const report: ReadinessReport = {
            state: "setup-required",
            message: "needs cert",
        };
        seedAgent(mgr, "agentB", {
            appAgent: { checkReadiness: async () => report },
        });
        const out = await mgr.refreshReadiness("agentB");
        expect(out).toBe(report);
        expect(mgr.getReadiness("agentB")).toBe(report);
    });

    test("converts thrown errors into setup-required with the error message", async () => {
        const mgr = makeManager();
        seedAgent(mgr, "agentC", {
            appAgent: {
                checkReadiness: async () => {
                    throw new Error("probe blew up");
                },
            },
        });
        const out = await mgr.refreshReadiness("agentC");
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("probe blew up");
    });

    test("dedupes concurrent callers to one in-flight probe", async () => {
        const mgr = makeManager();
        let calls = 0;
        let resolve!: (r: ReadinessReport) => void;
        const gate = new Promise<ReadinessReport>((r) => (resolve = r));
        seedAgent(mgr, "agentD", {
            appAgent: {
                checkReadiness: async () => {
                    calls++;
                    return gate;
                },
            },
        });
        const p1 = mgr.refreshReadiness("agentD");
        const p2 = mgr.refreshReadiness("agentD");
        const p3 = mgr.refreshReadiness("agentD");
        // All three must share the same in-flight promise, so checkReadiness
        // is invoked exactly once.
        expect(calls).toBe(1);
        resolve({ state: "ready" });
        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
        expect(r1).toEqual({ state: "ready" });
        expect(r2).toEqual({ state: "ready" });
        expect(r3).toEqual({ state: "ready" });
    });

    test("releases the in-flight slot so subsequent calls re-probe", async () => {
        const mgr = makeManager();
        let calls = 0;
        seedAgent(mgr, "agentE", {
            appAgent: {
                checkReadiness: async () => {
                    calls++;
                    return { state: "ready" } as ReadinessReport;
                },
            },
        });
        await mgr.refreshReadiness("agentE");
        await mgr.refreshReadiness("agentE");
        expect(calls).toBe(2);
    });
});

describe("AppAgentManager.runSetup", () => {
    function fakeActionContext(): ActionContext<unknown> {
        return {
            sessionContext: {} as any,
            actionIO: {
                appendDisplay: () => {},
                setDisplay: () => {},
                takeAction: () => {},
            } as any,
            actionIndex: 0,
            queueToggleTransientAgent: () => {},
            // closeActionContext etc. aren't called in these tests.
        } as any;
    }

    test("returns undefined when agent has no setup hook", async () => {
        const mgr = makeManager();
        seedAgent(mgr, "agentA", { appAgent: {} });
        const out = await mgr.runSetup("agentA", fakeActionContext());
        expect(out).toBeUndefined();
    });

    test("invokes the agent's setup hook and returns its ActionResult", async () => {
        const mgr = makeManager();
        const fakeResult = { error: undefined } as unknown as ActionResult;
        seedAgent(mgr, "agentB", {
            appAgent: { setup: async () => fakeResult },
        });
        const out = await mgr.runSetup("agentB", fakeActionContext());
        expect(out).toBe(fakeResult);
    });

    test("re-checks readiness after setup succeeds", async () => {
        const mgr = makeManager();
        const checks: number[] = [];
        seedAgent(mgr, "agentC", {
            appAgent: {
                setup: async () => undefined,
                checkReadiness: async () => {
                    checks.push(Date.now());
                    return { state: "ready" } as ReadinessReport;
                },
            },
        });
        // Pretend we got here from a setup-required state.
        setReadiness(mgr, "agentC", {
            state: "setup-required",
            message: "needs work",
        });
        await mgr.runSetup("agentC", fakeActionContext());
        // refreshReadiness was called in the finally block, flipping the cache.
        expect(checks.length).toBe(1);
        expect(mgr.getReadiness("agentC")).toEqual({ state: "ready" });
    });

    test("re-checks readiness even when setup throws", async () => {
        const mgr = makeManager();
        let probed = 0;
        seedAgent(mgr, "agentD", {
            appAgent: {
                setup: async () => {
                    throw new Error("setup boom");
                },
                checkReadiness: async () => {
                    probed++;
                    return {
                        state: "setup-required",
                        message: "still broken",
                    } as ReadinessReport;
                },
            },
        });
        await expect(
            mgr.runSetup("agentD", fakeActionContext()),
        ).rejects.toThrow("setup boom");
        expect(probed).toBe(1);
    });

    test("rejects concurrent setup with a friendly in-progress result", async () => {
        const mgr = makeManager();
        let resolve!: () => void;
        const gate = new Promise<void>((r) => (resolve = r));
        let calls = 0;
        seedAgent(mgr, "agentE", {
            appAgent: {
                setup: async () => {
                    calls++;
                    await gate;
                    return undefined;
                },
            },
        });
        const p1 = mgr.runSetup("agentE", fakeActionContext());
        // While p1 is parked at `await gate`, fire a second call.
        const second = await mgr.runSetup("agentE", fakeActionContext());
        expect(calls).toBe(1);
        expect(second?.error).toMatch(/already in progress/i);
        resolve();
        await p1;
    });

    test("permits a fresh setup after the prior call settles", async () => {
        const mgr = makeManager();
        let calls = 0;
        seedAgent(mgr, "agentF", {
            appAgent: {
                setup: async () => {
                    calls++;
                    return undefined;
                },
            },
        });
        await mgr.runSetup("agentF", fakeActionContext());
        await mgr.runSetup("agentF", fakeActionContext());
        expect(calls).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Pre-flight gate (checkAgentReady)
// ---------------------------------------------------------------------------

function fakeSystemContext(opts: {
    readiness: Map<string, ReadinessReport>;
    setupOnFirstUse?: boolean;
    runSetupImpl?: (
        name: string,
        ctx: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>;
    hasSetup?: (name: string) => boolean;
}): any {
    const readiness = opts.readiness;
    return {
        agents: {
            getReadiness: (name: string) =>
                readiness.get(name) ?? { state: "ready" },
            runSetup:
                opts.runSetupImpl ??
                (async () => undefined as ActionResult | undefined),
            hasSetup: opts.hasSetup ?? (() => false),
        },
        session: {
            getConfig: () => ({
                execution: {
                    setupOnFirstUse: opts.setupOnFirstUse ?? false,
                },
            }),
        },
    };
}

const fakeActionContext = (): ActionContext<unknown> =>
    ({
        sessionContext: {} as any,
        actionIO: { appendDisplay: () => {} } as any,
    }) as any;

describe("checkAgentReady (pre-flight gate)", () => {
    test("returns undefined when the agent is ready", async () => {
        const sys = fakeSystemContext({ readiness: new Map() });
        const out = await checkAgentReady("agentA", sys, fakeActionContext());
        expect(out).toBeUndefined();
    });

    test("throws with a setup hint when state is setup-required and the agent has setup", async () => {
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentB", { state: "setup-required", message: "missing exe" }],
            ]),
            hasSetup: () => true,
        });
        await expect(
            checkAgentReady("agentB", sys, fakeActionContext()),
        ).rejects.toThrow(/@config agent setup agentB/);
    });

    test("throws with a refresh hint when the agent has no setup hook (manual config)", async () => {
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentC", { state: "setup-required", message: "set FOO_VAR" }],
            ]),
            hasSetup: () => false,
        });
        await expect(
            checkAgentReady("agentC", sys, fakeActionContext()),
        ).rejects.toThrow(/@config agent refresh agentC/);
    });

    test("throws with a 'not supported' message when state is unsupported", async () => {
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentD", { state: "unsupported", message: "macOS" }],
            ]),
        });
        await expect(
            checkAgentReady("agentD", sys, fakeActionContext()),
        ).rejects.toThrow(/not supported/i);
    });

    test("does not invoke runSetup when setupOnFirstUse is off", async () => {
        let calls = 0;
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentE", { state: "setup-required", message: "x" }],
            ]),
            hasSetup: () => true,
            runSetupImpl: async () => {
                calls++;
                return undefined;
            },
        });
        await expect(
            checkAgentReady("agentE", sys, fakeActionContext()),
        ).rejects.toThrow();
        expect(calls).toBe(0);
    });

    test("invokes runSetup and returns its result when setupOnFirstUse is on", async () => {
        const setupResult = { error: undefined } as unknown as ActionResult;
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentF", { state: "setup-required", message: "x" }],
            ]),
            setupOnFirstUse: true,
            runSetupImpl: async () => setupResult,
        });
        const out = await checkAgentReady("agentF", sys, fakeActionContext());
        expect(out).toBe(setupResult);
    });

    test("falls through to throw when setupOnFirstUse is on but runSetup returns undefined (no hook)", async () => {
        const sys = fakeSystemContext({
            readiness: new Map([
                ["agentG", { state: "setup-required", message: "x" }],
            ]),
            setupOnFirstUse: true,
            runSetupImpl: async () => undefined,
            hasSetup: () => false,
        });
        await expect(
            checkAgentReady("agentG", sys, fakeActionContext()),
        ).rejects.toThrow(/needs configuration/);
    });
});
