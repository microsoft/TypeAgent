// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CompletionDirection,
    CompletionGroup,
    SeparatorMode,
    AfterWildcard,
} from "@typeagent/agent-sdk";
import {
    ExecutableAction,
    HistoryContext,
} from "../explanation/requestAction.js";
import {
    Construction,
    ConstructionMatchResult,
    ConstructionPart,
    WildcardMode,
} from "./constructions.js";
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
import { getLanguageTools } from "../utils/language.js";
const debugConst = registerDebug("typeagent:const");
const debugConstMatchStat = registerDebug("typeagent:const:match:stat");
const debugCompletion = registerDebug("typeagent:const:completion");

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
};

export type CompletionProperty = {
    actions: ExecutableAction[];
    names: string[];
    separatorMode: SeparatorMode;
};

export type CompletionResult = {
    groups: CompletionGroup[];
    properties?: CompletionProperty[] | undefined;
    // Characters consumed by the grammar before the completion point.
    matchedPrefixLength?: number | undefined;
    // True when the completions form a closed set — if the user types
    // something not in the list, no further completions can exist
    // beyond it.  False or undefined means the parser can continue
    // past unrecognized input and find more completions.
    closedSet?: boolean | undefined;
    // True when the result would differ if queried with the opposite
    // direction.  When false, the caller can skip re-fetching on
    // direction change.
    directionSensitive?: boolean | undefined;
    // Describes how the grammar rules that produced completions at
    // this position relate to wildcards.  See AfterWildcard in
    // @typeagent/agent-sdk.
    //   "none" — no wildcard; position is structurally pinned.
    //   "some" — mixed; some rules used wildcards, some didn't.
    //   "all"  — every rule used a wildcard; position can slide.
    afterWildcard?: AfterWildcard | undefined;
};

/** The matched prefix reached end-of-input via a wildcard.
 *  Both "some" and "all" are treated as EOI-wildcard because in both
 *  cases at least one rule's wildcard absorbed to end-of-input, making
 *  the longer matchedPrefixLength ambiguous.  shouldPreferNewResult
 *  uses this to avoid letting an ambiguous longer result displace a
 *  shorter result that is structurally anchored inside the input. */
export function isEoiWildcard(
    matchedLen: number,
    prefixLength: number,
    afterWildcard: AfterWildcard | undefined,
): boolean {
    return (
        matchedLen >= prefixLength &&
        afterWildcard !== undefined &&
        afterWildcard !== "none"
    );
}

/** The matched prefix stops before end-of-input (trailing text filters completions). */
export function anchorsInsideInput(
    matchedLen: number,
    prefixLength: number,
): boolean {
    return matchedLen > 0 && matchedLen < prefixLength;
}

/**
 * When two results have different matchedPrefixLengths, determine
 * whether the candidate should be preferred over the incumbent.
 *
 * The normal rule is "longer wins", with one exception: a longer
 * result at end-of-input with afterWildcard != "none" is displaced
 * by a shorter result that anchors inside the input (the trailing
 * text filters the shorter result's completions, making it more
 * informative).
 *
 * Returns true when the candidate should replace the incumbent.
 */
export function shouldPreferNewResult(
    currentLen: number,
    currentAfterWildcard: AfterWildcard | undefined,
    candidateLen: number,
    candidateAfterWildcard: AfterWildcard | undefined,
    prefixLength: number,
): boolean {
    if (candidateLen > currentLen) {
        // Longer wins unless it's EOI wildcard displacing an anchored result.
        return !(
            isEoiWildcard(candidateLen, prefixLength, candidateAfterWildcard) &&
            anchorsInsideInput(currentLen, prefixLength)
        );
    }
    // candidateLen < currentLen (the equal case was handled by the caller).
    // Shorter candidate wins only when anchored and current is EOI wildcard.
    return (
        anchorsInsideInput(candidateLen, prefixLength) &&
        isEoiWildcard(currentLen, prefixLength, currentAfterWildcard)
    );
}

/** Tri-state merge for afterWildcard:
 *  equal → same; unequal → "some"; both undefined → undefined. */
export function mergeAfterWildcard(
    a: AfterWildcard | undefined,
    b: AfterWildcard | undefined,
): AfterWildcard | undefined {
    if (a === undefined && b === undefined) return undefined;
    if (a === undefined) return b;
    if (b === undefined) return a;
    return a === b ? a : "some";
}

