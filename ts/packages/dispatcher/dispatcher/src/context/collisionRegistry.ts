// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Runtime loader for a persisted "known-ambiguous" neighborhood registry.
//
// The registry is the JSON artifact produced by `@collision neighborhoods`
// (the `NeighborhoodPreview` shape from ./../neighborhoods/types.ts). It lists
// clusters of actions that are empirically confusable — both cross-schema
// (e.g. calendar.findTodaysEvents vs taskflow.dailyAgendaEmail) and same-schema
// sibling clusters that runtime cross-schema detection can't see.
//
// Tier 2 of the two-tier collision flow uses this to decide whether an action
// is "known to be ambiguous" even when the runtime detector found a single
// confident match, and to enrich a clarify candidate set with siblings.

import fs from "node:fs";
import registerDebug from "debug";
import type {
    Neighborhood,
    NeighborhoodMember,
    NeighborhoodPreview,
} from "../neighborhoods/types.js";

const debugRegistry = registerDebug("typeagent:dispatcher:collision:registry");

function memberId(m: NeighborhoodMember): string {
    return `${m.schemaName}.${m.actionName}`;
}

/**
 * Indexed view of a neighborhood registry for O(1) membership lookup at
 * resolution time.
 */
export class CollisionRegistry {
    /** `schema.action` -> neighborhoods that contain it. */
    private readonly byMember: Map<string, Neighborhood[]>;

    private constructor(neighborhoods: Neighborhood[]) {
        this.byMember = new Map();
        for (const n of neighborhoods) {
            for (const m of n.members) {
                const id = memberId(m);
                const list = this.byMember.get(id);
                if (list === undefined) {
                    this.byMember.set(id, [n]);
                } else {
                    list.push(n);
                }
            }
        }
    }

    /** An empty registry (no path configured / load failed). */
    public static empty(): CollisionRegistry {
        return new CollisionRegistry([]);
    }

    /**
     * Load a registry from a neighborhoods.json path. Returns an empty
     * registry (never throws) when the path is empty/missing/malformed so
     * the resolver degrades gracefully.
     */
    public static load(registryPath: string | undefined): CollisionRegistry {
        if (!registryPath) {
            return CollisionRegistry.empty();
        }
        try {
            if (!fs.existsSync(registryPath)) {
                debugRegistry(`Registry not found: ${registryPath}`);
                return CollisionRegistry.empty();
            }
            const raw = fs.readFileSync(registryPath, "utf8");
            const parsed = JSON.parse(raw) as NeighborhoodPreview;
            const neighborhoods = Array.isArray(parsed?.neighborhoods)
                ? parsed.neighborhoods
                : [];
            debugRegistry(
                `Loaded ${neighborhoods.length} neighborhoods from ${registryPath}`,
            );
            return new CollisionRegistry(neighborhoods);
        } catch (e) {
            debugRegistry(`Failed to load registry ${registryPath}: ${e}`);
            return CollisionRegistry.empty();
        }
    }

    /** True when the registry has any neighborhoods. */
    public get isEmpty(): boolean {
        return this.byMember.size === 0;
    }

    /** Neighborhoods containing the given `(schema, action)`, if any. */
    public neighborhoodsFor(member: NeighborhoodMember): Neighborhood[] {
        return this.byMember.get(memberId(member)) ?? [];
    }

    /** True if the member appears in any known-ambiguous neighborhood. */
    public isKnownAmbiguous(member: NeighborhoodMember): boolean {
        return this.byMember.has(memberId(member));
    }

    /**
     * Sibling members that share at least one neighborhood with the given
     * member (excluding the member itself), de-duplicated. Used to enrich a
     * clarify candidate set with options the runtime detector didn't surface.
     */
    public siblingsOf(member: NeighborhoodMember): NeighborhoodMember[] {
        const self = memberId(member);
        const out = new Map<string, NeighborhoodMember>();
        for (const n of this.neighborhoodsFor(member)) {
            for (const m of n.members) {
                const id = memberId(m);
                if (id !== self) {
                    out.set(id, {
                        schemaName: m.schemaName,
                        actionName: m.actionName,
                    });
                }
            }
        }
        return [...out.values()];
    }

    /**
     * De-duplicated ids of the neighborhood(s) that contain the given member.
     * Used to stamp the clarify card / telemetry with the registry cluster
     * that flagged the ambiguity, so a card can be traced back to its source.
     */
    public neighborhoodIdsFor(member: NeighborhoodMember): string[] {
        const out = new Set<string>();
        for (const n of this.neighborhoodsFor(member)) {
            out.add(n.id);
        }
        return [...out];
    }
}
