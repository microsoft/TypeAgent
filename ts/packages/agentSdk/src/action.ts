// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActivityContext } from "./agentInterface.js";
import { DisplayContent } from "./display.js";
import { Entity } from "./memory.js";

export interface AppAction {
    actionName: string;
    schemaName?: string;
    parameters?: Record<string, unknown>; // the type of the parameters are defined by the AppAgent
}

export type ActionResultError = {
    error: string;
    fallbackToReasoning?: boolean | undefined;
};

// LLM token usage an agent may attribute to executing an action/command.
// Structurally compatible with aiclient's `CompletionUsageStats` and the
// dispatcher's `CompletionUsageStats` — duplicated here so agent-sdk stays
// dependency-free. Agents that make LLM calls SHOULD report this so the UI
// can show "Action Tokens". Leaving it `undefined` means "not reported /
// unknown" — which is distinct from a reported value of 0 (no LLM call).
export type ActionTokenUsage = {
    completion_tokens: number;
    prompt_tokens: number;
    total_tokens: number;
    // Cached prompt tokens (read from / written to the model provider's prompt
    // cache), reported separately from `prompt_tokens`. Optional; `undefined`
    // => the provider/agent does not expose cache metrics.
    cached_tokens?: number;
};

export type ActionResultActivityContext = Omit<
    ActivityContext,
    "appAgentName"
> | null;

export type PendingYesNoChoice = {
    choiceId: string;
    type: "yesNo";
    message: string;
};

export type PendingMultiChoice = {
    choiceId: string;
    type: "multiChoice";
    message: string;
    choices: string[];
};

/**
 * A single-select pick combined with a "remember this" checkbox. Rendered as
 * one card: the user clicks one of `choices` and optionally checks the
 * `checkboxLabel` box. The response is a `PickRememberResponse`.
 */
export type PendingPickRememberChoice = {
    choiceId: string;
    type: "pickRemember";
    message: string;
    choices: string[];
    checkboxLabel: string;
};

// ---------------------------------------------------------------------------
// Multi-question form (createQuestionFormResult)
//
// A "form" card holds one or more questions that the user answers together and
// submits once. Each field is a single-select (`pick`), multi-select
// (`multiChoice`), or `yesNo` question, and pick/multiChoice fields may offer a
// free-text "Other: ___" escape so the user can type a value instead of
// picking one of the listed choices.
// ---------------------------------------------------------------------------

// Single-select question. Rendered as a radio group. When `allowFreeText` is
// set, an extra "Other: ___" radio lets the user type a value instead of
// picking one of `choices`.
export type QuestionFormPickField = {
    id: string;
    kind: "pick";
    prompt: string;
    choices: string[];
    defaultId?: number;
    allowFreeText?: boolean;
    freeTextPlaceholder?: string;
};

// Multi-select question. Rendered as checkboxes. When `allowFreeText` is set,
// an extra "Other: ___" checkbox lets the user add a typed value alongside any
// checked choices.
export type QuestionFormMultiChoiceField = {
    id: string;
    kind: "multiChoice";
    prompt: string;
    choices: string[];
    defaultIds?: number[];
    allowFreeText?: boolean;
    freeTextPlaceholder?: string;
};

// Yes/No question. Rendered as a Yes/No pair.
export type QuestionFormYesNoField = {
    id: string;
    kind: "yesNo";
    prompt: string;
    defaultValue?: boolean;
};

export type QuestionFormField =
    | QuestionFormPickField
    | QuestionFormMultiChoiceField
    | QuestionFormYesNoField;

// A card of one or more questions. `message` is an optional heading rendered
// above the fields.
export type QuestionForm = {
    message?: string;
    fields: QuestionFormField[];
    // When true, GUI hosts render the fields as a wizard - one question at a
    // time with Back / Next navigation - instead of all at once, and only
    // return the response when the user finishes the last step. The response is
    // the same QuestionFormResponse (all answers keyed by field id). Non-GUI
    // hosts (CLI/console) prompt sequentially and ignore this.
    paged?: boolean;
};

export type PendingQuestionForm = {
    choiceId: string;
    type: "form";
} & QuestionForm;

// ---- Form answers (QuestionFormResponse) ----

export type QuestionFormPickAnswer = {
    kind: "pick";
    // Index into the field's `choices`, or -1 when the user typed a value via
    // the free-text "Other" option (see `text`) or dismissed the card.
    selected: number;
    // The typed value when the free-text option was used.
    text?: string;
};

export type QuestionFormMultiChoiceAnswer = {
    kind: "multiChoice";
    // Indices into the field's `choices`.
    selected: number[];
    // The typed value when the free-text option was used.
    text?: string;
};

export type QuestionFormYesNoAnswer = {
    kind: "yesNo";
    value: boolean;
};

export type QuestionFormFieldAnswer =
    | QuestionFormPickAnswer
    | QuestionFormMultiChoiceAnswer
    | QuestionFormYesNoAnswer;

// Response to a `QuestionForm`: one answer per field, keyed by field `id`.
export type QuestionFormResponse = {
    answers: Record<string, QuestionFormFieldAnswer>;
    // True when the user dismissed the card without submitting.
    cancelled?: boolean;
};

export type PendingChoice =
    | PendingYesNoChoice
    | PendingMultiChoice
    | PendingPickRememberChoice
    | PendingQuestionForm;

export type ActionResultSuccess = {
    historyText?: string | undefined;
    displayContent: DisplayContent; // the display content to be appended with "block" mode
    entities: Entity[];
    resultEntity?: Entity | undefined;
    // Concrete value this result represents (e.g. the list an action produced).
    // Enables inline result-chaining: a later action in the same request can
    // reference it via { "$result": "<id>" } in a parameter. The dispatcher
    // substitutes this value at execution time and validates it against the
    // consuming parameter's type.
    resultValue?: unknown;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    additionalInstructions?: string[] | undefined;
    additionalActions?: AppAction[];
    error?: undefined;

    // REVIEW: activityContext needs to be declarative in the schema instead of generated by the action themselves
    activityContext?: ActionResultActivityContext; // null to clear the activity context
    pendingChoice?: PendingChoice | undefined;

    // LLM token usage the agent consumed producing this result. Optional;
    // `undefined` => not reported. A reported value of all-zero => the agent
    // ran but made no LLM call. Accumulated by the dispatcher across all
    // actions in a request and surfaced as "Action Tokens" in the UI.
    tokenUsage?: ActionTokenUsage | undefined;
};

export type ActionResultSuccessNoDisplay = Omit<
    ActionResultSuccess,
    "displayContent"
> & {
    displayContent?: undefined;
};

export type ActionResult =
    | ActionResultSuccessNoDisplay
    | ActionResultSuccess
    | ActionResultError;

type EntityField<T> = T extends string
    ? Entity
    : T extends any[]
      ? (EntityField<Required<T[number]>> | undefined)[]
      : T extends object
        ? EntityMap<T>
        : undefined;

export type EntityMap<T> = {
    [Property in keyof T]?: EntityField<T[Property]>;
};

export type ActionEntities<T extends AppAction = AppAction> =
    T["parameters"] extends undefined
        ? undefined
        : EntityMap<Required<T["parameters"]>>;

export type TypeAgentAction<
    T extends AppAction = AppAction,
    Name extends string = string,
> = T extends AppAction
    ? T & {
          schemaName: Name;
          entities?: ActionEntities<T>;
      }
    : never;
