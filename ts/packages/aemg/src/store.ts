// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Belief,
    Claim,
    ConflictNote,
    Episode,
    Id,
    Observation,
    Provenance,
    RecallItem,
    RecallResult,
} from "./types.js";
import { ObservationLog } from "./observationLog.js";
import { TrustTier, trustAtLeast } from "./trust.js";
import { KnowledgeGraph, NodeId } from "./graph.js";
import { spreadingActivation } from "./activation.js";
import { SignalStore, DEFAULT_HALF_LIFE_MS } from "./signal.js";

/** Relative weight of the graph (associative) signal when fused with lexical. */
const GRAPH_WEIGHT = 4;
/** Minimum accumulated activation for an episode to surface via the graph. */
const MIN_EPISODE_ACTIVATION = 0.02;
/** Reinforcement added to an episode's salience each time it is recalled. */
const RECALL_REINFORCEMENT = 0.5;

let counter = 0;
function nextId(prefix: string): Id {
    counter += 1;
    return `${prefix}_${counter}`;
}

/** A single conversation turn handed to the store for ingestion. */
export interface Turn {
    speaker: string;
    text: string;
}

/** A user/tool correction asserting the true value of a belief. */
export interface Correction {
    subject: string;
    predicate: string;
    value: string;
    trustTier?: TrustTier; // defaults to UserAsserted
    reason?: string;
    provenance: Provenance;
    confidence?: number;
}

export interface IngestInput {
    conversationId: string;
    topic: string;
    actionIntent?: string;
    turns: Turn[];
    /**
     * Optional structured beliefs the caller already extracted from the turns
     * (subject/predicate/value). In a full build these come from a feeder.
     */
    beliefs?: {
        subject: string;
        predicate: string;
        value: string;
        speaker: string;
        turnIndex: number;
        trustTier?: TrustTier;
        confidence?: number;
    }[];
}

export interface MemoryStoreOptions {
    /** Injectable clock for deterministic decay testing. Defaults to Date.now. */
    now?: () => number;
    /** Half-life for episode salience decay, in ms. */
    signalHalfLifeMs?: number;
}

/**
 * In-memory AEMG store implementing the vertical slice:
 * ingest a conversation -> store an Episode -> apply a correction ->
 * answer a recall query with provenance.
 */
export class MemoryStore {
    private readonly log = new ObservationLog();
    private readonly episodes: Episode[] = [];
    private readonly beliefs: Belief[] = [];
    private readonly graph = new KnowledgeGraph();
    private readonly episodesById = new Map<Id, Episode>();
    private readonly signals: SignalStore;
    private readonly clock: () => number;

    constructor(options?: MemoryStoreOptions) {
        this.clock = options?.now ?? (() => Date.now());
        this.signals = new SignalStore(
            options?.signalHalfLifeMs ?? DEFAULT_HALF_LIFE_MS,
        );
    }

