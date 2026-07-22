// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    QuestionForm,
    QuestionFormField,
    QuestionFormFieldAnswer,
    QuestionFormMultiChoiceField,
    QuestionFormPickField,
    QuestionFormResponse,
} from "@typeagent/agent-sdk";
import type { ClientIO, RequestId } from "@typeagent/dispatcher-types";

// Shared implementation of the reasoning `ask_user_form` tool, used by both the
// Claude and Copilot reasoning providers. It turns the LLM-authored form spec
// into a QuestionForm, presents it through the blocking `askForm` interaction
// (falling back to sequential `question` prompts when the host lacks form
// support), and formats the answers back into text for the model.

// The loose shape the LLM passes to `ask_user_form`. Kept permissive so both
// the zod (Claude) and JSON-schema (Copilot) providers can forward args as-is;
// buildReasoningForm validates it.
export type ReasoningFormArgs = {
    message?: unknown;
    questions?: unknown;
    paged?: unknown;
};

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

// Validate and normalize the LLM args into a QuestionForm, or return an error
// string describing what the model got wrong so it can correct and retry.
export function buildReasoningForm(
    args: ReasoningFormArgs,
): { form: QuestionForm } | { error: string } {
    const questions = args.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
        return {
            error: "ask_user_form requires a non-empty `questions` array.",
        };
    }

    const fields: QuestionFormField[] = [];
    const seenIds = new Set<string>();
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i] as Record<string, unknown>;
        const id = asString(q?.id).length > 0 ? asString(q.id) : `q${i + 1}`;
        if (seenIds.has(id)) {
            return { error: `Duplicate question id "${id}".` };
        }
        seenIds.add(id);

        const prompt = asString(q?.prompt);
        if (prompt.length === 0) {
            return { error: `Question "${id}" is missing a prompt.` };
        }

        const kind = q?.kind;
        if (kind === "yesNo") {
            fields.push({ id, kind: "yesNo", prompt });
            continue;
        }
        if (kind === "pick" || kind === "multiChoice") {
            const choices = Array.isArray(q?.choices)
                ? q.choices.map((c) => asString(c)).filter((c) => c.length > 0)
                : [];
            if (choices.length < 2) {
                return {
                    error: `Question "${id}" (${kind}) needs at least 2 non-empty choices.`,
                };
            }
            const allowFreeText = q?.allowFreeText === true;
            if (kind === "pick") {
                const field: QuestionFormPickField = {
                    id,
                    kind: "pick",
                    prompt,
                    choices,
                };
                if (allowFreeText) {
                    field.allowFreeText = true;
                }
                fields.push(field);
            } else {
                const field: QuestionFormMultiChoiceField = {
                    id,
                    kind: "multiChoice",
                    prompt,
                    choices,
                };
                if (allowFreeText) {
                    field.allowFreeText = true;
                }
                fields.push(field);
            }
            continue;
        }
        return {
            error: `Question "${id}" has unknown kind "${String(
                kind,
            )}". Use "pick", "multiChoice", or "yesNo".`,
        };
    }

    const form: QuestionForm = { fields };
    const message = asString(args.message);
    if (message.length > 0) {
        form.message = message;
    }
    // Multi-question forms always render as a paged wizard (one question at a
    // time with Back/Next) rather than a long all-at-once card. A single
    // question stays inline - paging one question adds nothing.
    if (fields.length > 1 || args.paged === true) {
        form.paged = true;
    }
    return { form };
}

// Present the form and block for the answer. Uses the blocking `askForm`
// interaction when the host supports it (the async-interaction path does not
// take the command lock, so this is safe while reasoning holds it). Hosts
// without form support degrade to one single-select `question` per field - no
// multi-select or free-text in that path.
export async function presentReasoningForm(
    clientIO: ClientIO,
    requestId: RequestId | undefined,
    form: QuestionForm,
): Promise<QuestionFormResponse> {
    if (clientIO.askForm) {
        return clientIO.askForm(requestId, form, "reasoning");
    }

    const answers: Record<string, QuestionFormFieldAnswer> = {};
    for (const field of form.fields) {
        if (field.kind === "yesNo") {
            const selected = await clientIO.question(
                requestId,
                field.prompt,
                ["Yes", "No"],
                undefined,
                "reasoning",
            );
            answers[field.id] = { kind: "yesNo", value: selected === 0 };
        } else {
            const selected = await clientIO.question(
                requestId,
                field.prompt,
                field.choices,
                undefined,
                "reasoning",
            );
            if (field.kind === "multiChoice") {
                answers[field.id] = {
                    kind: "multiChoice",
                    selected: selected >= 0 ? [selected] : [],
                };
            } else {
                answers[field.id] = { kind: "pick", selected };
            }
        }
    }
    return { answers };
}

function describeAnswer(
    field: QuestionFormField,
    answer: QuestionFormFieldAnswer | undefined,
): string {
    if (answer === undefined) {
        return "(no answer)";
    }
    switch (field.kind) {
        case "yesNo":
            return answer.kind === "yesNo"
                ? answer.value
                    ? "Yes"
                    : "No"
                : "(invalid)";
        case "pick": {
            if (answer.kind !== "pick") {
                return "(invalid)";
            }
            if (answer.selected === -1) {
                return answer.text !== undefined
                    ? `"${answer.text}" (free text)`
                    : "(none)";
            }
            return (
                field.choices[answer.selected] ?? `choice ${answer.selected}`
            );
        }
        case "multiChoice": {
            if (answer.kind !== "multiChoice") {
                return "(invalid)";
            }
            const picks = answer.selected.map(
                (i) => field.choices[i] ?? `choice ${i}`,
            );
            if (answer.text !== undefined) {
                picks.push(`"${answer.text}" (free text)`);
            }
            return picks.length > 0 ? picks.join(", ") : "(none)";
        }
    }
}

// Format the response as text for the LLM: one line per question with the
// user's answer, or a note that the user dismissed the form.
export function formatReasoningFormResponse(
    form: QuestionForm,
    response: QuestionFormResponse,
): string {
    if (response.cancelled) {
        return "The user dismissed the form without answering.";
    }
    const lines = form.fields.map(
        (field) =>
            `- ${field.prompt} => ${describeAnswer(
                field,
                response.answers[field.id],
            )}`,
    );
    return `The user submitted the form:\n${lines.join("\n")}`;
}
