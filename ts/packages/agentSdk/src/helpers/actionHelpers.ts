// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    ActionResultError,
    ActionResultSuccess,
    ActionResultSuccessNoDisplay,
} from "../action.js";
import { ActionContext } from "../agentInterface.js";
import { DisplayMessageKind } from "../display.js";
import { Entity } from "../memory.js";
import { ChoiceManager, PickRememberResponse } from "./choiceManager.js";
export { ChoiceManager };

export function createActionResultNoDisplay(
    historyText: string,
    entities?: Entity[] | undefined,
): ActionResultSuccessNoDisplay {
    return {
        historyText,
        entities: entities ? entities : [],
    };
}

export function createActionResult(
    displayAndHistoryText: string,
    options?:
        | {
              kind?: DisplayMessageKind;
              speak?: boolean;
          }
        | DisplayMessageKind
        | boolean,
    entities?: Entity | Entity[],
): ActionResultSuccess {
    const displayOptions =
        typeof options === "boolean"
            ? { speak: options }
            : typeof options === "string"
              ? { kind: options }
              : options;

    return {
        historyText: displayAndHistoryText,
        entities: entities
            ? Array.isArray(entities)
                ? entities
                : [entities]
            : [],
        displayContent: displayOptions
            ? {
                  type: "text",
                  content: displayAndHistoryText,
                  ...displayOptions,
              }
            : displayAndHistoryText,
    };
}

export function createActionResultFromTextDisplay(
    displayText: string,
    historyText?: string,
    entities?: Entity[] | undefined,
): ActionResultSuccess {
    return {
        historyText,
        entities: entities ? entities : [],
        displayContent: displayText,
    };
}

export function createActionResultFromHtmlDisplay(
    displayText: string,
    historyText?: string,
    entities?: Entity[] | undefined,
): ActionResultSuccess {
    return {
        historyText,
        entities: entities ? entities : [],
        displayContent: {
            type: "html",
            content: displayText,
        },
    };
}

export function createActionResultFromHtmlDisplayWithScript(
    displayText: string,
    historyText?: string,
): ActionResultSuccess {
    return {
        historyText,
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
    historyText?: string,
    entities: Entity[] = [],
    resultEntity?: Entity,
): ActionResultSuccess {
    return {
        historyText:
            historyText ??
            (Array.isArray(markdownText)
                ? markdownText.join("\n")
                : markdownText),
        entities,
        resultEntity,
        displayContent: { type: "markdown", content: markdownText },
    };
}

// The onResponse callback receives the LIVE ActionContext the dispatcher
// creates when handling the user's choice. Use that context (not the one
// captured in the enclosing scope) when calling actionContext.actionIO.*
// inside the callback — the original ActionContext is closed/stale by the
// time the user responds.
//
// TODO(choice-card dedup / "option 2"): `message` is intentionally placed in
// BOTH `displayContent` (rendered as a normal agent bubble) and
// `pendingChoice.message` (rendered as the interactive choice card). Hosts
// that render choice cards (the Electron shell) therefore show the prompt
// twice; the shell currently suppresses the card's copy via the
// `showMessage:false` option on ChatPanel.askYesNo/addChoicePrompt
// (see shell/src/renderer/src/chatPanelBridge.ts requestChoice). The cleaner
// fix is to stop emitting `displayContent` here and have EVERY host render
// `pendingChoice` — but that first requires implementing `requestChoice` in
// the vscode-shell bridge (currently a no-op that relies on displayContent).
// Until all hosts render choice cards, displayContent stays as the fallback.
export function createYesNoChoiceResult(
    choiceManager: ChoiceManager,
    message: string,
    onResponse: (
        confirmed: boolean,
        actionContext: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>,
    displayHtml?: string,
): ActionResultSuccess {
    const choiceId = choiceManager.registerChoice((response, actionContext) =>
        onResponse(response as boolean, actionContext),
    );
    return {
        entities: [],
        displayContent: displayHtml
            ? { type: "html", content: displayHtml }
            : message,
        pendingChoice: { choiceId, type: "yesNo", message },
    };
}

export function createMultiChoiceResult(
    choiceManager: ChoiceManager,
    message: string,
    choices: string[],
    onResponse: (
        selectedIndices: number[],
        actionContext: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>,
    displayHtml?: string,
): ActionResultSuccess {
    // See the choice-card dedup TODO on createYesNoChoiceResult — `message`
    // is duplicated into displayContent + pendingChoice.message here too.
    const choiceId = choiceManager.registerChoice((response, actionContext) =>
        onResponse(response as number[], actionContext),
    );
    return {
        entities: [],
        displayContent: displayHtml
            ? { type: "html", content: displayHtml }
            : message,
        pendingChoice: { choiceId, type: "multiChoice", message, choices },
    };
}

// Single-select pick + a "remember this" checkbox rendered as one card. The
// callback receives the picked index and the checkbox state. Like the other
// choice helpers, the callback's `actionContext` is the LIVE context created
// when the user responds.
export function createPickRememberChoiceResult(
    choiceManager: ChoiceManager,
    message: string,
    choices: string[],
    checkboxLabel: string,
    onResponse: (
        selected: number,
        remember: boolean,
        actionContext: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>,
    displayHtml?: string,
): ActionResultSuccess {
    const choiceId = choiceManager.registerChoice((response, actionContext) => {
        const r = response as PickRememberResponse;
        return onResponse(r.selected, r.remember, actionContext);
    });
    return {
        entities: [],
        displayContent: displayHtml
            ? { type: "html", content: displayHtml }
            : message,
        pendingChoice: {
            choiceId,
            type: "pickRemember",
            message,
            choices,
            checkboxLabel,
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
