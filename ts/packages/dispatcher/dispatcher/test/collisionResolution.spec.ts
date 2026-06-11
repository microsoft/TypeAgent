// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CollisionRegistry } from "../src/context/collisionRegistry.js";
import {
    CollisionPreferenceStore,
    PreferenceMember,
} from "../src/context/collisionPreferences.js";
import { resolvePreferenceClarify } from "../src/context/collisionResolution.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

type PreferenceConfig = {
    enabled: boolean;
    ambiguitySource: "runtime" | "registry" | "both";
    registryPath: string;
    remember: "prompt" | "always" | "never";
};

function makeCtx(
    cfg: Partial<PreferenceConfig> = {},
    overrides: {
        store?: CollisionPreferenceStore;
        registry?: CollisionRegistry;
        oneShot?: Set<string>;
    } = {},
): CommandHandlerContext {
    const preference: PreferenceConfig = {
        enabled: true,
        ambiguitySource: "runtime",
        registryPath: "",
        remember: "prompt",
        ...cfg,
    };
    const registry = overrides.registry ?? CollisionRegistry.empty();
    return {
        session: {
            getConfig: () => ({ collision: { preference } }),
        },
        collisionPreferences:
            overrides.store ?? CollisionPreferenceStore.load(undefined),
        collisionRegistry: registry,
        // Match the configured path so ensureCollisionRegistry doesn't reload.
        collisionRegistryPath: preference.registryPath,
        collisionOneShotPicks: overrides.oneShot ?? new Set<string>(),
    } as unknown as CommandHandlerContext;
}

const player: PreferenceMember = { schemaName: "player", actionName: "play" };
const video: PreferenceMember = { schemaName: "video", actionName: "play" };

describe("collisionResolution.resolvePreferenceClarify", () => {
    it("Tier 0: consumes a one-shot pick and resolves to it", () => {
        const oneShot = new Set<string>(["video.play"]);
        const ctx = makeCtx({}, { oneShot });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("preferred");
        if (dec.kind === "preferred") {
            expect(dec.chosen).toEqual(video);
        }
        // Consumed — a second resolution no longer matches.
        expect(oneShot.size).toBe(0);
        const dec2 = resolvePreferenceClarify([player, video], ctx);
        expect(dec2.kind).toBe("clarify");
    });

    it("Tier 0: ignores a one-shot pick not in the executable set", () => {
        const oneShot = new Set<string>(["other.thing"]);
        const ctx = makeCtx({}, { oneShot });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("clarify");
        // Untouched — still pending for a later request.
        expect(oneShot.has("other.thing")).toBe(true);
    });

    it("Tier 1: a stored preference auto-resolves", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], player, "learned");
        const ctx = makeCtx({}, { store });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("preferred");
        if (dec.kind === "preferred") {
            expect(dec.chosen).toEqual(player);
        }
    });

    it("Tier 1: skipped when the feature is disabled", () => {
        const store = CollisionPreferenceStore.load(undefined);
        store.set([player, video], player, "learned");
        const ctx = makeCtx({ enabled: false }, { store });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("clarify");
    });

    it("Tier 2: clarifies with the executable set under runtime source", () => {
        const ctx = makeCtx({ ambiguitySource: "runtime" });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("clarify");
        if (dec.kind === "clarify") {
            expect(dec.members).toEqual([player, video]);
        }
    });

    it("registry gate: registry-only source with empty registry falls back to first-match", () => {
        const ctx = makeCtx({ ambiguitySource: "registry" });
        const dec = resolvePreferenceClarify([player, video], ctx);
        expect(dec.kind).toBe("first-match");
    });
});
