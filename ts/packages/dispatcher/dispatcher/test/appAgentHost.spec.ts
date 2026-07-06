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

    it("threads notify/dropConfig through and no-ops after dispose", async () => {
        const seen: {
            addNotify?: boolean;
            removeNotify?: boolean;
            dropConfig?: boolean;
        } = {};
        let calls = 0;
        const apply: AppAgentHostApplyFns = {
            applyAdd: async (_p, notify) => {
                calls++;
                seen.addNotify = notify;
            },
            applyRemove: async (_p, notify, dropConfig) => {
                calls++;
                seen.removeNotify = notify;
                seen.dropConfig = dropConfig;
            },
        };
        const host = new AppAgentHostApplicator(createLimiter(1), apply);
        // No command is holding the lock, so each enqueued op applies at idle.
        await host.addProvider(fakeProvider("foo"), true);
        await host.removeProvider(fakeProvider("foo"), true, false);
        expect(seen).toEqual({
            addNotify: true,
            removeNotify: true,
            dropConfig: false,
        });

        host.dispose();
        // A late op after teardown is a no-op (6).
        await expect(
            host.addProvider(fakeProvider("foo"), false),
        ).resolves.toBeUndefined();
        expect(calls).toBe(2);
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

    it("replaceProvider holds one command-lock section across remove → wait → add (no interleave)", async () => {
        const order: string[] = [];
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });

        const ready = deferred();
        let quiesced = false;
        const replaceAck = host.replaceProvider(
            fakeProvider("v1"),
            () => fakeProvider("v2"),
            {
                onQuiesced: () => {
                    quiesced = true;
                },
                whenReady: ready.promise,
            },
        );

        await tick();
        // The teardown leg has run and the host has quiesced, but the barrier is
        // not released yet, so the add is parked — the op still holds the lock.
        expect(order).toEqual(["remove:v1"]);
        expect(quiesced).toBe(true);

        // A user op enqueued now is stuck behind the parked replace (single
        // command-lock section): it must NOT interleave between remove and add.
        const userAck = host.removeProvider(fakeProvider("user"), true, false);
        await tick();
        expect(order).toEqual(["remove:v1"]);

        // Release the barrier: the replace adds v2, then the queued user op runs.
        ready.resolve();
        await Promise.all([replaceAck, userAck]);
        expect(order).toEqual(["remove:v1", "add:v2", "remove:user"]);
    });

    it("replaceProvider omits the add for an uninstall (old → ∅)", async () => {
        const order: string[] = [];
        let quiesced = false;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p, _n, dropConfig) => {
                order.push(`remove:${p.getAppAgentNames()[0]}:${dropConfig}`);
            },
        });

        // Uninstall passes no new-provider thunk and dropConfig=true.
        const ack = host.replaceProvider(fakeProvider("gone"), undefined, {
            onQuiesced: () => {
                quiesced = true;
            },
            whenReady: Promise.resolve(),
            notify: true,
            dropConfig: true,
        });
        await ack;

        // Only the teardown leg ran (with dropConfig threaded); no add.
        expect(order).toEqual(["remove:gone:true"]);
        expect(quiesced).toBe(true);
    });

    it("replaceProvider omits the add when the thunk returns undefined (post-barrier rollback/uninstall decision)", async () => {
        const order: string[] = [];
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });

        // A thunk is supplied, but it resolves to `undefined` — the source
        // decided post-barrier to add nothing (a rolled-back uninstall, or an
        // update that reverted with no version to re-add). The teardown leg runs;
        // the add is skipped without touching the single-agent invariant.
        let thunkCalls = 0;
        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => {
                thunkCalls++;
                return undefined;
            },
            {
                onQuiesced: () => {},
                whenReady: Promise.resolve(),
                notify: true,
            },
        );
        await ack;

        expect(order).toEqual(["remove:v1"]);
        expect(thunkCalls).toBe(1);
    });

    it("replaceProvider rejects a multi-agent old provider before any apply", async () => {
        let calls = 0;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {
                calls++;
            },
            applyRemove: async () => {
                calls++;
            },
        });
        await expect(
            host.replaceProvider(
                fakeMultiProvider("a", "b"),
                () => fakeProvider("v2"),
                {
                    onQuiesced: () => {},
                    whenReady: Promise.resolve(),
                },
            ),
        ).rejects.toThrow(/single-agent old provider/i);
        expect(calls).toBe(0);
    });

    it("replaceProvider rejects a multi-agent new provider after the teardown leg", async () => {
        const order: string[] = [];
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });
        await expect(
            host.replaceProvider(
                fakeProvider("v1"),
                () => fakeMultiProvider("a", "b"),
                {
                    onQuiesced: () => {},
                    whenReady: Promise.resolve(),
                },
            ),
        ).rejects.toThrow(/single-agent new provider/i);
        // The teardown leg still ran (the old version is down); only the add is
        // skipped because the new provider violates the invariant.
        expect(order).toEqual(["remove:v1"]);
    });

    it("dispose auto-acks a queued replace without running it", async () => {
        const commandLock = createLimiter(1);
        let calls = 0;
        const host = new AppAgentHostApplicator(commandLock, {
            applyAdd: async () => {
                calls++;
            },
            applyRemove: async () => {
                calls++;
            },
        });

        // Keep the session busy so the replace stays queued.
        const busy = deferred();
        const busyDone = commandLock(async () => {
            await busy.promise;
        });

        let quiesced = false;
        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => fakeProvider("v2"),
            {
                onQuiesced: () => {
                    quiesced = true;
                },
                whenReady: Promise.resolve(),
            },
        );
        await tick();

        host.dispose();
        await expect(ack).resolves.toBeUndefined();
        // Never ran: neither leg applied and the host never quiesced.
        expect(calls).toBe(0);
        expect(quiesced).toBe(false);

        busy.resolve();
        await busyDone;
        expect(calls).toBe(0);
    });

    it("a replace parked on whenReady skips the add after dispose (closed re-check)", async () => {
        const order: string[] = [];
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });

        const ready = deferred();
        let quiesced = false;
        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => fakeProvider("v2"),
            {
                onQuiesced: () => {
                    quiesced = true;
                },
                whenReady: ready.promise,
            },
        );

        await tick();
        // The teardown leg ran and the host quiesced; the op is parked mid-run
        // on whenReady (running, so dispose leaves it to finish, ).
        expect(order).toEqual(["remove:v1"]);
        expect(quiesced).toBe(true);

        host.dispose();
        // Release the barrier: the parked op resumes but must NOT add v2 into a
        // torn-down session — the closed re-check short-circuits the add leg.
        ready.resolve();
        await expect(ack).resolves.toBeUndefined();
        expect(order).toEqual(["remove:v1"]);
    });

    it("replaceProvider on an already-closed host auto-acks without onQuiesced or legs", async () => {
        // A host that is CLOSED at enqueue time auto-acks with a resolved promise
        // and never runs `run()`, so `onQuiesced`/the legs/the thunk never fire.
        // The source barrier's success continuation depends on this: it re-calls
        // `quiesce` to fill the phase-1 slot for exactly such a host.
        let calls = 0;
        let quiesced = false;
        let thunkCalls = 0;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async () => {
                calls++;
            },
            applyRemove: async () => {
                calls++;
            },
        });
        host.dispose();

        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => {
                thunkCalls++;
                return fakeProvider("v2");
            },
            {
                onQuiesced: () => {
                    quiesced = true;
                },
                whenReady: Promise.resolve(),
                notify: true,
                dropConfig: false,
            },
        );
        await expect(ack).resolves.toBeUndefined();
        expect(calls).toBe(0);
        expect(quiesced).toBe(false);
        expect(thunkCalls).toBe(0);
    });

    it("replaceProvider calls the thunk exactly once, only after whenReady resolves", async () => {
        const order: string[] = [];
        let thunkCalls = 0;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });

        const ready = deferred();
        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => {
                thunkCalls++;
                return fakeProvider("v2");
            },
            {
                onQuiesced: () => {},
                whenReady: ready.promise,
            },
        );

        await tick();
        // Parked on the barrier: the teardown ran but the thunk is NOT called
        // until the source decides (post-barrier), so the add version is chosen
        // from post-barrier state.
        expect(thunkCalls).toBe(0);
        expect(order).toEqual(["remove:v1"]);

        ready.resolve();
        await ack;
        expect(thunkCalls).toBe(1);
        expect(order).toEqual(["remove:v1", "add:v2"]);
    });

    it("replaceProvider releases the lock and rejects when the thunk throws (teardown already applied)", async () => {
        const order: string[] = [];
        let quiesced = false;
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (p) => {
                order.push(`add:${p.getAppAgentNames()[0]}`);
            },
            applyRemove: async (p) => {
                order.push(`remove:${p.getAppAgentNames()[0]}`);
            },
        });

        const ack = host.replaceProvider(
            fakeProvider("v1"),
            () => {
                throw new Error("build v2 failed");
            },
            {
                onQuiesced: () => {
                    quiesced = true;
                },
                whenReady: Promise.resolve(),
            },
        );
        await expect(ack).rejects.toThrow(/build v2 failed/);
        // The teardown leg ran + quiesced (irreversible); the add is skipped.
        expect(order).toEqual(["remove:v1"]);
        expect(quiesced).toBe(true);
        // The single command-lock slot was released on the throw: a following op
        // still applies (the lock was not leaked).
        await host.addProvider(fakeProvider("after"));
        expect(order).toEqual(["remove:v1", "add:after"]);
    });

    it("replaceProvider threads notify to both legs and defaults dropConfig=false (update)", async () => {
        const seen: {
            addNotify?: boolean;
            removeNotify?: boolean;
            dropConfig?: boolean;
        } = {};
        const host = new AppAgentHostApplicator(createLimiter(1), {
            applyAdd: async (_p, n) => {
                seen.addNotify = n;
            },
            applyRemove: async (_p, n, d) => {
                seen.removeNotify = n;
                seen.dropConfig = d;
            },
        });
        // No dropConfig supplied → the update default (Model B: preserve the
        // enable preference across a version bump) must thread `false`.
        await host.replaceProvider(
            fakeProvider("v1"),
            () => fakeProvider("v2"),
            {
                onQuiesced: () => {},
                whenReady: Promise.resolve(),
                notify: true,
            },
        );
        expect(seen).toEqual({
            addNotify: true,
            removeNotify: true,
            dropConfig: false,
        });
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

describe("emitAgentChangeNotification (sibling system messages, )", () => {
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

describe("reconcileKnownAgents (load-time reconciliation,  Model B)", () => {
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
