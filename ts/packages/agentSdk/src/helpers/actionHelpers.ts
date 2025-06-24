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
    entities?: Entity[] | undefined,
): ActionResultSuccessNoDisplay {
    return {
        literalText,
        entities: entities ? entities : [],
    };
}

export function createActionResult(
    literalText: string,
    speak?: boolean | undefined,
    entities?: Entity[] | undefined,
): ActionResultSuccess {
    entities ??= [];
    return {
        literalText,
        entities,
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
    entities?: Entity[] | undefined,
): ActionResultSuccess {
    return {
        literalText,
        entities: entities ? entities : [],
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

/**
 * Create an ActionResultSuccess from markdown text for both conversation history and display.
 * @param markdownText single line or multiple lines of markdown text for both conversation history and display
 * @param entities array of entities for the conversation history
 * @param resultEntity the result entity of the action if any
 * @returns
 */
export function createActionResultFromMarkdownDisplay(
    markdownText: string | string[],
    literalText?: string,
    entities: Entity[] = [],
    resultEntity?: Entity,
): ActionResultSuccess {
    return {
        literalText:
            literalText ??
            (Array.isArray(markdownText)
                ? markdownText.join("\n")
                : markdownText),
        entities,
        resultEntity,
        displayContent: { type: "markdown", content: markdownText },
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