    /** Capture a conversation segment as an Episode plus any beliefs. */
    ingest(input: IngestInput): Episode {
        const now = this.clock();
        const participants = Array.from(
            new Set(input.turns.map((t) => t.speaker)),
        );

        const claims: Claim[] = [];
        const observationIds: Id[] = [];

        input.turns.forEach((turn, turnIndex) => {
            const provenance: Provenance = {
                sourceId: input.conversationId,
                turnIndex,
                speaker: turn.speaker,
                quote: turn.text,
            };
            const obs = this.record(
                "conversation",
                turn,
                0.6,
                TrustTier.ExtractorInferred,
                provenance,
                now,
            );
            observationIds.push(obs.id);
            claims.push({
                speaker: turn.speaker,
                text: turn.text,
                provenance,
            });
        });

        const episode: Episode = {
            id: nextId("ep"),
            topic: input.topic,
            participants,
            timestamp: now,
            ...(input.actionIntent !== undefined
                ? { actionIntent: input.actionIntent }
                : {}),
            claims,
            decisions: [],
            observationIds,
        };
        this.episodes.push(episode);
        this.episodesById.set(episode.id, episode);

        // Seed this episode's salience signal; it will decay over time unless
        // reinforced by recall or pinned.
        this.signals.ensure(episode.id, 0.5 + 0.1 * claims.length, now);

        // Graph: episode node + topic/intent entities, so episodes are
        // reachable through the concepts they are about.
        const epNode = this.graph.addEpisode(episode.id, episode.topic);
        const topicNode = this.graph.addEntity(input.topic);
        this.graph.addEdge(epNode.id, topicNode.id, "about", 2);
        if (input.actionIntent !== undefined) {
            const intentNode = this.graph.addEntity(input.actionIntent);
            this.graph.addEdge(epNode.id, intentNode.id, "intent", 1);
        }

        for (const b of input.beliefs ?? []) {
            const provenance: Provenance = {
                sourceId: input.conversationId,
                turnIndex: b.turnIndex,
                speaker: b.speaker,
                quote: input.turns[b.turnIndex]?.text,
            };
            this.assertBelief({
                subject: b.subject,
                predicate: b.predicate,
                value: b.value,
                trustTier: b.trustTier ?? TrustTier.ExtractorInferred,
                confidence: b.confidence ?? 0.6,
                provenance,
            });
            // Link this episode to the entities its beliefs mention, so the
            // episode is recallable by association with those entities.
            const subjNode = this.graph.addEntity(b.subject);
            this.graph.addEdge(epNode.id, subjNode.id, "mentions", 1);
        }

        return episode;
    }

    /**
     * Apply a correction. The prior belief is never deleted: a new version is
     * created and the old one is linked via supersededById, gated by trust.
     */
    correct(correction: Correction): Belief {
        return this.assertBelief({
            subject: correction.subject,
            predicate: correction.predicate,
            value: correction.value,
            trustTier: correction.trustTier ?? TrustTier.UserAsserted,
            confidence: correction.confidence ?? 0.95,
            reason: correction.reason ?? "user correction",
            provenance: correction.provenance,
        });
    }

    /** Current (non-superseded) belief for a subject/predicate, if any. */
    currentBelief(subject: string, predicate: string): Belief | undefined {
        return this.beliefs.find(
            (b) =>
                b.subject === subject &&
                b.predicate === predicate &&
                b.supersededById === undefined,
        );
    }

    /** Full version history for a subject/predicate, oldest first. */
    beliefHistory(subject: string, predicate: string): Belief[] {
        return this.beliefs
            .filter((b) => b.subject === subject && b.predicate === predicate)
            .sort((a, b) => a.version - b.version);
    }

