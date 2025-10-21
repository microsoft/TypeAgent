// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { HistoryContext } from "../explanation/requestAction.js";
import { Construction, ConstructionMatchResult } from "./constructions.js";
import { MatchPart, MatchSet, isMatchPart } from "./matchPart.js";
import { Transforms } from "./transforms.js";

import registerDebug from "debug";
import {
    MatchConfig,
    createMatchPartsCache,
    getMatchPartsCacheStats,
} from "./constructionMatch.js";
import {
    ConstructionCacheJSON,
    constructionCacheJSONVersion,
} from "./constructionJSONTypes.js";
const debugConst = registerDebug("typeagent:const");
const debugConstMatchStat = registerDebug("typeagent:const:match:stat");

// Agent Cache define the namespace policy.  At the cache, it just combine the keys into a string for lookup.
function getConstructionNamespace(namespaceKeys: string[]) {
    // Combine the namespace keys into a string using | as the separator.  Use to filter easily when
    // during match for schemas are disabled or not or hash mismatches.
    return namespaceKeys.join("|");
}

function getNamespaceKeys(constructionNamespace: string) {
    // Convert the namespace into an array of translator names for filtering.
    return constructionNamespace.split("|");
}

type AddConstructionResult =
    | {
          added: true;
          existing: Construction[];
          construction: Construction;
      }
    | {
          added: false;
          existing: Construction[];
      };

type Constructions = {
    constructions: Construction[];
    // For assigning runtime id
    maxId: number;
};
export type NamespaceKeyFilter = (namespaceKey: string) => boolean;
export type MatchOptions = {
    // namespace keys to filter.  If undefined, all constructions are used.
    namespaceKeys?: string[] | undefined;
    wildcard?: boolean; // default is true
    entityWildcard?: boolean; // default is true
    rejectReferences?: boolean; // default is true
    conflicts?: boolean; // default is false
    history?: HistoryContext | undefined;

    // Partial (prefix) match, for completions.
    partial?: boolean; // default is false
};

export class ConstructionCache {
    private readonly matchSetsByUid = new Map<string, MatchSet>();

    // Construction and transforms use different namespaces.
    private readonly constructionNamespaces = new Map<string, Constructions>();
    private readonly transformNamespaces = new Map<string, Transforms>();
    public constructor(public readonly explainerName: string) {}

    public get count() {
        let count = 0;
        for (const constructionNamespace of this.constructionNamespaces.values()) {
            count += constructionNamespace.constructions.length;
        }
        return count;
    }

    public getFilteredCount(filter: NamespaceKeyFilter) {
        let count = 0;
        for (const [
            namespace,
            constructionNamespace,
        ] of this.constructionNamespaces.entries()) {
            const keys = getNamespaceKeys(namespace);
            if (keys.every((key) => filter(key))) {
                count += constructionNamespace.constructions.length;
            }
        }
        return count;
    }

    private addMatchSet(matchSet: MatchSet, mergeMatchSet: boolean) {
        const merge = mergeMatchSet && matchSet.canBeMerged;
        const uid = merge ? matchSet.mergedUid : matchSet.unmergedUid;
        let newMatchSet: MatchSet | undefined = this.matchSetsByUid.get(uid);
        if (newMatchSet !== undefined) {
            // If merge, then add to the existing match set.
            // If non-merge, then the uid will have determine the equivalent match set to reuse
            if (newMatchSet !== matchSet && merge) {
                for (const match of matchSet.matches) {
                    // Merge matches
                    newMatchSet.matches.add(match);
                }
                // match set is modified, clear the regexp
                newMatchSet.clearRegexp();
            }
        } else {
            newMatchSet = matchSet.clone(merge, this.matchSetsByUid.size);
            this.matchSetsByUid.set(uid, newMatchSet);
        }
        return newMatchSet;
    }

    private ensureConstructionNamespace(namespace: string) {
        const constructionNamespace =
            this.constructionNamespaces.get(namespace);
        if (constructionNamespace !== undefined) {
            return constructionNamespace;
        }
        const newCacheNamespace = {
            constructions: [],
            transforms: new Transforms(),
            maxId: 0,
        };
        this.constructionNamespaces.set(namespace, newCacheNamespace);
        return newCacheNamespace;
    }

