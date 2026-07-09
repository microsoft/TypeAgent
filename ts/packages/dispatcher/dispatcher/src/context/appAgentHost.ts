// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Limiter } from "@typeagent/common-utils";
import registerDebug from "debug";
import {
    AppAgentHost,
    AppAgentProvider,
} from "../agentProvider/agentProvider.js";

const debug = registerDebug("typeagent:dispatcher:agentHost");

type QueuedOp = {
    readonly kind: "add" | "remove" | "replace";
    readonly run: () => Promise<void>;
    resolve: () => void;
    reject: (reason?: unknown) => void;
    // Settled once the ack has resolved/rejected (applied, abandoned, or errored).
    settled: boolean;
    // True once `run()` has actually started (past the closed-check inside the
    // command lock). A running op is left to finish; dispose only auto-acks ops
    // that have not started.
    running: boolean;
};

/**
 * The two dispatcher-side operations the applicator drives. Injected so the
 * applicator is decoupled from `CommandHandlerContext` and unit-testable in
 * isolation (queue ordering, ack timing, idle-gating, dispose auto-ack).
 */
export type AppAgentHostApplyFns = {
    // Register a provider's single agent; its enabled state is derived from
    // session config, falling back to the agent's manifest default.
    // `notify` requests a sibling fan-out system message.
    applyAdd: (provider: AppAgentProvider, notify: boolean) => Promise<void>;
    // Unload a previously-added provider by identity. `notify` requests a
    // sibling fan-out system message. `dropConfig` clears the
    // agent's persisted enable preference (true for uninstall, false for the
    // remove leg of an update, which preserves it across a version bump).
    applyRemove: (
        provider: AppAgentProvider,
        notify: boolean,
        dropConfig: boolean,
    ) => Promise<void>;
};

/**
 * The dispatcher-side {@link AppAgentHost} implementation: an idle-gated FIFO
 * applicator. Each `addProvider` / `removeProvider` is
 * enqueued and applied at the session's next idle (gated through the session's
 * command lock, so it runs between user commands and never interleaves with an
 * in-flight command), in FIFO order (so an update's remove-then-add lands in
 * order). The returned Promise resolves when the op is **applied** — the ack the
 * source's lifecycle tracker waits on.
 *
 * On {@link dispose}, queued ops (including one waiting on the command lock) are
 * abandoned and their acks resolved (auto-ack: a gone session has removed
 * everything), and any later op is a no-op — so a fan-out that lands after close
 * cannot touch a torn-down session.
 */
export class AppAgentHostApplicator implements AppAgentHost {
    private closed = false;
    // All enqueued-but-not-settled ops (including the one currently waiting on
    // or holding the command lock), so dispose can auto-ack them.
    private readonly pending = new Set<QueuedOp>();

    constructor(
        // The session's single-slot command lock; gating each op on it defers
        // application until the session is idle.
        private readonly commandLock: Limiter,
        private readonly apply: AppAgentHostApplyFns,
    ) {}

    public addProvider(
        provider: AppAgentProvider,
        notify: boolean = false,
    ): Promise<void> {
        // Assert the single-agent invariant at the add boundary:
        // source-vended providers are single-agent, so a facade regression
        // fails loudly rather than desyncing the source's per-name lifecycle
        // tracker.
        const names = provider.getAppAgentNames();
        if (names.length !== 1) {
            return Promise.reject(
                new Error(
                    `AppAgentHost.addProvider requires a single-agent provider; got ${names.length} name(s): [${names.join(", ")}]`,
                ),
            );
        }
        const run = () => this.apply.applyAdd(provider, notify);
        return this.enqueue("add", run);
    }

    public removeProvider(
        provider: AppAgentProvider,
        notify: boolean = false,
        dropConfig: boolean = true,
    ): Promise<void> {
        const run = () => this.apply.applyRemove(provider, notify, dropConfig);
        return this.enqueue("remove", run);
    }

