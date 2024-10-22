// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    HistoryContext,
    JSONAction,
    ParamValueType,
} from "../explanation/requestAction.js";
import { ConstructionPart } from "./constructions.js";
import { TransformInfo, isMatchPart, toTransformInfoKey } from "./matchPart.js";
import { ParsePart, isParsePart } from "./parsePart.js";

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
    matchedCount: number;
    wildcardCharCount: number;
};
export function matchedValues(
    parts: ConstructionPart[],
    matched: string[],
    enableWildcard: boolean,
    matchValueTranslator: MatchedValueTranslator,
    history?: HistoryContext,
    conflicts?: boolean,
): MatchedValues | undefined {
    const matchedParts = parts.filter((e) => e.capture);
    if (matchedParts.length !== matched.length) {
        throw new Error(
            "Internal error: number of matched parts doesn't equal match groups",
        );
    }

    const values: [string, ParamValueType][] = [];
    const conflictValues: [string, ParamValueType[]][] | undefined = conflicts
        ? []
        : undefined;
    let matchedCount = 0;
    let wildcardCharCount = 0;

    const wildcardNames = new Set<string>();
    const matchedTransformText = new Map<
        string,
        { transformInfo: TransformInfo; text: string[] }
    >();
    for (let i = 0; i < matchedParts.length; i++) {
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
                    entry = { transformInfo: info, text: [match] };
                    matchedTransformText.set(key, entry);
                    if (enableWildcard && part.wildcard) {
                        wildcardNames.add(key);
                    }
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

    for (const [key, matches] of matchedTransformText.entries()) {
        // See if there are known entities
        const value = matchValueTranslator.transform(
            matches.transformInfo,
            matches.text,
            history,
        );
        const { transformName, actionIndex } = matches.transformInfo;
        const propertyName = `${actionIndex !== undefined ? `${actionIndex}.` : ""}${transformName}`;
        if (value !== undefined) {
            values.push([propertyName, value]);
            matchedCount++;

            if (conflictValues !== undefined) {
                const v = matchValueTranslator.transformConflicts?.(
                    matches.transformInfo,
                    matches.text,
                );
                if (v !== undefined) {
                    conflictValues.push([propertyName, v]);
                }
            }
            continue;
        }

        // Try wildcard
        if (wildcardNames.has(key)) {
            // Wildcard match
            if (matches.text.length > 1) {
                // TODO: Don't support multiple subphrase wildcard match for now.
                return undefined;
            }
            const match = matches.text.join(" ");
            values.push([propertyName, match]);
            wildcardCharCount += match.length;
            continue;
        }

        // TODO: Only deal with exact match for now
        return undefined;
    }
    return {
        values,
        conflictValues,
        matchedCount,
        wildcardCharCount,
    };
}

function setActionProperty(object: any, name: string, value: any) {
    const properties = name.split(".");
    let lastName: string | number = "actionProps";
    let curr = object;
    for (let i = 0; i < properties.length; i++) {
        const name = properties[i];
        // Protect against prototype pollution
        if (
            name === "__proto__" ||
            name === "constructor" ||
            name === "prototype"
        ) {
            throw new Error(`Invalid property name: ${name}`);
        }
        const maybeIndex = parseInt(name);
        if (maybeIndex.toString() === name) {
            // Array index
            if (curr[lastName] === undefined) {
                curr[lastName] = [];
            }
            curr = curr[lastName];
            if (!Array.isArray(curr)) {
                throw new Error(`Internal error: ${lastName} is not an array`);
            }
            lastName = maybeIndex;
        } else {
            if (curr[lastName] === undefined) {
                curr[lastName] = {};
            }
            curr = curr[lastName];
            if (typeof curr !== "object") {
                throw new Error(`Internal error: ${lastName} is not an object`);
            }
            lastName = name;
        }
    }
    curr[lastName] = value;
}

export function createActionProps(
    values: [string, ParamValueType][],
    initial?: JSONAction | JSONAction[],
) {
    const result: any = { actionProps: structuredClone(initial) };
    for (const [name, value] of values) {
        setActionProperty(result, name, value);
    }
    const actionProps = result.actionProps;
    if (actionProps.parameters === undefined) {
        actionProps.parameters = {};
    }

    // validate fullActionName
    if (Array.isArray(actionProps)) {
        actionProps.forEach((actionProp) => {
            if (actionProp.fullActionName === undefined) {
                throw new Error("Internal error: fullActionName missing");
            }
        });
    } else {
        if (actionProps.fullActionName === undefined) {
            throw new Error("Internal error: fullActionName missing");
        }
    }
    return actionProps;
}
