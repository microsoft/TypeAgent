// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    grammarFromJson,
    matchGrammar,
    type Grammar,
    type GrammarJson,
    type GrammarMatchResult,
} from "@typeagent/action-grammar";
import type {
    CompiledSkillGrammarRule,
    FallbackRouteCandidate,
    FallbackRouter,
    GrammarCandidate,
    GrammarRouteOutcome,
    RouteResult,
    RoutingMode,
    RoutingSnapshot,
    SchemaValidator,
    SkillGrammarRule,
    SkillScope,
} from "./types.js";
import { canonicalJson, cloneAndFreeze, qualifySkill, sha256 } from "./util.js";

export interface SkillGrammarRuntime {
    grammarFromJson(json: GrammarJson): Grammar;
    matchGrammar(grammar: Grammar, utterance: string): GrammarMatchResult[];
}

export interface BuildSnapshotOptions {
    id?: string;
    createdAt?: string;
}

const sourcePrecedence = new Map([
    ["contextOverlay", 0],
    ["userCorrection", 1],
    ["generated", 2],
    ["package", 3],
]);

export class SkillGrammarIndex {
    private readonly snapshots = new Map<string, RoutingSnapshot>();
    private readonly snapshotFingerprints = new Map<string, string>();

    public constructor(
        private readonly validate: SchemaValidator,
        private readonly runtime: SkillGrammarRuntime = {
            grammarFromJson,
            matchGrammar,
        },
    ) {}

    public buildSnapshot(
        rules: readonly SkillGrammarRule[],
        options: BuildSnapshotOptions = {},
    ): RoutingSnapshot {
        const ordered = [...rules].sort(compareRules);
        const keys = new Set<string>();
        for (const rule of ordered) {
            const key = `${qualifySkill(rule.skill)}:${rule.skillRevision}:${rule.id}`;
            if (keys.has(key)) {
                throw new Error(`Duplicate grammar rule identity: ${key}`);
            }
            keys.add(key);
            if (
                rule.skillRevision.length === 0 ||
                rule.schemaFingerprint.length === 0
            ) {
                throw new Error(
                    `Grammar rule ${rule.id} must identify its skill revision and schema fingerprint.`,
                );
            }
        }
        const fingerprint = canonicalJson(
            ordered.map((rule) => ({
                id: rule.id,
                skill: qualifySkill(rule.skill),
                skillRevision: rule.skillRevision,
                schemaFingerprint: rule.schemaFingerprint,
                source: rule.source,
                grammar: rule.grammar,
            })),
        );
        const id = options.id ?? sha256(fingerprint);
        const existing = this.snapshots.get(id);
        if (existing !== undefined) {
            if (this.snapshotFingerprints.get(id) !== fingerprint) {
                throw new Error(`Routing snapshot id already exists: ${id}`);
            }
            return existing;
        }
        const compiled: CompiledSkillGrammarRule[] = ordered.map((rule) =>
            Object.freeze({
                id: rule.id,
                skill: cloneAndFreeze(rule.skill),
                skillRevision: rule.skillRevision,
                schemaFingerprint: rule.schemaFingerprint,
                source: rule.source,
                grammar: this.runtime.grammarFromJson(
                    structuredClone(rule.grammar),
                ),
            }),
        );
        const snapshot: RoutingSnapshot = Object.freeze({
            id,
            createdAt: options.createdAt ?? new Date().toISOString(),
            rules: Object.freeze(compiled),
        });
        this.snapshots.set(id, snapshot);
        this.snapshotFingerprints.set(id, fingerprint);
        return snapshot;
    }

    public getSnapshot(id: string): RoutingSnapshot | undefined {
        return this.snapshots.get(id);
    }

    public match(
        snapshotId: string,
        utterance: string,
        scopes?: readonly SkillScope[],
    ): GrammarRouteOutcome {
        if (utterance.trim().length === 0) {
            throw new Error("An utterance is required.");
        }
        const snapshot = this.snapshots.get(snapshotId);
        if (snapshot === undefined) {
            throw new Error(`Unknown routing snapshot: ${snapshotId}`);
        }
        const candidates: GrammarCandidate[] = [];
        for (const rule of snapshot.rules) {
            if (scopes !== undefined && !scopes.includes(rule.skill.scope)) {
                continue;
            }
            for (const match of this.runtime.matchGrammar(
                rule.grammar,
                utterance,
            )) {
                candidates.push({
                    skill: rule.skill,
                    skillRevision: rule.skillRevision,
                    schemaFingerprint: rule.schemaFingerprint,
                    ruleId: rule.id,
                    ruleSource: rule.source,
                    value: match.match,
                    match,
                });
            }
        }
        return this.resolve(candidates);
    }

