// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorFromFile } from "common-utils";
import { TypeChatAgent } from "../typeChatAgent.js";
import {
    PropertyExplanation,
    ImplicitProperty,
    Property,
    EntityProperty,
} from "./propertyExplanationSchemaV5WithContext.js";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";
import {
    toJsonActions,
    normalizeParamString,
    RequestAction,
} from "../requestAction.js";
import {
    getActionDescription,
    getExactStringRequirementMessage,
} from "../explainer.js";
import {
    checkActionProperty,
    ensureProperties,
} from "../validateExplanation.js";
import { form } from "./explanationV5.js";
import { ExplainerConfig } from "../genericExplainer.js";

export type PropertyExplainer = TypeChatAgent<
    RequestAction,
    PropertyExplanation,
    ExplainerConfig
>;
export function createPropertyExplainer(
    enableContext: boolean,
    model?: string,
) {
    const substringRequirement = getExactStringRequirementMessage(false);
    return new TypeChatAgent(
        "property explanation",
        () => {
            return createJsonTranslatorFromFile<PropertyExplanation>(
                "PropertyExplanation",
                getPackageFilePath(
                    enableContext
                        ? "./src/explanation/v5/propertyExplanationSchemaV5WithContext.ts"
                        : "./src/explanation/v5/propertyExplanationSchemaV5.ts",
                ),
                { model },
            );
        },
        (requestAction: RequestAction) => {
            return (
                `${form} with the following value:\n${requestAction.toPromptString()}\n` +
                (enableContext
                    ? `For each property, explain which substring of the request or entities in the conversation history is used to compute the value. ${substringRequirement}\n`
                    : `For each property, explain which substring of the request is used to compute the value. ${substringRequirement}\n`) +
                getActionDescription(requestAction)
            );
        },
        (requestAction) => requestAction.toPromptString(),
        validatePropertyExplanation,
    );
}

export function isImplicitParameter(
    parameter: Property | ImplicitProperty | EntityProperty,
): parameter is ImplicitProperty {
    return parameter.hasOwnProperty("isImplicit");
}

export function isEntityParameter(
    parameter: Property | ImplicitProperty | EntityProperty,
): parameter is EntityProperty {
    return parameter.hasOwnProperty("entityIndex");
}

// REVIEW: disable entity constructions.
const enableEntityConstructions = false;

function validatePropertyExplanation(
    requestAction: RequestAction,
    actionExplanation: PropertyExplanation,
    config?: ExplainerConfig,
): string[] | undefined {
    const corrections: string[] = [];
    const propertyNameSet = new Set<string>();
    const actionProps = toJsonActions(requestAction.actions);
    for (const prop of actionExplanation.properties) {
        if (propertyNameSet.has(prop.name)) {
            corrections.push(
                `Multiple properties with property name '${prop.name}' found`,
            );
            // Don't check the rest.
            continue;
        }
        propertyNameSet.add(prop.name);

        try {
            checkActionProperty(
                actionProps,
                {
                    paramName: prop.name,
                    paramValue: prop.value,
                },
                isImplicitParameter(prop),
            );
        } catch (e: any) {
            corrections.push(e.message);
        }

        if (!isImplicitParameter(prop)) {
            if (isEntityParameter(prop) && prop.entityIndex !== undefined) {
                // TODO: fuzzy match
                if (
                    normalizeParamString(prop.substrings.join(" ")) ===
                    normalizeParamString(prop.value.toString())
                ) {
                    corrections.push(
                        `'${prop.name}' has value '${prop.value}' from a substring in the request. Should not have an entity index.`,
                    );
                } else {
                    if (enableEntityConstructions === false) {
                        throw new Error(
                            "Request has references to entities in the context",
                        );
                    }
                    const entities = requestAction.history?.entities;
                    if (
                        entities === undefined ||
                        prop.entityIndex < 0 ||
                        entities.length <= prop.entityIndex
                    ) {
                        corrections.push(
                            `Entity index ${prop.entityIndex} for '${prop.name}' is out of range`,
                        );
                    } else if (entities[prop.entityIndex].name !== prop.value) {
                        corrections.push(
                            `Entity at index ${prop.entityIndex} in the context doesn't match the value for property '${prop.name}'`,
                        );
                    }
                }
            }

            const normalizedRequest = normalizeParamString(
                requestAction.request,
            );
            for (const substring of prop.substrings) {
                if (
                    !normalizedRequest.includes(normalizeParamString(substring))
                ) {
                    corrections.push(
                        `Substring '${substring}' for property '${prop.name}' not found in the request string. ${getExactStringRequirementMessage(false)}`,
                    );
                }
            }

            // REVIEW: Heuristic to detect the obvious case for number computation missing substrings.
            if (
                typeof prop.value === "number" &&
                prop.substrings.length === 1
            ) {
                const value = /\d+/.exec(prop.substrings[0]);
                if (value !== null) {
                    if (parseInt(value[0]) !== prop.value) {
                        corrections.push(
                            `Value ${prop.value} for property '${prop.name}' doesn't match the number ${value} in the substring '${prop.substrings[0]}'. Missing other substring to explain the value.`,
                        );
                    }
                }
            }
        }
    }
    corrections.push(...ensureProperties(propertyNameSet, actionProps));
    return corrections.length > 0 ? corrections : undefined;
}
