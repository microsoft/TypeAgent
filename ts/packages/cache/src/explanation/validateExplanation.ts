// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RequestAction,
    ParamValueType,
    ParamFieldType,
    JSONAction,
} from "./requestAction.js";
import {
    spaceAndPunctuationRegexStr,
    escapeMatch,
    wordBoundaryRegexStr,
} from "../utils/regexp.js";
import { getExactStringRequirementMessage } from "./explainer.js";

// shared sub-phrase checks

export interface GenericSubPhrase {
    text: string;
}

export function validateSubPhraseText(
    requestAction: RequestAction,
    subPhrases: GenericSubPhrase[],
) {
    let current = requestAction.request;
    let first = true;
    const addPrefix = (str: string) => {
        const match = escapeMatch(str);
        if (first) {
            return match;
        }
        return `${spaceAndPunctuationRegexStr}*?${match}`;
    };

    for (const phrase of subPhrases) {
        if (phrase.text === "") {
            return `Missing text: sub-phrase in explanation have empty text value`;
        }

        // check if the sub-phrase match the next in the text.
        const expectedMatch = addPrefix(phrase.text);
        const matchNext = new RegExp(
            `^${expectedMatch}${wordBoundaryRegexStr}(.*)`,
            "i",
        );

        const result = matchNext.exec(current);
        if (result === null) {
            // doesn't match, detect different errors
            const matchBoundary = new RegExp(
                `^${expectedMatch}(?<=\\w)(\\w+)`,
                "i",
            );
            const boundaryResult = matchBoundary.exec(current);
            if (boundaryResult !== null) {
                return `Invalid sub-phrase: sub-phrase text '${phrase.text}' not at word boundary with the trailing '${boundaryResult[1]}'. ${getExactStringRequirementMessage()}`;
            }
            const matchNext = new RegExp(
                `^${spaceAndPunctuationRegexStr}*(.*?)${expectedMatch}`,
                "i",
            );
            const nextResult = matchNext.exec(current);
            if (nextResult !== null) {
                return `Missing sub-phrase: explanation missing for '${nextResult[1]}'`;
            }
            const matchAnywhere = new RegExp(escapeMatch(phrase.text), "i");
            const anyResult = matchAnywhere.exec(requestAction.request);
            if (anyResult !== null) {
                return `Overlapping sub-phrase: explanation has overlapping text '${phrase.text}'.`;
            }
            return `Extraneous sub-phrase: sub-phrase text '${phrase.text}' not found in request.  ${getExactStringRequirementMessage()}`;
        }
        first = false;
        current = result[1];
    }
    const end = new RegExp(`^${spaceAndPunctuationRegexStr}*$`, "i");
    if (end.exec(current) === null) {
        return `Missing sub-phrase: explanation missing for the end of request '${current}'`;
    }

    return undefined;
}

export function getActionProperty(
    actionProps: ParamFieldType | JSONAction | JSONAction[],
    propertyName: string,
) {
    const nameParts = propertyName.split(".");
    let curr = actionProps as ParamFieldType; // TODO: Is there a better typing
    for (const part of nameParts) {
        const number = parseInt(part);
        if (Array.isArray(curr)) {
            if (number.toString() === part) {
                curr = curr[number];
                continue;
            }
        } else if (typeof curr === "object" && curr.hasOwnProperty(part)) {
            curr = curr[part];
            continue;
        }
        return undefined;
    }
    return curr;
}

export function checkActionPropertyValue(
    actionProps: ParamFieldType | JSONAction | JSONAction[],
    propertyName: string,
    implicit: boolean,
): ParamValueType {
    const parameterStr = implicit ? "implicit parameter" : "parameter";
    const curr = getActionProperty(actionProps, propertyName);
    if (curr === undefined) {
        throw new Error(
            `Extraneous ${parameterStr}: '${propertyName}' is not a parameter in the action`,
        );
    }
    if (Array.isArray(curr) || typeof curr === "object") {
        // This shouldn't happen since the schema should have caught it
        throw new Error(
            `Invalid ${parameterStr}: '${propertyName}' is not a leaf with a primitive value in the action`,
        );
    }
    return curr;
}

// make sure the parameter value in the explanation is the same as the parameter value in the action
export function checkActionProperty(
    actionProps: ParamFieldType | JSONAction | JSONAction[], // work on action or action.parameters, based on "paramName" format matches
    param: {
        paramName: string;
        paramValue: ParamValueType;
    },
    implicit: boolean,
) {
    const curr = checkActionPropertyValue(
        actionProps,
        param.paramName,
        implicit,
    );
    let isEqual = false;
    if (Array.isArray(curr) === Array.isArray(param.paramValue)) {
        const currParamCompare = Array.isArray(curr)
            ? JSON.stringify(curr)
            : curr;
        const paramValueCompare = Array.isArray(param.paramValue)
            ? JSON.stringify(param.paramValue)
            : param.paramValue;
        isEqual = currParamCompare === paramValueCompare;
    }
    if (!isEqual) {
        throw new Error(
            `Mismatch parameter value: '${param.paramValue}' in the explanation is not the value of the parameter '${param.paramName}' in the action`,
        );
    }
}

// Walk the values to ensure that the parameter is in the explanationParamNameSet
// Use to check if the parameter is missing from the explanation
function ensureProperty(
    explanationParamNameSet: Set<string>,
    propertyName: string,
    value: ParamFieldType,
) {
    const corrections: string[] = [];
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            corrections.push(
                ...ensureProperty(
                    explanationParamNameSet,
                    `${propertyName}.${i}`,
                    value[i],
                ),
            );
        }
    } else if (typeof value === "object") {
        for (const key of Object.keys(value)) {
            corrections.push(
                ...ensureProperty(
                    explanationParamNameSet,
                    `${propertyName}.${key}`,
                    value[key], // TODO: better typing
                ),
            );
        }
    } else {
        if (!explanationParamNameSet.has(propertyName)) {
            corrections.push(
                `Missing parameter: parameter '${propertyName}' in the action is missing from explanation`,
            );
        }
    }
    return corrections;
}

// Make sure the explanationParamNameSet has all property names
export function ensureProperties(
    explanationParamNameSet: Set<string>,
    actionProps: ParamFieldType | JSONAction | JSONAction[],
) {
    const corrections: string[] = [];
    for (const key of Object.keys(actionProps)) {
        corrections.push(
            ...ensureProperty(
                explanationParamNameSet,
                key,
                (actionProps as any)[key], // TODO: better typing
            ),
        );
    }
    return corrections;
}
