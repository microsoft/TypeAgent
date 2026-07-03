// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect } from "@jest/globals";
import { createLimiter } from "@typeagent/common-utils";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import {
    AppAgentHostApplicator,
    AppAgentHostApplyFns,
} from "../src/context/appAgentHost.js";
import { AppAgentManager } from "../src/context/appAgentManager.js";
import { PortRegistrar } from "../src/context/portRegistrar.js";
import {
    emitAgentChangeNotification,
    reconcileKnownAgents,
} from "../src/context/commandHandlerContext.js";

// A single-agent provider stub (the shape the source vends).
function fakeProvider(name: string): AppAgentProvider {
    return {
        getAppAgentNames: () => [name],
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

// A multi-agent provider stub (violates the single-agent invariant).
function fakeMultiProvider(...names: string[]): AppAgentProvider {
    return {
        getAppAgentNames: () => names,
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

// A deferred promise helper for gating apply functions / occupying the lock.
function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise((res) => setTimeout(res, 0));

describe("AppAgentHostApplicator", () => {
    it("applies ops in FIFO order (update remove-then-add lands in order)", async () => {
        const order: string[] = [];
        const apply: AppAgentHostApplyFns = {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        };
        const host = new AppAgentHostApplicator(createLimiter(1), apply);
        const p = fakeProvider("foo");

        // update = remove-then-add, enqueued back-to-back.
        const removeP = host.removeProvider(p);
        const addP = host.addProvider(p);
        await Promise.all([removeP, addP]);

        expect(order).toEqual(["remove:foo", "add:foo"]);
    });

    it("threads notify through to the apply functions", async () => {
        const seen: {
            addNotify?: boolean;
            removeNotify?: boolean;
        } = {};
        const apply: AppAgentHostApplyFns = {
            applyAdd: async (_p, notify) => {
                seen.addNotify = notify;
            },
            applyRemove: async (_p, notify) => {
                seen.removeNotify = notify;
            },
        };
        const host = new AppAgentHostApplicator(createLimiter(1), apply);
        await host.addProvider(fakeProvider("foo"), true);
        await host.removeProvider(fakeProvider("foo"), true);
        expect(seen).toEqual({
            addNotify: true,
            removeNotify: true,
        });
    });

    it("resolves the ack only when the op is applied", async () => {
        const gate = deferred();
        let applied = false;
        const apply: AppAgentHostApplyFns = {
            applyAdd: async () => {
                await gate.promise;
                applied = true;
            },
            applyRemove: async () => {},
        };
        const host = new AppAgentHostApplicator(createLimiter(1), apply);

        let ackResolved = false;
        const ack = host.addProvider(fakeProvider("foo")).then(() => {
            ackResolved = true;
        });

        await tick();
        // The apply function is blocked on the gate, so the ack must not resolve.
        expect(applied).toBe(false);
        expect(ackResolved).toBe(false);

        gate.resolve();
        await ack;
        expect(applied).toBe(true);
        expect(ackResolved).toBe(true);
    });

    it("idle-gates: defers application while the session is busy", async () => {
        const commandLock = createLimiter(1);
        let added = false;
        const apply: AppAgentHostApplyFns = {
            applyAdd: async () => {
                added = true;
            },
            applyRemove: async () => {},
        };
        const host = new AppAgentHostApplicator(commandLock, apply);

        // Occupy the single command-lock slot to simulate an in-flight command.
        const busy = deferred();
        const busyDone = commandLock(async () => {
            await busy.promise;
        });

        const ack = host.addProvider(fakeProvider("foo"));
        await tick();
        // The session is busy, so the op must not have applied yet.
        expect(added).toBe(false);

        // Release the session; the op now applies at idle.
        busy.resolve();
        await busyDone;
        await ack;
        expect(added).toBe(true);
    });

    it("dispose auto-acks pending removals and abandons queued ops", async () => {
        const commandLock = createLimiter(1);
        let removeCalls = 0;
        const apply: AppAgentHostApplyFns = {
            applyAdd: async () => {},
            applyRemove: async () => {
                removeCalls++;
            },
        };
        const host = new AppAgentHostApplicator(commandLock, apply);

        // Keep the session busy so the removal stays queued.
        const busy = deferred();
        const busyDone = commandLock(async () => {
            await busy.promise;
        });

        const removeAck = host.removeProvider(fakeProvider("foo"));
        await tick();

        // Dispose while the removal is still queued: it must auto-ack without
        // ever running applyRemove.
        host.dispose();
        await expect(removeAck).resolves.toBeUndefined();
        expect(removeCalls).toBe(0);

        // Drain the (now unrelated) busy task.
        busy.resolve();
        await busyDone;
        expect(removeCalls).toBe(0);
    });

    it("makes ops after dispose a no-op (fan-out that lands after close)", async () => {
        let calls = 0;
        const apply: AppAgentHostApplyFns = {
            applyAdd: async () => {
                calls++;
            },
            applyRemove: async () => {
                calls++;
            },
        };
        const host = new AppAgentHostApplicator(createLimiter(1), apply);
        host.dispose();

        await expect(
            host.addProvider(fakeProvider("foo")),
        ).resolves.toBeUndefined();
        await expect(
            host.removeProvider(fakeProvider("foo")),
        ).resolves.toBeUndefined();
        expect(calls).toBe(0);
        expect(host.isClosed).toBe(true);
    });

    it("dispose is idempotent", async () => {
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {},
            applyRemove: async () => {},
        });
        host.dispose();
        expect(() => host.dispose()).not.toThrow();
        expect(host.isClosed).toBe(true);
    });

    it("double dispose is safe and a late op after both disposes no-ops", async () => {
        let calls = 0;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {
                calls++;
            },
            applyRemove: async () => {
                calls++;
            },
        });
        host.dispose();
        host.dispose();
        await expect(
            host.addProvider(fakeProvider("late")),
        ).resolves.toBeUndefined();
        expect(calls).toBe(0);
        expect(host.isClosed).toBe(true);
    });

    it("rejects a multi-agent provider (single-agent invariant)", async () => {
        let addCalls = 0;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {
                addCalls++;
            },
            applyRemove: async () => {},
        });

        await expect(
            host.addProvider(fakeMultiProvider("foo", "bar")),
        ).rejects.toThrow(/single-agent provider/i);
        // The invariant fails before the op is ever applied.
        expect(addCalls).toBe(0);
    });

    it("propagates apply errors to the ack (issuing session awaited failure)", async () => {
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {
                throw new Error("collision");
            },
            applyRemove: async () => {},
        });
        await expect(host.addProvider(fakeProvider("foo"))).rejects.toThrow(
            /collision/,
        );
    });

    it("propagates applyRemove errors to the ack (symmetric to add)", async () => {
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {},
            applyRemove: async () => {
                throw new Error("unload failed");
            },
        });
        await expect(host.removeProvider(fakeProvider("foo"))).rejects.toThrow(
            /unload failed/,
        );
    });

    it("leaves an actively-running op to finish on dispose (only queued ops auto-ack)", async () => {
        const commandLock = createLimiter(1);
        const gate = deferred();
        let addFinished = false;
        let queuedRan = false;
        const host = new AppAgentHostApplicator(commandLock, {
            applyAdd: async () => {
                // First op: block mid-run until the gate opens.
                await gate.promise;
                addFinished = true;
            },
            applyRemove: async () => {
                queuedRan = true;
            },
        });

        // Op A starts running (acquires the lock, enters applyAdd, awaits gate).
        const ackA = host.addProvider(fakeProvider("A"), true);
        await tick();
        // Op B is queued behind the running op A.
        const ackB = host.removeProvider(fakeProvider("B"));
        await tick();

        // Dispose while A is actively running and B is still queued.
        host.dispose();

        // B (queued, not started) auto-acks without ever running.
        await expect(ackB).resolves.toBeUndefined();
        expect(queuedRan).toBe(false);
        expect(addFinished).toBe(false);

        // A is left to finish; its ack resolves after run() completes.
        gate.resolve();
        await expect(ackA).resolves.toBeUndefined();
        expect(addFinished).toBe(true);
    });

    it("settles the ack (and keeps pumping) if the command lock itself throws", async () => {
        // A command lock that rejects on its first acquisition — the failure is
        // in the gating, not in op.run. The op must still settle so its ack
        // never hangs, and a following op must still be applied.
        let lockCalls = 0;
        const flakyLock = <T>(cb: () => Promise<T>): Promise<T> => {
            lockCalls++;
            if (lockCalls === 1) {
                return Promise.reject(new Error("lock exploded"));
            }
            return cb();
        };
        let secondApplied = false;
        const host = new AppAgentHostApplicator(flakyLock, {
            applyAdd: async () => {
                secondApplied = true;
            },
            applyRemove: async () => {},
        });

        const firstAck = host.removeProvider(fakeProvider("A"));
        const secondAck = host.addProvider(fakeProvider("B"), true);

        await expect(firstAck).rejects.toThrow(/lock exploded/);
        await expect(secondAck).resolves.toBeUndefined();
        expect(secondApplied).toBe(true);
    });

    it("preserves FIFO across a longer mixed sequence", async () => {
        const order: string[] = [];
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });
        await Promise.all([
            host.addProvider(fakeProvider("A"), true),
            host.removeProvider(fakeProvider("A")),
            host.addProvider(fakeProvider("B"), true),
            host.addProvider(fakeProvider("C"), true),
            host.removeProvider(fakeProvider("B")),
            host.removeProvider(fakeProvider("C")),
        ]);
        expect(order).toEqual([
            "add:A",
            "remove:A",
            "add:B",
            "add:C",
            "remove:B",
            "remove:C",
        ]);
    });
});

