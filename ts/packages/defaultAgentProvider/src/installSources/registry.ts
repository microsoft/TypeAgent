// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    InstallSource,
    InstallSourceConfig,
    InstallSourceRegistry,
    InstalledAgentRecord,
    ResolvedCandidate,
} from "agent-dispatcher";
import { createPathSource } from "./pathSource.js";
import { createCatalogSource } from "./catalogSource.js";
import { createFeedSource, FeedSourceDeps } from "./feedSource.js";
import { AsyncMutex } from "./mutex.js";

const debug = registerDebug("typeagent:dispatcher:installSource:registry");

export interface RegistryDeps {
    // Shared npm root all feed sources install into (design §4.1, §12 Q20).
    installDir: string;
    // Feed-source dependency overrides (token runner, fetch, npm install) for
    // testing; installDir is supplied separately.
    feedDeps?: Omit<FeedSourceDeps, "installDir">;
    // Shared async mutex; the installer (M2) reuses it so the record write
    // joins the same serialization domain (design §12 Q5). Defaults to a fresh
    // mutex when omitted.
    mutex?: AsyncMutex;
    // Persist sources + order to instance config (wired in M2.5 / M3). Called
    // after add/remove/setOrder.
    persist?: (configs: InstallSourceConfig[], order: string[]) => void;
}

function buildSource(
    config: InstallSourceConfig,
    deps: RegistryDeps,
): InstallSource {
    switch (config.kind) {
        case "path":
            return createPathSource(config);
        case "catalog":
            return createCatalogSource(config);
        case "feed":
            return createFeedSource(config, {
                installDir: deps.installDir,
                ...deps.feedDeps,
            });
        default: {
            const exhaustive: never = config;
            throw new Error(
                `unknown install source kind: ${JSON.stringify(exhaustive)}`,
            );
        }
    }
}

export function createInstallSourceRegistry(
    initialConfigs: InstallSourceConfig[],
    initialOrder: string[],
    deps: RegistryDeps,
): InstallSourceRegistry {
    const mutex = deps.mutex ?? new AsyncMutex();
    const configs = new Map<string, InstallSourceConfig>();
    const sources = new Map<string, InstallSource>();
    let orderNames: string[] = [...initialOrder];

    for (const config of initialConfigs) {
        if (configs.has(config.name)) {
            throw new Error(`duplicate install source name: '${config.name}'`);
        }
        configs.set(config.name, config);
        sources.set(config.name, buildSource(config, deps));
    }

    function persist(): void {
        deps.persist?.(Array.from(configs.values()), [...orderNames]);
    }

    function orderedSources(): InstallSource[] {
        const result: InstallSource[] = [];
        const seen = new Set<string>();
        for (const name of orderNames) {
            const source = sources.get(name);
            if (source === undefined) {
                // Unknown / removed names are ignored with a warning, not a
                // hard error (design §5, §6).
                debug(
                    `order entry '${name}' has no configured source; ignored`,
                );
                continue;
            }
            if (!seen.has(name)) {
                seen.add(name);
                result.push(source);
            }
        }
        return result;
    }

    async function resolveUnlocked(
        ref: string,
        sourceName?: string,
    ): Promise<InstalledAgentRecord> {
        if (sourceName !== undefined) {
            const source = sources.get(sourceName);
            if (source === undefined) {
                throw new Error(`unknown source '${sourceName}'`);
            }
            const candidate = await source.find(ref);
            if (candidate === undefined) {
                // Explicit --source non-match is a hard error (§4.1, §12 Q4).
                throw new Error(`'${ref}' not found in source '${sourceName}'`);
            }
            return source.materialize(candidate);
        }
        const ordered = orderedSources();
        // Probe the ordered sources in parallel; first match wins (§4.1).
        const candidates = await Promise.all(ordered.map((s) => s.find(ref)));
        const index = candidates.findIndex((c) => c !== undefined);
        if (index < 0) {
            throw new Error(
                `no source could resolve '${ref}'. order: [${ordered
                    .map((s) => s.name)
                    .join(", ")}]`,
            );
        }
        return ordered[index].materialize(candidates[index]!);
    }

    return {
        list(): InstallSourceConfig[] {
            return Array.from(configs.values());
        },
        get(name: string): InstallSource | undefined {
            return sources.get(name);
        },
        order(): InstallSource[] {
            return orderedSources();
        },
        setOrder(names: string[]): void {
            orderNames = [...names];
            persist();
        },
        add(config: InstallSourceConfig): void {
            if (configs.has(config.name)) {
                throw new Error(`source '${config.name}' already exists`);
            }
            configs.set(config.name, config);
            sources.set(config.name, buildSource(config, deps));
            persist();
        },
        remove(name: string): void {
            if (!configs.has(name)) {
                throw new Error(`unknown source '${name}'`);
            }
            configs.delete(name);
            sources.delete(name);
            orderNames = orderNames.filter((n) => n !== name);
            persist();
        },
        async resolve(
            ref: string,
            sourceName?: string,
        ): Promise<InstalledAgentRecord> {
            // The whole install op (resolve -> materialize) runs under the
            // shared mutex (design §12 Q5). The installer (M2) reuses the same
            // mutex for the record write.
            return mutex.runExclusive(() => resolveUnlocked(ref, sourceName));
        },
        async where(ref: string): Promise<ResolvedCandidate | undefined> {
            // Dry-run: report which source would win without materializing.
            const ordered = orderedSources();
            const candidates = await Promise.all(
                ordered.map((s) => s.find(ref)),
            );
            return candidates.find((c) => c !== undefined);
        },
    };
}
