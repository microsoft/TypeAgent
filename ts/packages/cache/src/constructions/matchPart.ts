// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { escapeMatch } from "../utils/regexp.js";
import { ConstructionPart, WildcardMode } from "./constructions.js";

export type MatchSetJSON = {
    matches: string[];
    basename: string;
    namespace?: string | undefined;
    canBeMerged: boolean;
    index: number;
};

export type TransformInfo = {
    namespace: string;
    transformName: string;
    actionIndex?: number | undefined;
};

export function toTransformInfoKey(transformInfo: TransformInfo) {
    return `${transformInfo.namespace}::${transformInfo.actionIndex ? `${transformInfo.actionIndex}.}` : ""}${transformInfo.transformName}`;
}

function toTransformInfosKey(transformInfos: TransformInfo[] | undefined) {
    return transformInfos?.map(toTransformInfoKey).sort().join(",");
}

function getMatchSetNamespace(transformInfos: TransformInfo[] | undefined) {
    // Since the matchset needs to grow along with the available transform, we need to use the same
    // namespace schema, which is the transform namespace determined when the construction is created.
    // Currently the transform namespace is <schemaName> or <schemaName>.<actionName> depending on the SchemaConfig
    // See `getNamespaceForCache` in schemaConfig.ts

    // Flattening the pair using :: as the separator, and sort them so that it is stable for equality comparison
    return transformInfos
        ?.map((t) => `${t.namespace}::${t.transformName}`)
        .sort() // sort it so that it is stable
        .join(",");
}

/**
 * MatchSet
 *
 * Merge policy:
 * - If canBeMerged is false, it will never be substituted with other matchset unless it is an exact match.
 * - If canBeMerged is true, it will be merged with other match set with the same name AND transformInfo if any
 *
 * See mergedUid and unmergedUid for the look up key for them
 *
 * Additionally, merge can be enabled/disabled via a flag when construction is added to the cache.
 */
export class MatchSet {
    public readonly matches: Set<string>;
    private _regExp: RegExp | undefined;
    constructor(
        matches: Iterable<string>,
        public readonly name: string, // note: characters "_", ",", "|", ":" are reserved for internal use
        public readonly canBeMerged: boolean,
        public readonly namespace: string | undefined,
        private readonly index: number = -1, // Assign an index as id for serialization and reference in construction
    ) {
        // Case insensitive match
        // TODO: non-diacritic match
        this.matches = new Set(Array.from(matches).map((m) => m.toLowerCase()));
    }

    public get fullName() {
        return `${this.name}${this.index !== -1 ? `_${this.index}` : ""}`;
    }

    public get mergedUid() {
        return `${this.name}${this.namespace ? `,${this.namespace}` : ""}`;
    }
    public get unmergedUid() {
        // Use the static set of match set strings to ensure only exact match will be reused
        return `${this.mergedUid},${this.matchSetString}`;
    }

    private get matchSetString() {
        return Array.from(this.matches).sort().join("|");
    }

    public get regexPart() {
        return Array.from(this.matches)
            .sort((a, b) => b.length - a.length) // Match longest first
            .map((m) => escapeMatch(m))
            .join("|");
    }

    public get regExp() {
        if (this._regExp === undefined) {
            this._regExp = new RegExp(`(?:${this.regexPart})`, "iuy");
        }
        return this._regExp;
    }

    public forceRegexp() {
        const regExp = this.regExp;
        regExp.exec("");
        regExp.exec("");
        regExp.exec("");
        regExp.exec("");
        regExp.exec("");
    }
    public clearRegexp() {
        this._regExp = undefined;
    }

    public clone(canBeMerged: boolean, index: number) {
        return new MatchSet(
            this.matches,
            this.name,
            canBeMerged,
            this.namespace,
            index,
        );
    }

    public toJSON(): MatchSetJSON {
        return {
            matches: Array.from(this.matches),
            basename: this.name,
            namespace: this.namespace,
            canBeMerged: this.canBeMerged,
            index: this.index,
        };
    }
}

export type MatchPartJSON = {
    matchSet: string;
    optional: true | undefined;
    wildcardMode: WildcardMode | undefined;
    transformInfos?: TransformInfo[] | undefined;
};

