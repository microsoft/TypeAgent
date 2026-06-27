// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Profile-scoped store for user collision-resolution preferences.
//
// Tier 1 of the two-tier collision resolution flow: "given these competing
// options (in this context), the user always picks X." When a preference
// matches the current candidate set, the resolver auto-selects the preferred
// option instead of asking the user to clarify (Tier 2).
//
// The store is persisted under the instance (profile) directory so the
// learned preference survives across sessions:
//   <instanceDir>/collisionPreferences.json
//
// See docs/architecture/collision/collision-rollout.md for the design.

import fs from "node:fs";
import path from "node:path";
import registerDebug from "debug";

const debugPref = registerDebug("typeagent:dispatcher:collision:preference");

/** Current on-disk schema version for the preference file. */
export const COLLISION_PREFERENCES_SCHEMA_VERSION = 1;

/** Filename within the instance (profile) directory. */
export const COLLISION_PREFERENCES_FILE = "collisionPreferences.json";

/**
 * One competing option in a collision (a `(schema, action)` pair). Matches
 * the shape used by `CollisionCandidate` / `AgentMatchCandidate` minus the
 * scoring fields, which are not part of a preference identity.
 */
export type PreferenceMember = {
    schemaName: string;
    actionName: string;
};

/**
 * Extensible context under which a preference applies. Empty today — the
 * candidate set alone keys a preference. Reserved for future signals
 * (time-of-day bucket, host device, physical location, active app, …) so
 * that "the user picks X in context A but Y in context B" becomes
 * expressible without a schema migration. Fields added here must be
 * deterministic and low-cardinality so the derived key stays stable.
 */
export type PreferenceContext = {
    /** Reserved: e.g. "morning" | "afternoon" | "evening" | "night". */
    timeOfDay?: string | undefined;
    /** Reserved: stable identifier for the host device. */
    device?: string | undefined;
    /** Reserved: coarse location label. */
    location?: string | undefined;
    /** Reserved: the active app/agent at resolution time. */
    activeApp?: string | undefined;
};

/** A single learned (or explicitly set) preference. */
export type CollisionPreference = {
    /** Canonical key — see `preferenceKey`. Stable equality / lookup id. */
    key: string;
    /** The competing options this preference disambiguates (sorted). */
    candidateSet: PreferenceMember[];
    /** The option the user prefers among `candidateSet`. */
    chosen: PreferenceMember;
    /** Context under which the preference applies (empty = always). */
    context?: PreferenceContext | undefined;
    /** Where the preference came from. */
    origin: "learned" | "explicit";
    createdAt: string;
    updatedAt: string;
    /** Number of times this preference auto-resolved a collision. */
    hitCount: number;
};

type CollisionPreferencesFile = {
    schemaVersion: number;
    preferences: CollisionPreference[];
};

function memberId(m: PreferenceMember): string {
    return `${m.schemaName}.${m.actionName}`;
}

/** Sort + dedupe a candidate set into a canonical order. */
export function canonicalizeCandidateSet(
    members: PreferenceMember[],
): PreferenceMember[] {
    const seen = new Map<string, PreferenceMember>();
    for (const m of members) {
        seen.set(memberId(m), {
            schemaName: m.schemaName,
            actionName: m.actionName,
        });
    }
    return [...seen.values()].sort((a, b) =>
        memberId(a).localeCompare(memberId(b)),
    );
}

/**
 * Serialize the context into a deterministic signature. Only defined fields
 * contribute, in a fixed key order, so today's empty context yields "" and
 * future fields extend the signature without disturbing existing keys.
 */
function contextSignature(context: PreferenceContext | undefined): string {
    if (context === undefined) {
        return "";
    }
    const parts: string[] = [];
    for (const field of [
        "timeOfDay",
        "device",
        "location",
        "activeApp",
    ] as const) {
        const value = context[field];
        if (value !== undefined && value !== "") {
            parts.push(`${field}=${value}`);
        }
    }
    return parts.join("&");
}

/**
 * Derive the canonical preference key from a candidate set + context. The
 * candidate set is the identity of the collision (sorted `schema.action`
 * list); the context signature scopes the preference. Two collisions with
 * the same competing options and the same context share a key.
 */
