// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The override sidecar (§5): a small, separate `collision-keywords.json` that
// stores per-(schema, action) keyword deltas over the derived lexical defaults.
// Profile-scoped and edited live via `@collision keywords …` (§5.3) — so it
// mirrors the CollisionPreferenceStore (load + edit + save), not the read-only
// registry. Missing/malformed degrades to empty and never throws.

import path from "node:path";
import registerDebug from "debug";
import { tokenize } from "./tokenize.js";
import { readJsonFileSafe, writeJsonFileSafe } from "../../utils/fsUtils.js";

const debugSidecar = registerDebug(
    "typeagent:dispatcher:collision:contextSelector:sidecar",
);

export const COLLISION_KEYWORDS_FILE = "collision-keywords.json";
export const COLLISION_KEYWORDS_SCHEMA_VERSION = 1;

// A delta over the derived defaults for one action (§5.1). `replace` is the
// escape hatch (verbatim), otherwise `add`/`remove` layer on top.
export type KeywordDelta = {
    add?: string[];
    remove?: string[];
    replace?: string[];
};

type KeywordSidecarFile = {
    schemaVersion: number;
    overrides: Record<string, KeywordDelta>;
};

export function keywordId(schemaName: string, actionName: string): string {
    return `${schemaName}.${actionName}`;
}

// Canonicalize user-supplied keywords through the shared tokenizer so the
// sidecar stores the same token forms the extractor and context vector use
// (a multi-word entry like "pivot table" expands to its tokens).
function canonicalizeKeywords(keywords: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of keywords) {
        for (const t of tokenize(raw)) {
            if (!seen.has(t)) {
                seen.add(t);
                out.push(t);
            }
        }
    }
    return out;
}

function canonicalizeDelta(delta: KeywordDelta): KeywordDelta {
    const out: KeywordDelta = {};
    if (delta.replace !== undefined) {
        out.replace = canonicalizeKeywords(delta.replace);
    }
    if (delta.add !== undefined) {
        out.add = canonicalizeKeywords(delta.add);
    }
    if (delta.remove !== undefined) {
        out.remove = canonicalizeKeywords(delta.remove);
    }
    return out;
}

function isEmptyDelta(delta: KeywordDelta): boolean {
    return (
        (delta.replace === undefined || delta.replace.length === 0) &&
        (delta.add === undefined || delta.add.length === 0) &&
        (delta.remove === undefined || delta.remove.length === 0)
    );
}

// Assemble a delta from mutable sets, omitting empty parts entirely (never set
// a property to `undefined` — the package compiles with exactOptionalPropertyTypes).
function buildDelta(
    replace: string[] | undefined,
    add: ReadonlySet<string>,
    remove: ReadonlySet<string>,
): KeywordDelta {
    const out: KeywordDelta = {};
    if (replace !== undefined && replace.length > 0) {
        out.replace = [...replace];
    }
    if (add.size > 0) {
        out.add = [...add];
    }
    if (remove.size > 0) {
        out.remove = [...remove];
    }
    return out;
}

export class KeywordSidecar {
    private readonly byId: Map<string, KeywordDelta>;

    private constructor(
        private readonly filePath: string | undefined,
        overrides: Record<string, KeywordDelta>,
    ) {
        this.byId = new Map(
            Object.entries(overrides).map(([id, d]) => [
                id,
                canonicalizeDelta(d),
            ]),
        );
    }

    public static empty(): KeywordSidecar {
        return new KeywordSidecar(undefined, {});
    }

    // Load from the instance (profile) directory. When `dir` is undefined
    // (non-persistent sessions / tests) the sidecar is in-memory only and
    // `save()` is a no-op.
    public static load(dir: string | undefined): KeywordSidecar {
        if (dir === undefined) {
            return new KeywordSidecar(undefined, {});
        }
        const filePath = path.join(dir, COLLISION_KEYWORDS_FILE);
        const overrides: Record<string, KeywordDelta> = {};
        const parsed = readJsonFileSafe(filePath, (e) =>
            debugSidecar(`Failed to load sidecar from ${filePath}: ${e}`),
        );
        if (parsed && typeof parsed === "object") {
            // Accept both the wrapped form ({ schemaVersion, overrides })
            // and a bare `{ "schema.action": delta }` map (§5.1 example).
            const wrapped = parsed as { overrides?: unknown };
            const map = wrapped.overrides ? wrapped.overrides : parsed;
            if (map && typeof map === "object") {
                for (const [id, d] of Object.entries(
                    map as Record<string, unknown>,
                )) {
                    if (id === "schemaVersion") {
                        continue;
                    }
                    if (d && typeof d === "object") {
                        overrides[id] = d as KeywordDelta;
                    }
                }
            }
        }
        return new KeywordSidecar(filePath, overrides);
    }

    public get isEmpty(): boolean {
        return this.byId.size === 0;
    }

    public deltaFor(
        schemaName: string,
        actionName: string,
    ): KeywordDelta | undefined {
        return this.byId.get(keywordId(schemaName, actionName));
    }

    public list(): { id: string; delta: KeywordDelta }[] {
        return [...this.byId.entries()].map(([id, delta]) => ({ id, delta }));
    }

    // `@collision keywords <id> add <keywords…>` — merge into `add`, and drop
    // the same tokens from `remove` so an add reverses a prior remove.
    public addKeywords(id: string, keywords: string[]): void {
        const canon = canonicalizeKeywords(keywords);
        const delta = this.byId.get(id) ?? {};
        const add = new Set(delta.add ?? []);
        const remove = new Set(delta.remove ?? []);
        for (const k of canon) {
            add.add(k);
            remove.delete(k);
        }
        this.writeEntry(id, buildDelta(delta.replace, add, remove));
    }

    // `@collision keywords <id> remove <keywords…>` — merge into `remove`, and
    // drop the same tokens from `add`.
    public removeKeywords(id: string, keywords: string[]): void {
        const canon = canonicalizeKeywords(keywords);
        const delta = this.byId.get(id) ?? {};
        const add = new Set(delta.add ?? []);
        const remove = new Set(delta.remove ?? []);
        for (const k of canon) {
            remove.add(k);
            add.delete(k);
        }
        this.writeEntry(id, buildDelta(delta.replace, add, remove));
    }

    // Clear a single entry (revert to derived-only). Returns true if removed.
    public clearEntry(id: string): boolean {
        const removed = this.byId.delete(id);
        if (removed) {
            this.save();
        }
        return removed;
    }

    private writeEntry(id: string, delta: KeywordDelta): void {
        const canon = canonicalizeDelta(delta);
        if (isEmptyDelta(canon)) {
            this.byId.delete(id);
        } else {
            this.byId.set(id, canon);
        }
        this.save();
    }

    private save(): void {
        if (this.filePath === undefined) {
            return;
        }
        const data: KeywordSidecarFile = {
            schemaVersion: COLLISION_KEYWORDS_SCHEMA_VERSION,
            overrides: Object.fromEntries(this.byId.entries()),
        };
        writeJsonFileSafe(this.filePath, data, (e) =>
            debugSidecar(`Failed to save sidecar to ${this.filePath}: ${e}`),
        );
    }
}
