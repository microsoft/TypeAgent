// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    ActionResultError,
    ActionResultSuccess,
    ActionResultSuccessNoDisplay,
} from "../action.js";
import type {
    QuestionFormField,
    QuestionFormPickField,
    QuestionFormPickAnswer,
    QuestionFormResponse,
} from "../action.js";
import { ActionContext } from "../agentInterface.js";
import { DisplayMessageKind, StructuredBlock } from "../display.js";
import { Entity } from "../memory.js";
import { createStructuredContent, structuredToText } from "./displayHelpers.js";
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

// A multi-question "form" card: one or more questions (single-select,
// multi-select, or yes/no, optionally with a free-text "Other" escape). The
// callback receives the whole `QuestionFormResponse` (answers keyed by field
// id). Like the other choice helpers, the callback's `actionContext` is the
// LIVE context created when the user submits. `message` is the card heading;
// each field carries its own prompt. Pass `opts.paged` to render the fields as
// a Back/Next wizard (one question at a time) instead of all at once.
export function createQuestionFormResult(
    choiceManager: ChoiceManager,
    message: string,
    fields: QuestionFormField[],
    onResponse: (
        response: QuestionFormResponse,
        actionContext: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>,
    opts?: { displayHtml?: string; paged?: boolean },
): ActionResultSuccess {
    const choiceId = choiceManager.registerChoice((response, actionContext) =>
        onResponse(response as QuestionFormResponse, actionContext),
    );
    return {
        entities: [],
        displayContent: opts?.displayHtml
            ? { type: "html", content: opts.displayHtml }
            : message,
        // `paged` is only set when requested - exactOptionalPropertyTypes
        // forbids assigning `paged: undefined` on the pendingChoice.
        pendingChoice: opts?.paged
            ? { choiceId, type: "form", message, fields, paged: true }
            : { choiceId, type: "form", message, fields },
    };
}

// Convenience wrapper for the common single-select case: one radio group,
// optionally with a free-text "Other" escape. Built on top of
// createQuestionFormResult as a one-field form. The callback receives the
// picked index (or -1 when the free-text option was used or the card was
// dismissed) and the typed `text` when free text was entered.
export function createSingleChoiceResult(
    choiceManager: ChoiceManager,
    message: string,
    choices: string[],
    onResponse: (
        selected: number,
        text: string | undefined,
        actionContext: ActionContext<unknown>,
    ) => Promise<ActionResult | undefined>,
    opts?: {
        defaultId?: number;
        allowFreeText?: boolean;
        freeTextPlaceholder?: string;
        displayHtml?: string;
    },
): ActionResultSuccess {
    const fieldId = "choice";
    const field: QuestionFormPickField = {
        id: fieldId,
        kind: "pick",
        // Empty prompt: the card heading (`message`) already labels the single
        // question, so a per-field prompt would duplicate it.
        prompt: "",
        choices,
    };
    // exactOptionalPropertyTypes forbids setting an optional property to
    // `undefined`, so only assign when the caller provided a value.
    if (opts?.defaultId !== undefined) {
        field.defaultId = opts.defaultId;
    }
    if (opts?.allowFreeText !== undefined) {
        field.allowFreeText = opts.allowFreeText;
    }
    if (opts?.freeTextPlaceholder !== undefined) {
        field.freeTextPlaceholder = opts.freeTextPlaceholder;
    }
    return createQuestionFormResult(
        choiceManager,
        message,
        [field],
        async (response, actionContext) => {
            const answer = response.answers[fieldId] as
                | QuestionFormPickAnswer
                | undefined;
            return onResponse(
                answer?.selected ?? -1,
                answer?.text,
                actionContext,
            );
        },
        opts?.displayHtml !== undefined
            ? { displayHtml: opts.displayHtml }
            : undefined,
    );
}

export function createActionResultFromError(error: string): ActionResultError {
    return {
        error,
    };
}

/**
 * Create an ActionResultSuccess whose display is a structured block document.
 * The SDK derives markdown/text `alternates` (for clients that don't
 * understand `type: "structured"`) and, unless overridden, a plain-text
 * `historyText` for memory/TTS. `rawData` carries the machine-readable payload
 * for "or otherwise" (non-UI) clients.
 */
export function createStructuredResult(
    blocks: StructuredBlock[],
    options?: {
        rawData?: unknown;
        dataSchema?: unknown;
        kind?: DisplayMessageKind;
        speak?: boolean;
        historyText?: string;
        entities?: Entity[];
        resultEntity?: Entity;
    },
): ActionResultSuccess {
    const displayContent = createStructuredContent(blocks, {
        rawData: options?.rawData,
        dataSchema: options?.dataSchema,
        kind: options?.kind,
        speak: options?.speak,
    });
    return {
        historyText: options?.historyText ?? structuredToText(blocks),
        entities: options?.entities ?? [],
        resultEntity: options?.resultEntity,
        displayContent,
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