export function preferenceKey(
    members: PreferenceMember[],
    context?: PreferenceContext,
): string {
    const set = canonicalizeCandidateSet(members).map(memberId).join("|");
    const ctx = contextSignature(context);
    return ctx ? `${set}#${ctx}` : set;
}

/**
 * Profile-scoped preference store. Loaded once at context init; mutations
 * are persisted immediately (small file, infrequent writes).
 */
export class CollisionPreferenceStore {
    private readonly byKey: Map<string, CollisionPreference>;

    private constructor(
        private readonly filePath: string | undefined,
        preferences: CollisionPreference[],
    ) {
        this.byKey = new Map(preferences.map((p) => [p.key, p]));
    }

    /**
     * Load the store from the instance (profile) directory. When `dir` is
     * undefined (non-persistent sessions / tests) the store is in-memory only
     * and `save()` is a no-op.
     */
    public static load(dir: string | undefined): CollisionPreferenceStore {
        if (dir === undefined) {
            return new CollisionPreferenceStore(undefined, []);
        }
        const filePath = path.join(dir, COLLISION_PREFERENCES_FILE);
        let preferences: CollisionPreference[] = [];
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, "utf8");
                const parsed = JSON.parse(raw) as CollisionPreferencesFile;
                if (Array.isArray(parsed?.preferences)) {
                    preferences = parsed.preferences;
                }
            }
        } catch (e) {
            debugPref(`Failed to load preferences from ${filePath}: ${e}`);
        }
        return new CollisionPreferenceStore(filePath, preferences);
    }

    /** All stored preferences (snapshot). */
    public list(): CollisionPreference[] {
        return [...this.byKey.values()];
    }

    /**
     * Look up a preference for a candidate set + context. Returns the matching
     * preference only when its `chosen` option is actually present in the
     * supplied candidate set (guards against a stale preference whose target
     * is no longer a competitor).
     */
    public find(
        members: PreferenceMember[],
        context?: PreferenceContext,
    ): CollisionPreference | undefined {
        const key = preferenceKey(members, context);
        const pref = this.byKey.get(key);
        if (pref === undefined) {
            return undefined;
        }
        const present = members.some(
            (m) =>
                m.schemaName === pref.chosen.schemaName &&
                m.actionName === pref.chosen.actionName,
        );
        return present ? pref : undefined;
    }

    /** Record a hit (increments count + timestamp) and persist. */
    public recordHit(key: string): void {
        const pref = this.byKey.get(key);
        if (pref === undefined) {
            return;
        }
        pref.hitCount += 1;
        pref.updatedAt = new Date().toISOString();
        this.save();
    }

    /**
     * Create or update a preference. Returns the stored preference. Existing
     * preferences with the same key are overwritten (last write wins) while
     * preserving `createdAt` and `hitCount`.
     */
    public set(
        members: PreferenceMember[],
        chosen: PreferenceMember,
        origin: "learned" | "explicit",
        context?: PreferenceContext,
    ): CollisionPreference {
        const candidateSet = canonicalizeCandidateSet(members);
        const key = preferenceKey(candidateSet, context);
        const now = new Date().toISOString();
        const existing = this.byKey.get(key);
        const pref: CollisionPreference = {
            key,
            candidateSet,
            chosen: {
                schemaName: chosen.schemaName,
                actionName: chosen.actionName,
            },
            context,
            origin,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            hitCount: existing?.hitCount ?? 0,
        };
        this.byKey.set(key, pref);
        this.save();
        return pref;
    }

    /** Remove a preference by key. Returns true if one was removed. */
    public remove(key: string): boolean {
        const removed = this.byKey.delete(key);
        if (removed) {
            this.save();
        }
        return removed;
    }

    /** Remove every stored preference. */
    public clear(): void {
        this.byKey.clear();
        this.save();
    }

    private save(): void {
        if (this.filePath === undefined) {
            return;
        }
        const data: CollisionPreferencesFile = {
            schemaVersion: COLLISION_PREFERENCES_SCHEMA_VERSION,
            preferences: [...this.byKey.values()],
        };
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.writeFileSync(
                this.filePath,
                JSON.stringify(data, null, 2),
                "utf8",
            );
        } catch (e) {
            debugPref(`Failed to save preferences to ${this.filePath}: ${e}`);
        }
    }
}
