// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RequestAction,
    ParamValueType,
    HistoryContext,
    fromJsonActions,
} from "../explanation/requestAction.js";
import { MatchConfig, matchParts } from "./constructionMatch.js";
import {
    ParsePart,
    ParsePartJSON,
    createParsePartFromJSON,
} from "./parsePart.js";
import {
    MatchPart,
    MatchPartJSON,
    MatchSet,
    TransformInfo,
} from "./matchPart.js";
import { Transforms } from "./transforms.js";
import {
    MatchedValueTranslator,
    createActionProps,
    matchedValues,
} from "./constructionValue.js";

type ImplicitParameter = {
    paramName: string;
    paramValue: ParamValueType;
};

export const enum WildcardMode {
    Disabled = 0,
    Enabled = 1,
    Checked = 2,
}

export type ConstructionPart = {
    readonly wildcardMode: WildcardMode;
    readonly capture: boolean;
    readonly regExp: RegExp;
    readonly optional: boolean;
    equals(other: ConstructionPart): boolean;

    toString(verbose?: boolean): string;

    // For partial match, return completion value for this part.
    getCompletion(): Iterable<string> | undefined;

    // For partial match, return the property name for this part.
    getPropertyNames(): string[] | undefined;
};

function getDefaultTranslator(transformNamespaces: Map<string, Transforms>) {
    return {
        transform(
            transformInfo: TransformInfo,
            matchedText: string[],
            history?: HistoryContext,
        ): ParamValueType | undefined {
            const matchedTextKey = matchedText.join("|");
            const { namespace, transformName } = transformInfo;
            return transformNamespaces
                .get(namespace)
                ?.get(transformName, matchedTextKey, history);
        },
        transformConflicts(
            transformInfo: TransformInfo,
            matchedText: string[],
        ): ParamValueType[] | undefined {
            const matchedTextKey = matchedText.join("|");
            const { namespace, transformName } = transformInfo;
            return transformNamespaces
                .get(namespace)
                ?.getConflicts(transformName, matchedTextKey);
        },
        parse(parsePart: ParsePart, match: string): ParamValueType {
            return parsePart.convertToValue(match);
        },
    };
}

export class Construction {
    public static create(
        parts: ConstructionPart[],
        transformNamespaces: Map<string, Transforms>,
        emptyArrayParameters?: string[],
        implicitParameters?: ImplicitParameter[],
        implicitActionName?: string,
    ) {
        return new Construction(
            parts,
            transformNamespaces,
            emptyArrayParameters,
            implicitParameters,
            implicitActionName,
            -1,
        );
    }

    constructor(
        public readonly parts: ConstructionPart[],
        public readonly transformNamespaces: Map<string, Transforms>,
        public readonly emptyArrayParameters: string[] | undefined,
        public readonly implicitParameters: ImplicitParameter[] | undefined,
        public readonly implicitActionName: string | undefined,
        public readonly id: number, // runtime Id
    ) {
        if (parts.every((p) => p.optional)) {
            throw new Error("Construction must have one non-optional part");
        }
    }

    public get implicitParameterCount() {
        return this.implicitParameters ? this.implicitParameters.length : 0;
    }

    public match(request: string, config: MatchConfig): MatchResult[] {
        const matchedValues = matchParts(
            request,
            this.parts,
            config,
            getDefaultTranslator(this.transformNamespaces),
        );

        if (matchedValues === undefined) {
            return [];
        }
        this.collectImplicitProperties(matchedValues.values);
        const actionProps = createActionProps(
            matchedValues.values,
            this.emptyArrayParameters,
            config.partial,
        );
        return [
            {
                construction: this,
                match: new RequestAction(
                    request,
                    fromJsonActions(actionProps),
                    config.history,
                ),
                conflictValues: matchedValues.conflictValues,
                matchedCount: matchedValues.matchedCount,
                wildcardCharCount: matchedValues.wildcardCharCount,
                nonOptionalCount: this.parts.filter((p) => !p.optional).length,
                partialPartCount: matchedValues.partialPartCount,
            },
        ];
    }

    public getMatchedValues(
        matched: string[],
        config: MatchConfig,
        matchValueTranslator: MatchedValueTranslator,
    ) {
        const result = matchedValues(
            this.parts,
            matched,
            config,
            matchValueTranslator,
        );
        if (result === undefined) {
            return undefined;
        }
        this.collectImplicitProperties(result.values);
        return result;
    }

