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
    readonly kind: "add" | "remove";
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
    // session config with the manifest default as fallback (design §5, Model B).
    // `notify` requests a sibling-fan-out system message (design §5).
    applyAdd: (provider: AppAgentProvider, notify: boolean) => Promise<void>;
    // Unload a previously-added provider by identity. `notify` requests a
    // sibling-fan-out system message (design §5). `dropConfig` clears the
    // agent's persisted enable preference (true for uninstall, false for the
    // remove leg of an update; design §5, Model B).
    applyRemove: (
        provider: AppAgentProvider,
        notify: boolean,
        dropConfig: boolean,
    ) => Promise<void>;
};

/**
 * The dispatcher-side {@link AppAgentHost} implementation (design §3.1, §7.1):
 * an idle-gated FIFO applicator. Each `addProvider` / `removeProvider` is
 * enqueued and applied at the session's next idle (gated through the session's
 * command lock, so it runs between user commands and never interleaves with an
 * in-flight command), in FIFO order (so an update's remove-then-add lands in
 * order). The returned Promise resolves when the op is **applied** — the ack the
 * source's lifecycle tracker waits on (design §7.2).
 *
 * On {@link dispose}, queued ops (including one waiting on the command lock) are
 * abandoned and their acks resolved (auto-ack: a gone session has removed
 * everything), and any later op is a no-op — so a fan-out that lands after close
 * cannot touch a torn-down session (design §6).
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
        // application until the session is idle (design §7.1).
        private readonly commandLock: Limiter,
        private readonly apply: AppAgentHostApplyFns,
    ) {}

    public addProvider(
        provider: AppAgentProvider,
        notify: boolean = false,
    ): Promise<void> {
        // Assert the single-agent invariant at the add boundary (design §3.1,
        // §9 Option A vs B): source-vended providers are single-agent, so a
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
        return this.enqueue("add", () => this.apply.applyAdd(provider, notify));
    }

    public removeProvider(
        provider: AppAgentProvider,
        notify: boolean = false,
        dropConfig: boolean = true,
    ): Promise<void> {
        return this.enqueue("remove", () =>
            this.apply.applyRemove(provider, notify, dropConfig),
        );
    }

    /** True once {@link dispose} has been called. */
    public get isClosed(): boolean {
        return this.closed;
    }

    private enqueue(
        kind: "add" | "remove",
        run: () => Promise<void>,
    ): Promise<void> {
        if (this.closed) {
            // Late op (fan-out that lands after dispose): no-op (design §6).
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
     * Abandon queued ops and auto-ack them (design §7.1). An op already running
     * `run()` is left to finish; every not-yet-started op (queued, or waiting on
     * the command lock) is auto-acked. Idempotent. After this,
     * {@link addProvider}/{@link removeProvider} are no-ops (design §6).
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
