// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * F4.1 — `replayCorpus()` engine.
 *
 * A deterministic, dependency-injected replay/compare engine. It evaluates each
 * corpus utterance against two agent versions (A and B) via an injected
 * {@link ReplayActionResolver}, builds an {@link ActionDelta} per row, emits
 * `replay.row` / `replay.summary` events, and accumulates a {@link ReplaySummary}.
 *
 * The engine owns only the comparison mechanics — corpus access, building an
 * agent from a git ref, dispatch, and miss-policy resolution are all injected so
 * the engine stays pure, fast, and unit-testable. See
 * `docs/plans/vscode-devx/05-implementation-plan.md` §9.
 */

import type { CollisionDetectedEvent } from "../events/types.js";
import { EVENT_SCHEMA_VERSION } from "../events/types.js";
import type { EventEmitterLike } from "../events/eventStream.js";
import type {
    CorpusEntry,
    CorpusFilter,
    FeedbackLabel,
} from "../corpus/types.js";
import type {
    ActionDelta,
    ReplayCacheState,
    ReplayOptions,
    ReplaySummary,
    VersionSpec,
} from "./types.js";

/** Outcome of evaluating one utterance against one agent version. */
export interface ReplayAgentResolution {
    /** Typed action JSON the version produced, when matched. */
    action?: unknown;
    cacheState: ReplayCacheState;
    collisions?: CollisionDetectedEvent[];
    feedback?: FeedbackLabel;
    /** Resolution latency in ms; defaults to 0 when omitted. */
    latencyMs?: number;
    /** Request id correlating this resolution; defaults to a synthetic id. */
    requestId?: string;
}

export interface ReplayActionResolver {
    resolve(
        entry: CorpusEntry,
        version: VersionSpec,
        side: "A" | "B",
    ): Promise<ReplayAgentResolution> | ReplayAgentResolution;
}

export interface ReplayCorpusProvider {
    list(agent: string, filter: CorpusFilter): Promise<CorpusEntry[]>;
}

export interface ReplayEngineDeps {
    corpus: ReplayCorpusProvider;
    resolver: ReplayActionResolver;
    emitter?: EventEmitterLike;
    /** Clock injection for deterministic timing. Defaults to `Date.now`. */
    now?: () => number;
    /** Run-id factory. Defaults to a counter-free random id. */
    newRunId?: () => string;
    /** Sandbox id stamped on emitted events. Defaults to `"replay"`. */
    sandboxId?: string;
}

export interface ReplayRunHandle {
    runId: string;
    rows: AsyncIterable<ActionDelta>;
    summary: Promise<ReplaySummary>;
    cancel(): Promise<void>;
}

let replayRunCounter = 0;

function defaultRunId(): string {
    replayRunCounter += 1;
    return `replay-${Date.now().toString(36)}-${replayRunCounter}`;
}

/** Structural, key-order-independent deep equality for action JSON. */
export function actionsEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (a === null || b === null) {
        return a === b;
    }
    if (typeof a !== "object" || typeof b !== "object") {
        return false;
    }
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) {
        return false;
    }
    if (aIsArray && bIsArray) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!actionsEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(bObj, key)) {
            return false;
        }
        if (!actionsEqual(aObj[key], bObj[key])) {
            return false;
        }
    }
    return true;
}

/** Minimal single-producer async channel used to stream rows while a summary
 *  is computed eagerly. */
class RowChannel {
    private readonly queue: ActionDelta[] = [];
    private readonly waiters: ((value: IteratorResult<ActionDelta>) => void)[] =
        [];
    private done = false;

    push(row: ActionDelta): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter({ value: row, done: false });
        } else {
            this.queue.push(row);
        }
    }

    close(): void {
        this.done = true;
        let waiter = this.waiters.shift();
        while (waiter) {
            waiter({ value: undefined, done: true });
            waiter = this.waiters.shift();
        }
    }

    iterator(): AsyncIterableIterator<ActionDelta> {
        const self = this;
        return {
            [Symbol.asyncIterator]() {
                return this;
            },
            next(): Promise<IteratorResult<ActionDelta>> {
                const row = self.queue.shift();
                if (row !== undefined) {
                    return Promise.resolve({ value: row, done: false });
                }
                if (self.done) {
                    return Promise.resolve({ value: undefined, done: true });
                }
                return new Promise((resolve) => self.waiters.push(resolve));
            },
        };
    }
}

