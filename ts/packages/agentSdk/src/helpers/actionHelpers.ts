// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    ActionResultError,
    ActionResultSuccess,
    ActionResultSuccessNoDisplay,
} from "../action.js";
import { Entity } from "../memory.js";

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

export function createActionResultFromHtmlDisplayWithScript(
    displayText: string,
    literalText?: string,
): ActionResultSuccess {
    return {
        literalText,
        entities: [],
        displayContent: {
            type: "iframe",
            content: displayText,
        },
    };
}

export function createActionResultFromError(error: string): ActionResultError {
    return {
        error,
    };
}

function entitiesToString(entities: Entity[], indent = ""): string {
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