// Architecture: docs/architecture/completion.md — §2 Cache Layer
export function mergeCompletionResults(
    first: CompletionResult | undefined,
    second: CompletionResult | undefined,
    prefixLength: number,
): CompletionResult | undefined {
    if (first === undefined) {
        return second;
    }
    if (second === undefined) {
        return first;
    }
    // Eagerly discard shorter-prefix completions — consistent with the
    // grammar matcher's approach.  Only the source(s) with the longest
    // matchedPrefixLength contribute completions.
    //
    // Exception: when the longer result is at end-of-input with an open
    // wildcard (the wildcard absorbed all remaining text), a shorter
    // result that anchors inside the input is more informative — the
    // trailing text acts as a filter for the shorter result's
    // completions.  In that case, keep the shorter result.
    const firstLen = first.matchedPrefixLength ?? 0;
    const secondLen = second.matchedPrefixLength ?? 0;
    if (firstLen !== secondLen) {
        return shouldPreferNewResult(
            firstLen,
            first.afterWildcard,
            secondLen,
            second.afterWildcard,
            prefixLength,
        )
            ? second
            : first;
    }
    // Same prefix length — merge groups from both sources.
    const matchedPrefixLength =
        first.matchedPrefixLength !== undefined ||
        second.matchedPrefixLength !== undefined
            ? firstLen
            : undefined;
    return {
        groups: [...first.groups, ...second.groups],
        properties: first.properties
            ? second.properties
                ? [...first.properties, ...second.properties]
                : first.properties
            : second.properties,
        matchedPrefixLength,
        // Closed set only when both sources are closed sets.
        closedSet:
            first.closedSet !== undefined || second.closedSet !== undefined
                ? (first.closedSet ?? false) && (second.closedSet ?? false)
                : undefined,
        // Direction-sensitive if either source is.
        directionSensitive:
            first.directionSensitive !== undefined ||
            second.directionSensitive !== undefined
                ? (first.directionSensitive ?? false) ||
                  (second.directionSensitive ?? false)
                : undefined,
        // Tri-state merge for afterWildcard:
        // equal → same; unequal → "some"; both undefined → undefined.
        afterWildcard: mergeAfterWildcard(
            first.afterWildcard,
            second.afterWildcard,
        ),
    };
}

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

    // For matching
    public match(
        request: string,
        options?: MatchOptions,
        partial?: boolean,
        needMatchedStarts?: boolean,
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
            partial: partial ?? false, // default to false.
            needMatchedStarts: needMatchedStarts ?? false,
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

    public completion(
        input: string,
        options?: MatchOptions,
        direction?: CompletionDirection, // defaults to forward-like behavior when omitted
    ): CompletionResult | undefined {
        debugCompletion(`Request completion for input: '${input}'`);
        const namespaceKeys = options?.namespaceKeys;
        debugCompletion(`Request completion namespace keys`, namespaceKeys);

        // Resolve direction to a boolean: true when the user is actively
        // backing up and no trailing separator has committed the last token.
        const backward = direction === "backward" && !/[\s\p{P}]$/u.test(input);
        const results = this.match(input, options, true, backward);

        debugCompletion(
            `Request completion construction match: ${results.length}`,
        );

        if (results.length === 0) {
            return undefined;
        }

        // Track the furthest character position consumed across all
        // matching constructions.  When a longer match is found, all
        // previously accumulated completions from shorter matches are
        // discarded — mirroring the grammar matcher's approach.
        let maxPrefixLength = 0;
        const completionProperty: CompletionProperty[] = [];
        // Per-mode string completion buckets.
        const modeCompletions = new Map<SeparatorMode, string[]>();
        // Whether the accumulated completions form a closed set.
        // Starts true; set to false when property/wildcard completions
        // are added (entity values are external).  Reset to true when
        // maxPrefixLength advances (old candidates discarded).
        let closedSet: boolean = true;
        // Whether at least one candidate at maxPrefixLength had a
        // matched part to reconsider (partialPartCount >= 1).  Reset
        // when maxPrefixLength advances.
        let hasMatchedPart = false;
        const rejectReferences = options?.rejectReferences ?? true;
        const langTools = getLanguageTools("en");

        function addCompletion(text: string, mode: SeparatorMode): void {
            let bucket = modeCompletions.get(mode);
            if (bucket === undefined) {
                bucket = [];
                modeCompletions.set(mode, bucket);
            }
            bucket.push(text);
        }

        function updateMaxPrefixLength(prefixLength: number): void {
            if (prefixLength > maxPrefixLength) {
                maxPrefixLength = prefixLength;
                modeCompletions.clear();
                completionProperty.length = 0;
                closedSet = true;
                hasMatchedPart = false;
            }
        }

        for (const result of results) {
            const { construction, partialPartCount, partialMatchedCurrent } =
                result;
            if (partialPartCount === undefined) {
                throw new Error(
                    "Internal Error: Partial part count is undefined",
                );
            }

            // --- Step 1: Determine which part to complete and the
            //     prefix length up to that point. ---
            let completionPart: ConstructionPart | undefined;
            let candidatePrefixLength: number;

            if (backward) {
                // Walk matchedStarts backwards to find the last part
                // that actually matched (skip optional parts = -1).
                const matchedStarts = result.matchedStarts;
                candidatePrefixLength = -1;
                if (matchedStarts !== undefined && partialPartCount > 0) {
                    for (let i = partialPartCount - 1; i >= 0; i--) {
                        if (matchedStarts[i] >= 0) {
                            completionPart = construction.parts[i];
                            candidatePrefixLength = matchedStarts[i];
                            break;
                        }
                    }
                }
                if (candidatePrefixLength < 0) {
                    continue; // Nothing matched to back up to
                }
            } else {
                // Forward: exact match means nothing to complete.
                if (partialPartCount === construction.parts.length) {
                    updateMaxPrefixLength(input.length);
                    if (partialPartCount >= 1) {
                        hasMatchedPart = true;
                    }
                    continue;
                }
                completionPart = construction.parts[partialPartCount];
                candidatePrefixLength = partialMatchedCurrent ?? 0;
            }

            // --- Step 2: Check against maxPrefixLength ---
            updateMaxPrefixLength(candidatePrefixLength);
            if (candidatePrefixLength !== maxPrefixLength) {
                continue; // Shorter than the best match — skip
            }

            // Track whether at least one candidate had matched parts.
            if (partialPartCount >= 1) {
                hasMatchedPart = true;
            }

            // --- Step 3: Offer literal completions from the part ---
            if (
                completionPart !== undefined &&
                completionPart.wildcardMode <= WildcardMode.Enabled
            ) {
                const partCompletions = completionPart.getCompletion();
                if (partCompletions) {
                    for (const completionText of partCompletions) {
                        if (
                            completionPart.capture &&
                            rejectReferences &&
                            langTools?.possibleReferentialPhrase(completionText)
                        ) {
                            continue;
                        }
                        addCompletion(completionText, "autoSpacePunctuation");
                    }
                }
            }

            // --- Step 4: Offer property completions for entity parts ---
            if (completionPart !== undefined) {
                const partPropertyNames = completionPart.getPropertyNames();
                if (
                    partPropertyNames !== undefined &&
                    partPropertyNames.length > 0
                ) {
                    // Filter out properties that appear in multiple parts
                    // so we only offer single-part properties.
                    const allPropertyNames = new Map<string, number>();
                    for (const part of construction.parts) {
                        const names = part.getPropertyNames();
                        if (names === undefined) {
                            continue;
                        }
                        for (const name of names) {
                            const count = allPropertyNames.get(name) ?? 0;
                            allPropertyNames.set(name, count + 1);
                        }
                    }

                    const queryPropertyNames = partPropertyNames.filter(
                        (name: string) => allPropertyNames.get(name) === 1,
                    );
                    if (queryPropertyNames.length > 0) {
                        completionProperty.push({
                            actions: result.match.actions,
                            names: queryPropertyNames,
                            separatorMode: "autoSpacePunctuation",
                        });
                        closedSet = false;
                    }
                }
            }
        }

        // Advance past trailing separators so that the reported prefix
        // length includes any trailing whitespace the user typed.
        // No longer demotes separatorMode — each group carries its own.
        if (!backward && maxPrefixLength < input.length) {
            const trailing = input.substring(maxPrefixLength);
            if (/^[\s\p{P}]+$/u.test(trailing)) {
                maxPrefixLength = input.length;
            }
        }

        // Compute directionSensitive.
        //
        // Direction-sensitive when: at least one candidate at
        // maxPrefixLength had a matched part to reconsider, AND no
        // trailing separator in the input commits the match.
        const noTrailingSeparator = !/[\s\p{P}]$/u.test(input);
        const directionSensitive = hasMatchedPart && noTrailingSeparator;

        // Build per-mode groups.
        const groups: CompletionGroup[] = [];
        for (const [mode, completions] of modeCompletions) {
            groups.push({
                name: "Construction Completions",
                completions,
                separatorMode: mode,
                needQuotes: false,
                kind: "literal",
            });
        }

        return {
            groups,
            properties: completionProperty,
            matchedPrefixLength: maxPrefixLength,
            closedSet,
            directionSensitive,
        };
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
