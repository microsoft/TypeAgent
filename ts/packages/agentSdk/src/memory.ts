// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "./display.js";

export interface Entity {
    // the name of the entity such as "Bach" or "frog"
    name: string;
    // the types of the entity such as "artist" or "animal"; an entity can have multiple types; entity types should be single words
    type: string[];

    additionalEntityText?: string;
    uniqueId?: string;
}

export type AssociationType = string;

export type ProximityType =
    | "temporal"
    | "spatial"
    | "conceptual"
    | "functional"
    | string;

export type StrengthType = "strong" | "moderate" | "weak";

export type Association = {
    type: AssociationType; // The type of relationship
    proximity?: ProximityType;
    strength?: StrengthType;
};

export interface Relationship {
    from: Entity;
    to: Entity;
    association: Association;
}

export function entitiesToString(entities: Entity[], indent = ""): string {
    // entities in the format "name (type1, type2)"
    return entities
        .map((entity) => `${indent}${entity.name} (${entity.type.join(", ")})`)
        .join("\n");
}

export function actionResultToString(actionResult: ActionResult): string {
    if (actionResult.error) {
        return `Error: ${actionResult.error}`;
    } else {
        // add to result all non-empty fields of the turn impression, using entitiesToString for the entities
        const fields = Object.entries(actionResult)
            .filter(([key, value]) => Array.isArray(value) && value.length > 0)
            .map(([key, value]) => {
                if (key === "entities") {
                    return `${key}:\n${entitiesToString(value as Entity[], "  ")}`;
                }
                return `${key}: ${value}`;
            });
        return fields.join("\n");
    }
}

export type ActionResultError = {
    error: string;
};

export type ActionResultSuccessNoDisplay = {
    literalText?: string | undefined;
    displayContent?: undefined;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResultSuccess = {
    literalText?: string | undefined;
    displayContent: DisplayContent;
    entities: Entity[];
    relationships?: Relationship[] | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResult =
    | ActionResultSuccessNoDisplay
    | ActionResultSuccess
    | ActionResultError;

export function createActionResultNoDisplay(
    literalText: string,
): ActionResultSuccessNoDisplay {
    return {
        literalText,
        entities: [],
    };
}

export function createActionResult(
    literalText: string,
    speak?: boolean,
): ActionResultSuccess {
    return {
        literalText,
        entities: [],
        displayContent: speak
            ? {
                  type: "text",
                  content: literalText,
                  speak: true,
              }
            : literalText,
    };
}

export function createActionResultFromTextDisplay(
    displayText: string,
    literalText?: string,
): ActionResultSuccess {
    return {
        literalText,
        entities: [],
        displayContent: displayText,
    };
}

export function createActionResultFromHtmlDisplay(
    displayText: string,
    literalText?: string,
): ActionResultSuccess {
    return {
        literalText,
        entities: [],
        displayContent: {
            type: "html",
            content: displayText,
        },
    };
}

export function createActionResultFromError(error: string): ActionResultError {
    return {
        error,
    };
}