    public replaceProvider(
        oldProvider: AppAgentProvider,
        resolveReplacement: () => Promise<AppAgentProvider | undefined>,
        notify: boolean = false,
        dropConfig: boolean = false,
    ): Promise<void> {
        // Assert the single-agent invariant on the old provider at the boundary;
        // the new provider is asserted below when it is built.
        const oldNames = oldProvider.getAppAgentNames();
        if (oldNames.length !== 1) {
            return Promise.reject(
                new Error(
                    `AppAgentHost.replaceProvider requires a single-agent old provider; got ${oldNames.length} name(s): [${oldNames.join(", ")}]`,
                ),
            );
        }
        // Default to preserving the enable preference: a bare
        // `replaceProvider` is a swap, not a removal, so unlike `removeProvider`
        // (which defaults dropConfig=true for uninstall) it keeps config by
        // default. The barrier always passes `dropConfig` explicitly regardless.
        // The whole teardown → quiesce → wait → (add) sequence is ONE command
        // lock job: no user command interleaves between the remove and the add.
        // Teardown/startup are leaf ops — they never reacquire the command lock
        // or dispatch a command.
        const run = async () => {
            // 1. Teardown leg: unload `old` + drop routing (decrement the shared
            //    refcount), exactly like a remove.
            await this.apply.applyRemove(oldProvider, notify, dropConfig);
            // 2. Let the source fill this host's barrier slot, park (still
            //    holding the command lock), and decide what should be added.
            const newProvider = await resolveReplacement();
            // The session may have been torn down while parked (dispose leaves a
            // running op to finish): skip the startup leg rather than add the
            // new version into a closing session. The source already dropped this
            // host from the barrier on disconnect, so this is a clean no-op.
            if (this.closed) {
                return;
            }
            // 3. Startup leg: add whatever the source returned. The source
            //    decides post-barrier: the NEW version on a committed update, the OLD version on a
            //    cancelled/timed-out update that ROLLS BACK (v1 restored), or
            //    `undefined` (no add) on a committed uninstall (`old → ∅`).
            if (newProvider !== undefined) {
                const newNames = newProvider.getAppAgentNames();
                if (newNames.length !== 1) {
                    throw new Error(
                        `AppAgentHost.replaceProvider requires a single-agent new provider; got ${newNames.length} name(s): [${newNames.join(", ")}]`,
                    );
                }
                await this.apply.applyAdd(newProvider, notify);
            }
        };
        return this.enqueue("replace", run);
    }

    /** True once {@link dispose} has been called. */
    public get isClosed(): boolean {
        return this.closed;
    }

    private enqueue(
        kind: "add" | "remove" | "replace",
        run: () => Promise<void>,
    ): Promise<void> {
        if (this.closed) {
            // Late op (fan-out that lands after dispose): no-op.
            debug(`Skipping ${kind} on closed host`);
            return Promise.resolve();
        }
        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        const op: QueuedOp = {
            kind,
            run,
            resolve,
            reject,
            settled: false,
            running: false,
        };
        this.pending.add(op);
        void this.commandLock(async () => {
            if (op.settled) {
                return;
            }
            if (this.closed) {
                this.settle(op, op.resolve);
                return;
            }
            op.running = true;
            try {
                await op.run();
                this.settle(op, op.resolve);
            } catch (e) {
                this.settle(op, () => op.reject(e));
            }
        }).catch((e) => {
            // The command lock itself failed (not op.run) — settle the op so
            // its ack never hangs.
            this.settle(op, () => op.reject(e));
        });
        return promise;
    }

    private settle(op: QueuedOp, complete: () => void): void {
        if (op.settled) {
            return;
        }
        op.settled = true;
        this.pending.delete(op);
        complete();
    }

    /**
     * Abandon queued ops and auto-ack them. An op already running
     * `run()` is left to finish; every not-yet-started op (queued, or waiting on
     * the command lock) is auto-acked. Idempotent. After this,
     * {@link addProvider}/{@link removeProvider} are no-ops.
     */
    public dispose(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const op of [...this.pending]) {
            if (!op.running) {
                this.settle(op, op.resolve);
            }
        }
    }
}