    /**
     * Associative recall over episodes + beliefs. Scores by cue overlap
     * (topic, participants, intent, claim text) and always returns provenance.
     */
    recall(query: string, options?: { hybrid?: boolean }): RecallResult {
        const hybrid = options?.hybrid ?? true;
        const cues = tokenize(query);
        const itemsById = new Map<Id, RecallItem>();

        for (const ep of this.episodes) {
            const score = episodeScore(ep, cues);
            if (score > 0) {
                itemsById.set(ep.id, {
                    kind: "episode",
                    id: ep.id,
                    score,
                    confidence: clamp(0.5 + score * 0.1, 0, 1),
                    provenance: ep.claims.map((c) => c.provenance),
                    summary: summarizeEpisode(ep),
                });
            }
        }

        for (const b of this.beliefs) {
            if (b.supersededById !== undefined) {
                continue;
            }
            const score = beliefScore(b, cues);
            if (score > 0) {
                itemsById.set(b.id, {
                    kind: "belief",
                    id: b.id,
                    score,
                    confidence: b.confidence,
                    provenance: [this.provenanceOf(b.observationId)],
                    summary: `${b.subject} ${b.predicate} = ${b.value}`,
                });
            }
        }

        // Hybrid: fold in the associative (graph) signal. This is what surfaces
        // episodes connected to the query through entities/relations even when
        // they share no words with it — the capability chunk-RAG lacks.
        if (hybrid) {
            const activation = this.activate(cues);
            for (const node of this.graph.nodes()) {
                if (node.kind !== "episode" || node.ref === undefined) {
                    continue;
                }
                const energy = activation.get(node.id) ?? 0;
                if (energy < MIN_EPISODE_ACTIVATION) {
                    continue;
                }
                const ep = this.episodesById.get(node.ref);
                if (!ep) {
                    continue;
                }
                const boost = energy * GRAPH_WEIGHT;
                const existing = itemsById.get(ep.id);
                if (existing) {
                    existing.score += boost;
                } else {
                    itemsById.set(ep.id, {
                        kind: "episode",
                        id: ep.id,
                        score: boost,
                        confidence: clamp(0.4 + energy, 0, 1),
                        provenance: ep.claims.map((c) => c.provenance),
                        summary: summarizeEpisode(ep),
                    });
                }
            }
        }

        const items = Array.from(itemsById.values());

        // Salience weighting: fresh/reinforced/pinned episodes rank higher,
        // stale ones fade. Then reinforce what we surfaced (access strengthens).
        const now = this.clock();
        for (const item of items) {
            if (item.kind === "episode") {
                const strength = this.signals.strength(item.id, now);
                item.score *= 1 + strength;
            }
        }
        items.sort((a, b) => b.score - a.score);
        for (const item of items) {
            if (item.kind === "episode") {
                this.signals.reinforce(item.id, RECALL_REINFORCEMENT, now);
            }
        }
        return { query, items, conflicts: this.detectConflicts(cues) };
    }

    /** Pin an episode so its salience never decays. */
    pinEpisode(id: Id): void {
        this.signals.pin(id, this.clock());
    }

    /** Remove a pin, allowing the episode's salience to decay again. */
    unpinEpisode(id: Id): void {
        this.signals.unpin(id, this.clock());
    }

    /** Current decayed salience of an episode (0..). */
    episodeStrength(id: Id, now: number = this.clock()): number {
        return this.signals.strength(id, now);
    }

    /** Recall driven purely by graph association (no lexical scoring). */
    recallAssociative(query: string): RecallResult {
        const cues = tokenize(query);
        const activation = this.activate(cues);
        const items: RecallItem[] = [];
        for (const node of this.graph.nodes()) {
            if (node.kind !== "episode" || node.ref === undefined) {
                continue;
            }
            const energy = activation.get(node.id) ?? 0;
            if (energy < MIN_EPISODE_ACTIVATION) {
                continue;
            }
            const ep = this.episodesById.get(node.ref);
            if (!ep) {
                continue;
            }
            items.push({
                kind: "episode",
                id: ep.id,
                score: energy * GRAPH_WEIGHT,
                confidence: clamp(0.4 + energy, 0, 1),
                provenance: ep.claims.map((c) => c.provenance),
                summary: summarizeEpisode(ep),
            });
        }
        items.sort((a, b) => b.score - a.score);
        return { query, items, conflicts: [] };
    }

    /** Seed activation on entity nodes whose label overlaps the query cues. */
    private activate(cues: Set<string>): Map<NodeId, number> {
        const seeds = new Map<NodeId, number>();
        for (const node of this.graph.nodes()) {
            if (node.kind !== "entity") {
                continue;
            }
            const o = overlap(node.label, cues);
            if (o > 0) {
                seeds.set(node.id, o);
            }
        }
        return spreadingActivation(this.graph, seeds);
    }

    get graphNodeCount(): number {
        return this.graph.nodeCount;
    }

    get observationCount(): number {
        return this.log.size;
    }

    // --- internals -------------------------------------------------------