describe("AppAgentManager.removeProvider", () => {
    it("is a no-op for a provider whose agent was never registered", async () => {
        const manager = new AppAgentManager(undefined, new PortRegistrar());
        // Unknown provider: removeAgent skips names it does not know, so the
        // whole removeProvider is a no-op that must not throw.
        await expect(
            manager.removeProvider(fakeProvider("never-registered")),
        ).resolves.toBeUndefined();
        expect(manager.getAppAgentNames()).toEqual([]);
    });

    it("tears down a registered single-agent provider (schemas dropped, agent unloaded)", async () => {
        const manager = new AppAgentManager(undefined, new PortRegistrar());
        let unloaded: string | undefined;
        const provider: AppAgentProvider = {
            getAppAgentNames: () => ["foo"],
            getAppAgentManifest: async () => ({}) as any,
            loadAppAgent: async () => ({}) as any,
            unloadAppAgent: async (name: string) => {
                unloaded = name;
            },
        };

        // Seed a registered agent record + its action config directly (the same
        // internals-seeding approach used by agentReadiness.spec.ts), so we can
        // exercise removeProvider's teardown without the heavy addProvider load
        // path. `appAgent` is set so removeAgent reaches unloadAppAgent.
        (manager as any).agents.set("foo", {
            name: "foo",
            provider,
            schemas: new Set<string>(["foo"]),
            actions: new Set<string>(),
            commands: false,
            manifest: { description: "foo", emojiChar: "🤖" },
            appAgent: {},
            schemaErrors: new Map(),
        });
        (manager as any).actionConfigs.set("foo", {
            schemaName: "foo",
            transient: false,
        });

        expect(manager.getAppAgentNames()).toEqual(["foo"]);
        expect(manager.getSchemaNames()).toContain("foo");

        await manager.removeProvider(provider);

        // Agent gone, schema config dropped, provider unloaded by identity.
        expect(manager.getAppAgentNames()).toEqual([]);
        expect(manager.getSchemaNames()).not.toContain("foo");
        expect(unloaded).toBe("foo");
    });
});