    public async route(
        snapshotId: string,
        utterance: string,
        mode: RoutingMode,
        fallback?: FallbackRouter,
    ): Promise<RouteResult> {
        if (mode !== "grammarOnly" && fallback === undefined) {
            throw new Error(`${mode} routing requires a fallback router.`);
        }
        const grammar = this.match(snapshotId, utterance);
        if (mode === "grammarOnly") {
            return {
                mode,
                selected: grammar.status === "match" ? "grammar" : "none",
                grammar,
            };
        }
        if (mode === "grammarFirst" && grammar.status === "match") {
            return { mode, selected: "grammar", grammar };
        }
        const fallbackCandidates = sortFallback(
            await fallback!.route(utterance),
        );
        if (mode === "shadow") {
            return {
                mode,
                selected: fallbackCandidates.length > 0 ? "fallback" : "none",
                grammar,
                fallback: fallbackCandidates,
            };
        }
        return {
            mode,
            selected:
                grammar.status === "match"
                    ? "grammar"
                    : fallbackCandidates.length > 0
                      ? "fallback"
                      : "none",
            grammar,
            fallback: fallbackCandidates,
        };
    }

    private resolve(candidates: GrammarCandidate[]): GrammarRouteOutcome {
        if (candidates.length === 0) {
            return { status: "miss" };
        }
        const equivalents = new Map<
            string,
            { candidate: GrammarCandidate; count: number }
        >();
        for (const candidate of candidates.sort(compareCandidates)) {
            const key = canonicalJson({
                skill: qualifySkill(candidate.skill),
                revision: candidate.skillRevision,
                schema: candidate.schemaFingerprint,
                value: candidate.value,
            });
            const prior = equivalents.get(key);
            if (prior === undefined) {
                equivalents.set(key, { candidate, count: 1 });
            } else {
                prior.count++;
            }
        }
        const bestSourceByRevision = new Map<string, number>();
        for (const equivalent of equivalents.values()) {
            const candidate = equivalent.candidate;
            const key = `${qualifySkill(candidate.skill)}:${candidate.skillRevision}`;
            const rank = sourceRank(candidate.ruleSource);
            const previous = bestSourceByRevision.get(key);
            if (previous === undefined || rank < previous) {
                bestSourceByRevision.set(key, rank);
            }
        }
        const valid: {
            candidate: GrammarCandidate;
            count: number;
        }[] = [];
        const invalid: GrammarCandidate[] = [];
        const errors: string[] = [];
        for (const equivalent of equivalents.values()) {
            const candidate = equivalent.candidate;
            const key = `${qualifySkill(candidate.skill)}:${candidate.skillRevision}`;
            if (
                sourceRank(candidate.ruleSource) !==
                bestSourceByRevision.get(key)
            ) {
                continue;
            }
            const validation = this.validate(
                equivalent.candidate.skill,
                equivalent.candidate.schemaFingerprint,
                equivalent.candidate.value,
            );
            if (validation.valid) {
                valid.push(equivalent);
            } else {
                invalid.push(equivalent.candidate);
                errors.push(
                    ...(validation.errors ?? [
                        `Invalid result from grammar rule ${equivalent.candidate.ruleId}`,
                    ]),
                );
            }
        }
        if (valid.length === 1) {
            return {
                status: "match",
                candidate: valid[0].candidate,
                equivalentMatchCount: valid[0].count,
            };
        }
        if (valid.length > 1) {
            return {
                status: "ambiguous",
                candidates: valid.map((value) => value.candidate),
            };
        }
        return { status: "invalid", candidates: invalid, errors };
    }
}

function compareRules(left: SkillGrammarRule, right: SkillGrammarRule): number {
    return (
        sourceRank(left.source) - sourceRank(right.source) ||
        qualifySkill(left.skill).localeCompare(qualifySkill(right.skill)) ||
        left.skillRevision.localeCompare(right.skillRevision) ||
        left.id.localeCompare(right.id)
    );
}

function compareCandidates(
    left: GrammarCandidate,
    right: GrammarCandidate,
): number {
    return (
        sourceRank(left.ruleSource) - sourceRank(right.ruleSource) ||
        qualifySkill(left.skill).localeCompare(qualifySkill(right.skill)) ||
        left.skillRevision.localeCompare(right.skillRevision) ||
        left.ruleId.localeCompare(right.ruleId) ||
        canonicalJson(left.value).localeCompare(canonicalJson(right.value))
    );
}

function sourceRank(source: SkillGrammarRule["source"]): number {
    return sourcePrecedence.get(source) ?? Number.MAX_SAFE_INTEGER;
}

function sortFallback(
    candidates: readonly FallbackRouteCandidate[],
): readonly FallbackRouteCandidate[] {
    return [...candidates].sort(
        (left, right) =>
            right.score - left.score ||
            qualifySkill(left.skill).localeCompare(qualifySkill(right.skill)) ||
            canonicalJson(left.value).localeCompare(canonicalJson(right.value)),
    );
}