    private assertBelief(args: {
        subject: string;
        predicate: string;
        value: string;
        trustTier: TrustTier;
        confidence: number;
        reason?: string;
        provenance: Provenance;
    }): Belief {
        const now = this.clock();
        const obs = this.record(
            "belief",
            args,
            args.confidence,
            args.trustTier,
            args.provenance,
            now,
        );

        const existing = this.currentBelief(args.subject, args.predicate);
        const version = existing ? existing.version + 1 : 1;

        const belief: Belief = {
            id: nextId("bel"),
            subject: args.subject,
            predicate: args.predicate,
            value: args.value,
            version,
            trustTier: args.trustTier,
            confidence: args.confidence,
            ...(args.reason !== undefined ? { reason: args.reason } : {}),
            observationId: obs.id,
            timestamp: now,
        };

        // Supersede the prior current belief only if the new one is at least
        // as trusted; otherwise keep both live as a surfaced conflict.
        if (existing && trustAtLeast(args.trustTier, existing.trustTier)) {
            existing.supersededById = belief.id;
        }

        this.beliefs.push(belief);

        // Graph: typed relation subject --predicate--> value, reinforced by
        // confidence. Repeated assertions strengthen the association.
        const subjNode = this.graph.addEntity(args.subject);
        const valNode = this.graph.addEntity(args.value);
        this.graph.addEdge(
            subjNode.id,
            valNode.id,
            args.predicate,
            1 + args.confidence,
        );

        return belief;
    }

    private record(
        feeder: string,
        payload: unknown,
        confidence: number,
        trustTier: TrustTier,
        provenance: Provenance,
        timestamp: number,
    ): Observation {
        return this.log.append({
            id: nextId("obs"),
            feeder,
            payload,
            confidence,
            trustTier,
            provenance,
            timestamp,
        });
    }

    private provenanceOf(observationId: Id): Provenance {
        const obs = this.log.get(observationId);
        return (
            obs?.provenance ?? {
                sourceId: "unknown",
            }
        );
    }

    private detectConflicts(cues: Set<string>): ConflictNote[] {
        const conflicts: ConflictNote[] = [];
        const byKey = new Map<string, Belief[]>();
        for (const b of this.beliefs) {
            if (b.supersededById !== undefined) {
                continue;
            }
            const key = `${b.subject}\u0000${b.predicate}`;
            const list = byKey.get(key) ?? [];
            list.push(b);
            byKey.set(key, list);
        }
        for (const [key, list] of byKey) {
            if (list.length < 2) {
                continue;
            }
            const [subject, predicate] = key.split("\u0000");
            if (beliefScore(list[0], cues) === 0) {
                continue;
            }
            conflicts.push({
                subject,
                predicate,
                candidates: list.map((b) => ({
                    value: b.value,
                    confidence: b.confidence,
                    beliefId: b.id,
                })),
            });
        }
        return conflicts;
    }
}

function tokenize(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length > 2),
    );
}

function overlap(text: string, cues: Set<string>): number {
    const tokens = tokenize(text);
    let hits = 0;
    for (const t of tokens) {
        if (cues.has(t)) {
            hits += 1;
        }
    }
    return hits;
}

function episodeScore(ep: Episode, cues: Set<string>): number {
    let score = 0;
    score += overlap(ep.topic, cues) * 3;
    score += overlap(ep.participants.join(" "), cues) * 1;
    score += overlap(ep.actionIntent ?? "", cues) * 2;
    for (const c of ep.claims) {
        score += overlap(c.text, cues);
    }
    return score;
}

function beliefScore(b: Belief, cues: Set<string>): number {
    return (
        overlap(b.subject, cues) * 2 +
        overlap(b.predicate, cues) +
        overlap(b.value, cues)
    );
}

function summarizeEpisode(ep: Episode): string {
    const who = ep.participants.join(", ");
    return `[${ep.topic}] with ${who}: ${ep.claims.length} claims`;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