export class MatchPart {
    constructor(
        public readonly matchSet: MatchSet,
        public readonly optional: boolean,
        public readonly wildcardMode: WildcardMode,
        public readonly transformInfos: Readonly<TransformInfo>[] | undefined,
    ) {}

    public get capture() {
        return this.transformInfos !== undefined;
    }

    public get regExp() {
        return this.matchSet.regExp;
    }

    public toString(verbose: boolean = false) {
        return (
            `<${verbose ? this.matchSet.fullName : this.matchSet.name}>` +
            (this.optional ? "?" : "")
        );
    }

    public toJSON(): MatchPartJSON {
        return {
            matchSet: this.matchSet.fullName,
            optional: this.optional ? true : undefined,
            wildcardMode:
                this.wildcardMode !== WildcardMode.Disabled
                    ? this.wildcardMode
                    : undefined,
            transformInfos: this.transformInfos,
        };
    }

    public equals(e: ConstructionPart): boolean {
        return (
            isMatchPart(e) &&
            e.matchSet === this.matchSet &&
            e.optional === this.optional &&
            e.wildcardMode === this.wildcardMode &&
            toTransformInfosKey(e.transformInfos) ===
                toTransformInfosKey(this.transformInfos)
        );
    }
}

export function createMatchPart(
    matches: string[],
    name: string,
    options?: {
        transformInfos?: TransformInfo[];
        optional?: boolean; // default false
        canBeMerged?: boolean; // default true
        wildcardMode?: WildcardMode; // default false
    },
): ConstructionPart {
    const canBeMerged = options?.canBeMerged ?? true;
    const optional = options?.optional ?? false;
    const wildcardMode = options?.wildcardMode ?? WildcardMode.Disabled;
    const transformInfos = options?.transformInfos;

    // Error checking
    if (wildcardMode && transformInfos === undefined) {
        throw new Error("Wildcard part must be captured");
    }
    if (optional && transformInfos !== undefined) {
        throw new Error("Optional part cannot be captured");
    }
    if (matches.some((m) => m === "")) {
        throw new Error("Empty match is not allowed");
    }

    // Add all the transform namespace and transformName to the match namespace
    // so that matches will have corresponding entry in the transforms
    const matchSetNamespace = getMatchSetNamespace(transformInfos);

    const matchSet = new MatchSet(
        matches,
        name,
        canBeMerged,
        matchSetNamespace,
    );

    return new MatchPart(matchSet, optional, wildcardMode, transformInfos);
}

export function isMatchPart(part: ConstructionPart): part is MatchPart {
    return part.hasOwnProperty("matchSet");
}

// Legacy version
type TransformInfoV2 = {
    // TODO: Rename to namespace
    translatorName: string;
    transformNames: ReadonlyArray<string>;
};

export type MatchSetJSONV2 = {
    matches: string[];
    basename: string;
    transformInfo?: TransformInfoV2 | undefined;
    canBeMerged: boolean;
    index: number;
};

export function convertMatchSetV2ToV3(matchSetsV2: MatchSetJSONV2[]): {
    matchSets: MatchSetJSON[];
    matchSetToTransformInfo: Map<string, TransformInfo[]>;
} {
    const matchSets: MatchSetJSON[] = [];
    const matchSetToTransformInfo = new Map<string, TransformInfo[]>();
    for (const matchSet of matchSetsV2) {
        let namespace: string | undefined;
        const oldTransformInfo = matchSet.transformInfo;
        if (oldTransformInfo !== undefined) {
            const transformInfo = oldTransformInfo.transformNames.map(
                (transformName) => {
                    return {
                        namespace: oldTransformInfo.translatorName,
                        transformName,
                    };
                },
            );
            const matchSetName = `${matchSet.basename}${matchSet.index !== -1 ? `_${matchSet.index}` : ""}`;
            matchSetToTransformInfo.set(matchSetName, transformInfo);
            namespace = getMatchSetNamespace(transformInfo);
        }
        matchSets.push({
            matches: matchSet.matches,
            basename: matchSet.basename,
            namespace,
            canBeMerged: matchSet.canBeMerged,
            index: matchSet.index,
        });
    }
    return { matchSets, matchSetToTransformInfo };
}
