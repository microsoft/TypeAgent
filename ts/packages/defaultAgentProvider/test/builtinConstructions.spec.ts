// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Guards the shipped built-in construction cache.
//
// Two independent ways this file has silently rotted, both of which disable
// request completion for the player agent (no song / artist suggestions):
//
//  1. An invalid construction (e.g. a part that is both `optional` and
//     captured) makes the whole file fail to load. `setupBuiltInCache`
//     swallows that into a `console.warn`, so the only symptom is that
//     nothing is ever cached.
//  2. The namespace records the player schema hash at generation time. If the
//     schema changes without regenerating, the file still loads but none of
//     its constructions are reachable, because the dispatcher looks them up
//     under the *current* hash.
//
// Both are fixed by `pnpm cli data regenerate -b v5 --constructions --updateHash`.

import { loadConstructionCacheFile } from "@typeagent/agent-cache";
import {
    getAllActionConfigProvider,
    createSchemaInfoProvider,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "../src/index.js";

const builtinFile =
    getDefaultConstructionProvider().getBuiltinConstructionConfig("v5")?.file;

// Throws (taking every construction in the file with it) when any construction
// violates the ConstructionPart invariants.
async function loadBuiltinCache() {
    expect(builtinFile).toBeDefined();
    const cache = await loadConstructionCacheFile(builtinFile!);
    expect(cache).toBeDefined();
    return cache!;
}

describe("Built-in construction cache", () => {
    it("loads without error", async () => {
        const cache = await loadBuiltinCache();
        expect(cache.count).toBeGreaterThan(0);
    });

    it("is keyed to the current player schema hash", async () => {
        const { provider } = await getAllActionConfigProvider(
            getDefaultAppAgentProviders(getInstanceDir()),
        );
        const schemaInfoProvider = createSchemaInfoProvider(provider);
        const hash = schemaInfoProvider.getActionSchemaFileHash("player");

        const cache = await loadBuiltinCache();
        const namespaces = cache.getConstructionNamespaces();
        expect(namespaces.some((n) => n.includes(hash))).toBe(true);
    });

    it("offers the track name property for completion after 'play '", async () => {
        const cache = await loadBuiltinCache();
        const result = cache.completion("play ", {
            wildcard: true,
            namespaceKeys: cache.getConstructionNamespaces(),
        });
        const names = (result?.properties ?? []).flatMap((p) => p.names);
        expect(names).toContain("parameters.target.trackName");
    });
});