    private mergeTransformNamespaces(
        transformNamespaces: Map<string, Transforms>,
        cacheConflicts?: boolean,
    ) {
        for (const [namespace, transforms] of transformNamespaces) {
            const transformNamespace = this.transformNamespaces.get(namespace);
            if (transformNamespace === undefined) {
                this.transformNamespaces.set(namespace, transforms);
            } else {
                transformNamespace.merge(transforms, cacheConflicts);
            }
        }
    }

    public addConstruction(
        namespaceKeys: string[],
        construction: Construction,
        mergeMatchSets: boolean,
        cacheConflicts?: boolean,
    ): AddConstructionResult {
        const mergedParts = construction.parts.map((p) =>
            isMatchPart(p)
                ? new MatchPart(
                      p.matchSet
                          ? this.addMatchSet(p.matchSet, mergeMatchSets)
                          : undefined,
                      p.optional,
                      p.wildcardMode,
                      p.transformInfos,
                  )
                : p,
        );

        const namespace = getConstructionNamespace(namespaceKeys);
        const constructionNamespace =
            this.ensureConstructionNamespace(namespace);
        this.mergeTransformNamespaces(
            construction.transformNamespaces,
            cacheConflicts,
        );

        // Detect if there are existing rules
        const existingRules = constructionNamespace.constructions.filter((c) =>
            c.isSupersetOf(mergedParts, construction.implicitParameters),
        );
        if (existingRules.length) {
            return { added: false, existing: existingRules };
        }

        // Create a new rule and remove all the existing rule that the new rule is a superset of
        // REVIEW: do we want to share transforms globally?
        const newConstruction = new Construction(
            mergedParts,
            this.transformNamespaces,
            construction.emptyArrayParameters,
            construction.implicitParameters,
            construction.implicitActionName,
            constructionNamespace.maxId++,
        );

        const removedRules: Construction[] = [];
        constructionNamespace.constructions =
            constructionNamespace.constructions.filter((c) => {
                const isSupersetOf = newConstruction.isSupersetOf(
                    c.parts,
                    c.implicitParameters,
                );
                if (isSupersetOf) {
                    removedRules.push(c);
                    return false;
                }
                return true;
            });

        constructionNamespace.constructions.push(newConstruction);
        return {
            added: true,
            existing: removedRules,
            construction: newConstruction,
        };
    }

    public forceRegexp() {
        this.matchSetsByUid.forEach((matchSet) => matchSet.forceRegexp());
    }

    public delete(namespace: string, id: number) {
        const constructionNamespace =
            this.constructionNamespaces.get(namespace);
        if (constructionNamespace === undefined) {
            return -1;
        }

        const count = constructionNamespace.constructions.length;
        constructionNamespace.constructions =
            constructionNamespace.constructions.filter((c) => c.id !== id);

        // TODO: GC match sets
        return count - constructionNamespace.constructions.length;
    }

    private getMatches(
        request: string,
        matchConfig: MatchConfig,
        constructionNamespace: Constructions,
    ): ConstructionMatchResult[] {
        return constructionNamespace.constructions.flatMap((construction) => {
            return construction.match(request, matchConfig);
        });
    }

    public prune(filter: NamespaceKeyFilter) {
        let count = 0;
        for (const namespace of this.constructionNamespaces.keys()) {
            const keys = getNamespaceKeys(namespace);
            if (!keys.every((key) => filter(key))) {
                this.constructionNamespaces.delete(namespace);
                debugConst(`Prune: ${namespace} deleted`);
                count++;
            }
        }
        return count;
    }

    // For completion
    public getPrefix(namespaceKeys?: string[]): string[] {
        if (namespaceKeys?.length === 0) {
            return [];
        }
        const prefix = new Set<string>();
        const filter = namespaceKeys ? new Set(namespaceKeys) : undefined;
        for (const [
            name,
            constructionNamespace,
        ] of this.constructionNamespaces.entries()) {
            const keys = getNamespaceKeys(name);
            if (filter && keys.some((key) => !filter.has(key))) {
                continue;
            }

            for (const construction of constructionNamespace.constructions) {
                for (const part of construction.parts) {
                    if (part.optional) {
                        continue;
                    }
                    if (isMatchPart(part) && part.matchSet) {
                        // For match parts, we can use the match set name as the prefix
                        for (const match of part.matchSet.matches.values()) {
                            prefix.add(match);
                        }
                    }
                    break;
                }
            }
        }
        return [...prefix.values()];
    }