function buildDelta(
    entry: CorpusEntry,
    a: ReplayAgentResolution,
    b: ReplayAgentResolution,
): ActionDelta {
    const hasA = a.action !== undefined;
    const hasB = b.action !== undefined;
    const equal = actionsEqual(a.action, b.action);
    const delta: ActionDelta = {
        utterance: entry.utterance,
        source: entry.source,
        utteranceId: entry.id,
        equal,
        cacheStateA: a.cacheState,
        cacheStateB: b.cacheState,
        collisionsA: a.collisions ?? [],
        collisionsB: b.collisions ?? [],
        latencyA: a.latencyMs ?? 0,
        latencyB: b.latencyMs ?? 0,
        requestIdA: a.requestId ?? `${entry.id}:A`,
        requestIdB: b.requestId ?? `${entry.id}:B`,
    };
    if (hasA) {
        delta.actionA = a.action;
    }
    if (hasB) {
        delta.actionB = b.action;
    }
    if (a.feedback !== undefined) {
        delta.feedbackA = a.feedback;
    }
    if (b.feedback !== undefined) {
        delta.feedbackB = b.feedback;
    }
    return delta;
}

export function replayCorpus(
    options: ReplayOptions,
    deps: ReplayEngineDeps,
): ReplayRunHandle {
    const now = deps.now ?? (() => Date.now());
    const sandboxId = deps.sandboxId ?? "replay";
    const runId = (deps.newRunId ?? defaultRunId)();
    const channel = new RowChannel();

    let cancelled = false;
    let resolveSummary!: (summary: ReplaySummary) => void;
    const summary = new Promise<ReplaySummary>((resolve) => {
        resolveSummary = resolve;
    });

    const emit = (event: Parameters<EventEmitterLike["emit"]>[0]) => {
        deps.emitter?.emit(event);
    };

    const run = async (): Promise<void> => {
        const startedAt = now();
        const entries = await deps.corpus.list(options.agent, options.corpus);
        const corpusSize = entries.length;

        let rowCount = 0;
        let equalCount = 0;
        let changedCount = 0;
        let newMatchCount = 0;
        let lostMatchCount = 0;
        let collisionDelta = 0;
        let rowIndex = 0;

        for (const entry of entries) {
            if (cancelled) {
                break;
            }
            const a = await deps.resolver.resolve(entry, options.versionA, "A");
            const b = await deps.resolver.resolve(entry, options.versionB, "B");

            // strict-cache: misses become "skipped" and the row is omitted.
            if (a.cacheState === "skipped" || b.cacheState === "skipped") {
                continue;
            }

            const delta = buildDelta(entry, a, b);
            const hasA = delta.actionA !== undefined;
            const hasB = delta.actionB !== undefined;
            if (delta.equal) {
                equalCount += 1;
            } else if (hasA && hasB) {
                changedCount += 1;
            } else if (!hasA && hasB) {
                newMatchCount += 1;
            } else if (hasA && !hasB) {
                lostMatchCount += 1;
            }
            collisionDelta +=
                delta.collisionsB.length - delta.collisionsA.length;
            rowCount += 1;

            emit({
                schemaVersion: EVENT_SCHEMA_VERSION,
                type: "replay.row",
                ts: now(),
                runId,
                sandboxId,
                agent: options.agent,
                rowIndex,
                utteranceId: delta.utteranceId,
                equal: delta.equal,
            });
            rowIndex += 1;

            channel.push(delta);
        }

        const duration = now() - startedAt;
        const result: ReplaySummary = {
            runId,
            agent: options.agent,
            versionA: options.versionA,
            versionB: options.versionB,
            corpusSize,
            rowCount,
            equalCount,
            changedCount,
            newMatchCount,
            lostMatchCount,
            collisionDelta,
            duration,
            missPolicy: options.missPolicy,
        };

        emit({
            schemaVersion: EVENT_SCHEMA_VERSION,
            type: "replay.summary",
            ts: now(),
            runId,
            sandboxId,
            agent: options.agent,
            rowCount,
            equalCount,
            changedCount,
            durationMs: duration,
        });

        channel.close();
        resolveSummary(result);
    };

    const finished = run();

    return {
        runId,
        rows: { [Symbol.asyncIterator]: () => channel.iterator() },
        summary,
        async cancel(): Promise<void> {
            cancelled = true;
            await finished;
        },
    };
}
