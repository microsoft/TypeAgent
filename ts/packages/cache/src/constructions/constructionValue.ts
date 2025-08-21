// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setObjectProperty } from "common-utils";
import {
    HistoryContext,
    JSONAction,
    ParamValueType,
} from "../explanation/requestAction.js";
import { ConstructionPart, WildcardMode } from "./constructions.js";
import {
    TransformInfo,
    getPropertyNameFromTransformInfo,
    isMatchPart,
    toTransformInfoKey,
} from "./matchPart.js";
import { ParsePart, isParsePart } from "./parsePart.js";
import { isWildcardEnabled, MatchConfig } from "./constructionMatch.js";

export type MatchedValueTranslator = {
    transform(
        transformInfo: TransformInfo,
        matchedText: string[],
        history?: HistoryContext,
    ): ParamValueType | undefined;
    transformConflicts?(
        transformInfo: TransformInfo,
        matchedText: string[],
    ): ParamValueType[] | undefined;
    parse(parsePart: ParsePart, match: string): ParamValueType;
};

export type MatchedValues = {
    values: [string, ParamValueType][];
    conflictValues: [string, ParamValueType[]][] | undefined;
    entityWildcardPropertyNames: string[];
    matchedCount: number;
    wildcardCharCount: number;
    partialPartCount?: number; // Only used for partial match
};

export function matchedValues(
    parts: ConstructionPart[],
    matched: string[],
    config: MatchConfig,
    matchValueTranslator: MatchedValueTranslator,
): MatchedValues | undefined {
    const matchedParts = parts.filter((e) => e.capture);
    if (
        config.partial
            ? matched.length > matchedParts.length
            : matchedParts.length !== matched.length
    ) {
        throw new Error(
            "Internal error: number of matched parts doesn't equal match groups",
        );
    }

    const values: [string, ParamValueType][] = [];
    const conflictValues: [string, ParamValueType[]][] | undefined =
        config.conflicts ? [] : undefined;
    const entityWildcardPropertyNames: string[] = [];
    let matchedCount = 0;
    let wildcardCharCount = 0;

    const matchedTransformText = new Map<
        string,
        {
            transformInfo: TransformInfo;
            text: string[];
            wildcardMode: WildcardMode;
        }
    >();
    for (let i = 0; i < matched.length; i++) {
        const part = matchedParts[i];
        const match = matched[i];
        if (isMatchPart(part)) {
            for (const info of part.transformInfos!) {
                // Format of key doesn't matter, it is only to ensure uniqueness
                const key = toTransformInfoKey(info);
                let entry = matchedTransformText.get(key);
                if (entry !== undefined) {
                    entry.text.push(match);
                } else {
                    entry = {
                        transformInfo: info,
                        text: [match],
                        wildcardMode: part.wildcardMode,
                    };
                    matchedTransformText.set(key, entry);
                }
            }
        } else if (isParsePart(part)) {
            values.push([
                part.propertyName,
                matchValueTranslator.parse(part, match),
            ]);
            matchedCount++;
        } else {
            throw new Error("Internal error: unknown part type");
        }
    }

    for (const matches of matchedTransformText.values()) {
        const transformInfo = matches.transformInfo;

        if (config.partial && matches.text.length !== transformInfo.partCount) {
            // Partial match, so we don't have all the parts.  Just skip.
            continue;
        }

        // Check existing values.
        const value = matchValueTranslator.transform(
            transformInfo,
            matches.text,
            config.history,
        );
        const propertyName = getPropertyNameFromTransformInfo(transformInfo);
        if (value !== undefined) {
            values.push([propertyName, value]);
            matchedCount++;

            if (conflictValues !== undefined) {
                const v = matchValueTranslator.transformConflicts?.(
                    transformInfo,
                    matches.text,
                );
                if (v !== undefined) {
                    conflictValues.push([propertyName, v]);
                }
            }
            continue;
        }

        // Try wildcard
        if (
            isWildcardEnabled(config, matches.wildcardMode) &&
            // TODO: Don't support multiple subphrase wildcard match for now.
            matches.text.length === 1
        ) {
            const match = matches.text.join(" ");
            values.push([propertyName, match]);

            if (matches.wildcardMode === WildcardMode.Entity) {
                // Don't include entity wildcard in the wildcard char count
                // It should be rejected if there is not a matched entity.
                entityWildcardPropertyNames.push(propertyName);
            } else {
                wildcardCharCount += match.length;
            }
            continue;
        }

        // TODO: Only deal with exact match for now
        return undefined;
    }
    return {
        values,
        entityWildcardPropertyNames,
        conflictValues,
        matchedCount,
        wildcardCharCount,
    };
}

export function createActionProps(
    values: [string, ParamValueType][],
    emptyArrayParameters?: string[],
    partial: boolean = false,
    initial?: JSONAction | JSONAction[],
) {
    const result: any = { actionProps: structuredClone(initial) };
    for (const [name, value] of values) {
        setObjectProperty(result, "actionProps", name, value);
    }

    if (emptyArrayParameters) {
        for (const name of emptyArrayParameters) {
            setObjectProperty(result, "actionProps", name, []);
        }
    }

    const actionProps = result.actionProps;

    if (actionProps === undefined) {
        if (partial) {
            return { fullActionName: "unknown.unknown" };
        }
        throw new Error(
            "Internal error: No values provided for action properties",
        );
    }
    // validate fullActionName
    if (Array.isArray(actionProps)) {
        actionProps.forEach((actionProp) => {
            if (actionProp.fullActionName === undefined) {
                if (!partial) {
                    throw new Error("Internal error: fullActionName missing");
                }
                // Leave undefined for partial matches
            }
        });
    } else if (actionProps.fullActionName === undefined) {
        if (!partial) {
            throw new Error("Internal error: fullActionName missing");
        }
        // Leave undefined for partial matches
    }

    return actionProps;
}