    private collectImplicitProperties(values: [string, ParamValueType][]) {
        if (this.implicitParameters) {
            for (const implicit of this.implicitParameters) {
                values.push([implicit.paramName, implicit.paramValue]);
            }
        }
    }

    public toString(verbose: boolean = false) {
        return `${this.parts.map((p) => p.toString(verbose)).join("")}${
            this.implicitParameterCount !== 0
                ? `[${this.implicitParameters
                      ?.map((p) => `${p.paramName}=${p.paramValue}`)
                      .join("][")}]`
                : ""
        }${
            this.implicitActionName
                ? `[actionName=${this.implicitActionName}]`
                : ""
        }`;
    }

    public isSupersetOf(
        others: ConstructionPart[],
        implicitParameters: ImplicitParameter[] | undefined,
    ) {
        let index = 0;
        for (const e of others) {
            let found = false;
            while (index < this.parts.length) {
                if (e.equals(this.parts[index])) {
                    found = true;
                    index++;
                    break;
                }
                if (!this.parts[index].optional) {
                    return false;
                }
                index++;
            }
            if (!found) {
                return false;
            }
        }

        for (let curr = index; curr < this.parts.length; curr++) {
            if (!this.parts[curr].optional) {
                return false;
            }
        }

        // Check implicitParameters
        const otherLength = implicitParameters ? implicitParameters.length : 0;
        const thisLength = this.implicitParameters
            ? this.implicitParameters.length
            : 0;
        if (thisLength !== otherLength) {
            return false;
        }

        if (thisLength === 0) {
            return true;
        }

        const otherSorted = implicitParameters!.sort((a, b) =>
            a.paramName.localeCompare(b.paramName),
        );
        const thisSorted = this.implicitParameters!.sort((a, b) =>
            a.paramName.localeCompare(b.paramName),
        );

        for (let i = 0; i < thisLength; i++) {
            if (otherSorted[i].paramName !== thisSorted[i].paramName) {
                return false;
            }
            if (otherSorted[i].paramValue !== thisSorted[i].paramValue) {
                return false;
            }
        }

        return true;
    }

    public static fromJSON(
        construction: ConstructionJSON,
        allMatchSets: Map<string, MatchSet>,
        transformNamespaces: Map<string, Transforms>,
        index: number,
    ) {
        return new Construction(
            construction.parts.map((part) => {
                if (isParsePartJSON(part)) {
                    return createParsePartFromJSON(part);
                }
                const matchSet = allMatchSets.get(part.matchSet);
                if (matchSet === undefined) {
                    throw new Error(
                        `Unable to resolve MatchSet ${part.matchSet}`,
                    );
                }
                return new MatchPart(
                    matchSet,
                    part.optional ?? false,
                    part.wildcardMode ?? WildcardMode.Disabled,
                    part.transformInfos,
                );
            }),
            transformNamespaces,
            construction.emptyArrayParameters,
            construction.implicitParameters,
            construction.implicitActionName,
            index,
        );
    }
    public toJSON() {
        // NOTE: transform needs to be saved separately, as they are currently global when the construction is in a cache.
        return {
            parts: this.parts,
            implicitParameters:
                this.implicitParameters?.length === 0
                    ? undefined
                    : this.implicitParameters,
            implicitActionName: this.implicitActionName,
        };
    }
}

type ConstructionPartJSON = MatchPartJSON | ParsePartJSON;

function isParsePartJSON(part: ConstructionPartJSON): part is ParsePartJSON {
    return (part as any).parserName !== undefined;
}

export type ConstructionJSON = {
    parts: ConstructionPartJSON[];
    emptyArrayParameters?: string[];
    implicitParameters?: ImplicitParameter[];
    implicitActionName?: string;
};

export type MatchResult = {
    construction: Construction;
    match: RequestAction;
    matchedCount: number;
    wildcardCharCount: number;
    nonOptionalCount: number;
    conflictValues?: [string, ParamValueType[]][] | undefined;
    partialPartCount?: number | undefined; // Only used for partial match
};

export function convertConstructionV2ToV3(
    constructions: ConstructionJSON[],
    matchSetToTransformInfo: Map<string, TransformInfo[]>,
) {
    for (const construction of constructions) {
        construction.parts.forEach((part) => {
            if (isParsePartJSON(part)) {
                throw new Error("ParsePart is not supported in V2");
            }
            const transformInfos = matchSetToTransformInfo.get(part.matchSet);
            if (transformInfos) {
                part.transformInfos = transformInfos;
            }
        });
    }
}