describe("emitAgentChangeNotification (sibling system messages, §5)", () => {
    function captureClientIO() {
        const messages: string[] = [];
        return {
            messages,
            clientIO: {
                notify: (
                    _requestId: unknown,
                    _event: unknown,
                    message: string,
                ) => {
                    messages.push(message);
                },
            } as any,
        };
    }

    it("a fanned-out add to a sibling reports disabled + how to enable", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(
            clientIO,
            "add",
            fakeProvider("foo"),
            false,
        );
        expect(messages).toEqual([
            "Agent 'foo' was added — disabled (`@config agent foo` to enable).",
        ]);
    });

    it("an enabled add reports plainly (no config hint)", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(clientIO, "add", fakeProvider("foo"), true);
        expect(messages).toEqual(["Agent 'foo' was added — enabled."]);
    });

    it("a fanned-out remove reports removal", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(
            clientIO,
            "remove",
            fakeProvider("foo"),
            false,
        );
        expect(messages).toEqual(["Agent 'foo' was removed."]);
    });
});

describe("reconcileKnownAgents (load-time reconciliation, §5 Model B)", () => {
    function makeContext(opts: {
        available: string[];
        known: string[] | undefined;
        // Agents considered "enabled" for the notification wording.
        enabled?: string[];
    }) {
        const enabled = new Set(opts.enabled ?? opts.available);
        const messages: string[] = [];
        let saved: string[] | undefined;
        const context = {
            agents: {
                getAppAgentNames: () => opts.available,
                isCommandEnabled: (name: string) => enabled.has(name),
                getSchemaNames: () => [] as string[],
                isSchemaEnabled: () => false,
            },
            session: {
                getKnownAgents: () => opts.known,
                setKnownAgents: (names: readonly string[]) => {
                    saved = [...names];
                },
            },
            clientIO: {
                notify: (
                    _requestId: unknown,
                    _event: unknown,
                    message: string,
                ) => {
                    messages.push(message);
                },
            },
        } as any;
        return { context, messages, getSaved: () => saved };
    }

    it("records a silent baseline when no known set exists", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: undefined,
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });

    it("reports an agent that appeared while offline (enabled)", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: ["browser"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual(["Agent set changed: email added — enabled."]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });

    it("reports an appeared agent as disabled with how-to-enable", () => {
        const { context, messages } = makeContext({
            available: ["browser", "email"],
            known: ["browser"],
            enabled: ["browser"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([
            "Agent set changed: email added — disabled (`@config agent email` to enable).",
        ]);
    });

    it("reports an agent that disappeared while offline", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual(["Agent set changed: email removed."]);
        expect(getSaved()).toEqual(["browser"]);
    });

    it("summarizes mixed add + remove in a single message", () => {
        const { context, messages } = makeContext({
            available: ["browser", "player"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([
            "Agent set changed: player added — enabled; email removed.",
        ]);
    });

    it("stays silent (but re-baselines) when nothing changed", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });
});