    // For matching
    public match(
        request: string,
        options?: MatchOptions,
    ): ConstructionMatchResult[] {
        const namespaceKeys = options?.namespaceKeys;
        if (namespaceKeys?.length === 0) {
            return [];
        }
        const config = {
            enableWildcard: options?.wildcard ?? true, // default to true.
            enableEntityWildcard: options?.entityWildcard ?? true, // default to true.
            rejectReferences: options?.rejectReferences ?? true, // default to true.
            history: options?.history,
            conflicts: options?.conflicts,
            matchPartsCache: createMatchPartsCache(request),
            partial: options?.partial ?? false, // default to false.
        };

        // If the useTranslators is undefined use all the translators
        // otherwise filter the translators based on the useTranslators
        const matches: ConstructionMatchResult[] = [];
        const filter = namespaceKeys ? new Set(namespaceKeys) : undefined;
        for (const [
            name,
            constructionNamespace,
        ] of this.constructionNamespaces.entries()) {
            const keys = getNamespaceKeys(name);
            if (filter && keys.some((key) => !filter.has(key))) {
                continue;
            }

            matches.push(
                ...this.getMatches(request, config, constructionNamespace),
            );
        }
        debugConstMatchStat(getMatchPartsCacheStats(config.matchPartsCache));
        return matches;
    }

    public get matchSets(): IterableIterator<MatchSet> {
        return this.matchSetsByUid.values();
    }

    public toJSON() {
        return {
            version: constructionCacheJSONVersion,
            explainerName: this.explainerName,
            matchSets: Array.from(this.matchSets),
            constructionNamespaces: Array.from(
                this.constructionNamespaces.entries(),
            ).map(([name, constructionNamespace]) => ({
                name,
                constructions: constructionNamespace.constructions,
            })),
            transformNamespaces: Array.from(
                this.transformNamespaces.entries(),
            ).map(([name, transforms]) => ({
                name,
                transforms,
            })),
        };
    }

    public static fromJSON(originalJSON: ConstructionCacheJSON) {
        const json = ensureVersion(originalJSON);
        const store = new ConstructionCache(json.explainerName);

        // Load the match sets
        const allMatchSets = new Map<string, MatchSet>();
        for (const matchSet of json.matchSets) {
            const newMatchSet = new MatchSet(
                matchSet.matches,
                matchSet.basename,
                matchSet.canBeMerged,
                matchSet.namespace,
                matchSet.index,
            );
            const uid = matchSet.canBeMerged
                ? newMatchSet.mergedUid
                : newMatchSet.unmergedUid;
            store.matchSetsByUid.set(uid, newMatchSet);
            allMatchSets.set(newMatchSet.fullName, newMatchSet);
        }

        // load the constructions and transforms for each translator
        json.constructionNamespaces.forEach(({ name, constructions }) => {
            const newConstructions = constructions.map((construction, index) =>
                Construction.fromJSON(
                    construction,
                    allMatchSets,
                    store.transformNamespaces,
                    index,
                ),
            );
            store.constructionNamespaces.set(name, {
                constructions: newConstructions,
                maxId: newConstructions.length,
            });
            debugConst(newConstructions.join("\n  "));
        });

        json.transformNamespaces.forEach(({ name, transforms }) => {
            store.transformNamespaces.set(
                name,
                Transforms.fromJSON(transforms),
            );
        });
        return store;
    }

    // for viewers
    public getConstructionNamespace(namespace: string) {
        return this.constructionNamespaces.get(namespace);
    }

    public getConstructionNamespaces() {
        return Array.from(this.constructionNamespaces.keys());
    }

    public getTransformNamespaces() {
        return this.transformNamespaces;
    }
}

function ensureVersion(json: any): ConstructionCacheJSON {
    if (json.version === constructionCacheJSONVersion) {
        return json as ConstructionCacheJSON;
    }

    throw new Error(
        `Unsupported version of ConstructionCache: ${json.version}`,
    );
}
