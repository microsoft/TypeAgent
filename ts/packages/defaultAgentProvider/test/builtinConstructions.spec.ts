// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Guards every built-in construction cache registered by the production
// explainer factory. This coupling is intentional: a cache is runtime data
// keyed by the current action-schema hashes, so changing a schema without
// regenerating its cache must fail offline tests.
//
// Two independent ways this file has silently rotted, both of which disable
// request completion:
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
// The error for each cache includes its exact offline regeneration command.

import {
    getSchemaNamespaceKey,
    loadConstructionCacheFile,
    splitSchemaNamespaceKey,
} from "@typeagent/agent-cache";
import {
    getAllActionConfigProvider,
    createSchemaInfoProvider,
    getCacheFactory,
} from "agent-dispatcher/internal";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
} from "../src/index.js";

const regenerationCommand = (explainerName: string) =>
    `pnpm cli data regenerate -b ${explainerName} --constructions --updateHash`;

function getBuiltinConfigs() {
    const provider = getDefaultConstructionProvider();
    return getCacheFactory()
        .getExplainerNames()
        .flatMap((explainerName) => {
            const config = provider.getBuiltinConstructionConfig(explainerName);
            return config === undefined ? [] : [{ explainerName, config }];
        });
}

async function loadBuiltinCaches() {
    const configs = getBuiltinConfigs();
    expect(configs.length).toBeGreaterThan(0);
    return Promise.all(
        configs.map(async ({ explainerName, config }) => {
            let cache;
            try {
                cache = await loadConstructionCacheFile(config.file);
            } catch (error) {
                throw new Error(
                    `Unable to load built-in cache for '${explainerName}': ${
                        error instanceof Error ? error.message : String(error)
                    }. Regenerate it offline with: ${regenerationCommand(explainerName)}`,
                );
            }
            if (cache === undefined) {
                throw new Error(
                    `Unable to load built-in cache for '${explainerName}'. Regenerate it offline with: ${regenerationCommand(explainerName)}`,
                );
            }
            return { explainerName, cache };
        }),
    );
}

describe("Built-in construction cache", () => {
    it("loads without error", async () => {
        for (const { explainerName, cache } of await loadBuiltinCaches()) {
            if (cache.count === 0) {
                throw new Error(
                    `Built-in cache '${explainerName}' is empty. Regenerate it offline with: ${regenerationCommand(explainerName)}`,
                );
            }
        }
    });

    it("uses exact current schema namespaces", async () => {
        const { provider } = await getAllActionConfigProvider(
            getDefaultAppAgentProviders(getInstanceDir()),
        );
        const schemaInfoProvider = createSchemaInfoProvider(provider);

        for (const { explainerName, cache } of await loadBuiltinCaches()) {
            for (const namespace of cache.getConstructionNamespaces()) {
                const namespaceKeys = namespace.split("|");
                const expectedKeys = namespaceKeys.map((namespaceKey) => {
                    const { schemaName, hash, activityName } =
                        splitSchemaNamespaceKey(namespaceKey);
                    const currentHash =
                        schemaInfoProvider.getActionSchemaFileHash(schemaName);
                    if (hash !== currentHash) {
                        throw new Error(
                            `Built-in cache '${explainerName}' has a stale schema hash for '${schemaName}'. Regenerate it offline with: ${regenerationCommand(explainerName)}`,
                        );
                    }
                    return getSchemaNamespaceKey(
                        schemaName,
                        activityName,
                        schemaInfoProvider,
                    );
                });
                expect(namespace).toBe(expectedKeys.join("|"));
            }
        }
    });

    it("offers the track name property for completion after 'play '", async () => {
        const { provider } = await getAllActionConfigProvider(
            getDefaultAppAgentProviders(getInstanceDir()),
        );
        const schemaInfoProvider = createSchemaInfoProvider(provider);
        const builtins = await loadBuiltinCaches();
        const cache = builtins.find(
            ({ explainerName }) => explainerName === "v5",
        )?.cache;
        expect(cache).toBeDefined();
        const result = cache!.completion("play ", {
            wildcard: true,
            namespaceKeys: [
                getSchemaNamespaceKey("player", undefined, schemaInfoProvider),
            ],
        });
        const names = (result?.properties ?? []).flatMap((p) => p.names);
        expect(names).toContain("parameters.target.trackName");
    });
});
