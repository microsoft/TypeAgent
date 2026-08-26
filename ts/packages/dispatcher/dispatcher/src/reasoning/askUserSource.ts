// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Classification shared by both reasoning providers' `ask_user` tool.
// The model tags each ask as either an ordinary clarification question or a
// destructive/irreversible permission confirmation. The host uses the resolved
// source string to route permission asks into the same modal permission queue
// as Copilot SDK prompts, so a model-issued confirmation cannot appear inline
// behind a queued SDK popup.

// Ordinary reasoning ask: renders inline in the chat. This is also the
// backward-compatible default when the model does not classify the ask.
export const ASK_USER_SOURCE_REASONING = "reasoning";

// Destructive/irreversible confirmation: renders in the standalone permission
// queue alongside Copilot SDK prompts.
export const ASK_USER_SOURCE_REASONING_PERMISSION = "reasoningPermission";

// Values the model may send for the ask_user `kind` parameter. Kept as a
// closed set so the schema stays cheap for the model to reason about.
export const ASK_USER_KIND_VALUES = ["question", "permission"] as const;
export type AskUserKind = (typeof ASK_USER_KIND_VALUES)[number];

// Description surfaced to the model in both providers' tool schemas. Keep it
// self-contained: the model only sees this string, not the constants above.
export const ASK_USER_KIND_DESCRIPTION = [
    'Classification of this ask. Use "question" (the default) for an ordinary',
    "clarification the user answers casually - picking among options or",
    'resolving an ambiguity. Use "permission" only when this is a confirmation',
    "before a destructive or otherwise irreversible action, such as restarting",
    "a service, deleting data, overwriting files, or granting elevated access.",
    "Permission asks are shown as a modal prompt; ordinary questions appear",
    'inline in the chat. For a permission ask, use choices ["Allow", "Deny"].',
].join(" ");

// Map the model-supplied classification to the ClientIO `source` string.
// Anything other than the exact literal "permission" falls back to the
// ordinary reasoning source, so an absent, unknown, or malformed value keeps
// the existing inline behavior.
export function resolveAskUserSource(kind: unknown): string {
    return kind === "permission"
        ? ASK_USER_SOURCE_REASONING_PERMISSION
        : ASK_USER_SOURCE_REASONING;
}
