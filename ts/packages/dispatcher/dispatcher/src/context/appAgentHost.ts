// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Limiter } from "@typeagent/common-utils";
import registerDebug from "debug";
import {
    AppAgentHost,
    AppAgentProvider,
    ReplaceProviderOptions,
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
    // session config with the manifest default as fallback (5, Model B).
    // `notify` requests a sibling-fan-out system message (5).
    applyAdd: (provider: AppAgentProvider, notify: boolean) => Promise<void>;
    // Unload a previously-added provider by identity. `notify` requests a
    // sibling-fan-out system message (5). `dropConfig` clears the
    // agent's persisted enable preference (true for uninstall, false for the
    // remove leg of an update; 5, Model B).
    applyRemove: (
        provider: AppAgentProvider,
        notify: boolean,
        dropConfig: boolean,
    ) => Promise<void>;
};

/**
 * The dispatcher-side {@link AppAgentHost} implementation (3.1, ):
 * an idle-gated FIFO applicator. Each `addProvider` / `removeProvider` is
 * enqueued and applied at the session's next idle (gated through the session's
 * command lock, so it runs between user commands and never interleaves with an
 * in-flight command), in FIFO order (so an update's remove-then-add lands in
 * order). The returned Promise resolves when the op is **applied** — the ack the
 * source's lifecycle tracker waits on (7.2).
 *
 * On {@link dispose}, queued ops (including one waiting on the command lock) are
 * abandoned and their acks resolved (auto-ack: a gone session has removed
 * everything), and any later op is a no-op — so a fan-out that lands after close
 * cannot touch a torn-down session (6).
 */
export class AppAgentHostApplicator implements AppAgentHost {
    private closed = false;
    // FIFO queue of ops not yet started.
    private readonly queue: QueuedOp[] = [];
    // All enqueued-but-not-settled ops (including the one currently waiting on
    // or holding the command lock), so dispose can auto-ack them.
    private readonly pending = new Set<QueuedOp>();
    private pumping = false;

    constructor(
        // The session's single-slot command lock; gating each op on it defers
        // application until the session is idle (7.1).
        private readonly commandLock: Limiter,
        private readonly apply: AppAgentHostApplyFns,
    ) {}

    public addProvider(
        provider: AppAgentProvider,
        notify: boolean = false,
    ): Promise<void> {
        // Assert the single-agent invariant at the add boundary (3.1,
        //  Option A vs B): source-vended providers are single-agent, so a
        // facade regression fails loudly rather than desyncing the source's
        // per-name lifecycle tracker.
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
        newProviderThunk: (() => AppAgentProvider | undefined) | undefined,
        options: ReplaceProviderOptions,
    ): Promise<void> {
        // Assert the single-agent invariant on the old provider at the boundary
        // (3.1); the new provider is asserted below when it is built.
        const oldNames = oldProvider.getAppAgentNames();
        if (oldNames.length !== 1) {
            return Promise.reject(
                new Error(
                    `AppAgentHost.replaceProvider requires a single-agent old provider; got ${oldNames.length} name(s): [${oldNames.join(", ")}]`,
                ),
            );
        }
        const notify = options.notify ?? false;
        // Default to preserving the enable preference (Model B): a bare
        // `replaceProvider` is a swap, not a removal, so unlike `removeProvider`
        // (which defaults dropConfig=true for uninstall) it keeps config by
        // default. The barrier always passes `dropConfig` explicitly regardless.
        const dropConfig = options.dropConfig ?? false;
        // The whole teardown → quiesce → wait → (add) sequence is ONE queued op,
        // so `pump` holds the session's command lock across all of it: no user
        // command interleaves between the remove and the add (5.7,
        // closes the update request-slip of ). Teardown/startup are leaf ops —
        // they never reacquire the command lock or dispatch a command.
        const run = async () => {
            // 1. Teardown leg: unload `old` + drop routing (decrement the shared
            //    refcount), exactly like a remove.
            await this.apply.applyRemove(oldProvider, notify, dropConfig);
            // 2. Signal this host has quiesced — fills its barrier slot.
            options.onQuiesced();
            // 3. Park (still holding the command lock) until the source has every
            //    host's quiesce ACK and has verified the shared old refcount is 0.
            await options.whenReady;
            // The session may have been torn down while parked (dispose leaves a
            // running op to finish, ): skip the startup leg rather than add the
            // new version into a closing session. The source already dropped this
            // host from the barrier on disconnect, so this is a clean no-op.
            if (this.closed) {
                return;
            }
            // 4. Startup leg: call the thunk AFTER the barrier releases and add
            //    whatever it returns. The source decides post-barrier (design
            //    ): the NEW version on a committed update, the OLD version on
            //    a cancelled/timed-out update that ROLLS BACK (v1 restored), or
            //    `undefined` (no add) on a committed uninstall (`old → ∅`).
            if (newProviderThunk !== undefined) {
                const newProvider = newProviderThunk();
                if (newProvider !== undefined) {
                    const newNames = newProvider.getAppAgentNames();
                    if (newNames.length !== 1) {
                        throw new Error(
                            `AppAgentHost.replaceProvider requires a single-agent new provider; got ${newNames.length} name(s): [${newNames.join(", ")}]`,
                        );
                    }
                    await this.apply.applyAdd(newProvider, notify);
                }
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
            // Late op (fan-out that lands after dispose): no-op (6).
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
        this.queue.push(op);
        this.pending.add(op);
        void this.pump();
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

    private async pump(): Promise<void> {
        if (this.pumping) {
            return;
        }
        this.pumping = true;
        try {
            while (this.queue.length > 0) {
                const op = this.queue.shift()!;
                if (op.settled) {
                    continue;
                }
                if (this.closed) {
                    // Auto-ack an op abandoned between enqueue and run.
                    this.settle(op, op.resolve);
                    continue;
                }
                // Idle-gate: acquire the session's command lock so the op runs
                // between user commands.
                try {
                    await this.commandLock(async () => {
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
                    });
                } catch (e) {
                    // The command lock itself failed (not op.run) — settle the
                    // op so its ack never hangs, and keep pumping the rest.
                    this.settle(op, () => op.reject(e));
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    /**
     * Abandon queued ops and auto-ack them (7.1). An op already running
     * `run()` is left to finish; every not-yet-started op (queued, or waiting on
     * the command lock) is auto-acked. Idempotent. After this,
     * {@link addProvider}/{@link removeProvider} are no-ops (6).
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
