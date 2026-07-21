// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    DisplayContent,
    ParsedCommandParams,
    QuestionFormField,
    QuestionFormResponse,
    TableCell,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { createQuestionFormResult } from "@typeagent/agent-sdk/helpers/action";
import {
    createStructuredContent,
    createTable,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";

// The demo walks the question kinds as a paged wizard (one question at a time,
// Back/Next), showcasing single-select radios, multi-select checkboxes, yes/no,
// and the free-text "Other" escape. All answers arrive together on Finish.
const demoFields: QuestionFormField[] = [
    {
        id: "likes",
        kind: "yesNo",
        prompt: "Do you like TypeAgent?",
        defaultValue: true,
    },
    {
        id: "theme",
        kind: "pick",
        prompt: "Choose a theme.",
        choices: ["Light", "Dark", "System"],
        defaultId: 2,
    },
    {
        id: "interests",
        kind: "multiChoice",
        prompt: "Which areas interest you? (pick any)",
        choices: ["Agents", "Memory", "Grammar", "Shell UI"],
        allowFreeText: true,
        freeTextPlaceholder: "something else...",
    },
    {
        id: "color",
        kind: "pick",
        prompt: "Pick a favorite color - or type your own.",
        choices: ["Red", "Green", "Blue"],
        allowFreeText: true,
        freeTextPlaceholder: "your own color...",
    },
    {
        id: "subscribe",
        kind: "yesNo",
        prompt: "Subscribe to the newsletter?",
        defaultValue: false,
    },
];

// The answer to one field, as plain display text (no markdown decoration - it
// becomes a table cell in the structured summary below).
function answerText(
    field: QuestionFormField,
    response: QuestionFormResponse,
): string {
    const answer = response.answers[field.id];
    if (answer === undefined) {
        return "-";
    }
    if (answer.kind === "yesNo") {
        return answer.value ? "Yes" : "No";
    }
    if (answer.kind === "pick") {
        if (answer.text !== undefined && answer.text.length > 0) {
            return `${answer.text} (typed)`;
        }
        return "choices" in field && answer.selected >= 0
            ? field.choices[answer.selected]
            : "(none)";
    }
    // multiChoice
    const picked =
        "choices" in field ? answer.selected.map((i) => field.choices[i]) : [];
    if (answer.text !== undefined && answer.text.length > 0) {
        picked.push(`${answer.text} (typed)`);
    }
    return picked.length ? picked.join(", ") : "(none)";
}

// Build the completion summary as STRUCTURED output: a heading + a
// Question/Answer table, with the raw answers stashed as `rawData`. Rendered
// via setDisplay so it REPLACES the form's prompt instead of stacking beneath
// it. createStructuredContent auto-derives markdown/text alternates, so hosts
// that don't render structured content (e.g. the CLI) still get a readable
// table.
function summaryContent(response: QuestionFormResponse): DisplayContent {
    if (response.cancelled) {
        return { type: "markdown", content: "Demo cancelled." };
    }
    const rows: TableCell[][] = demoFields.map((field) => [
        field.prompt,
        answerText(field, response),
    ]);
    return createStructuredContent(
        [
            {
                kind: "heading",
                text: "Question types demo complete",
                level: 3,
            },
            createTable(
                [
                    { id: "question", header: "Question" },
                    { id: "answer", header: "Answer" },
                ],
                rows,
                { readonly: true },
            ),
        ],
        { rawData: response.answers },
    );
}

export class QuestionCardsCommandHandler implements CommandHandler {
    public readonly description =
        "Walk the interactive question types (single-select, multi-select, yes/no, free-text). Add --paged for a one-at-a-time Back/Next wizard.";
    public readonly parameters = {
        flags: {
            paged: {
                char: "p",
                description:
                    "Render one question at a time with Back / Next navigation",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<ActionResult | undefined> {
        const message = params.flags.paged
            ? "Question types demo - answer each step, then Finish."
            : "Question types demo - answer the questions, then Submit.";
        // The shared per-context ChoiceManager registers the callback; the
        // system AppAgent's handleChoice routes the response back to it (see
        // systemAgent.ts). When paged, the Back/Next navigation is entirely
        // client-side, so there is one round-trip: the answers arrive on Finish.
        return createQuestionFormResult(
            context.sessionContext.agentContext.choiceManager,
            message,
            demoFields,
            async (response, actionContext) => {
                // Replace the form's prompt with the summary (setDisplay) so
                // the finished card reads as just the result, instead of the
                // stale "answer each step..." instruction stacked above it.
                actionContext.actionIO.setDisplay(summaryContent(response));
                return undefined;
            },
            { paged: params.flags.paged },
        );
    }
}

export function getDemoCommandHandlers(): CommandHandlerTable {
    return {
        description: "Interactive TypeAgent demos",
        commands: {
            questionCards: new QuestionCardsCommandHandler(),
        },
    };
}
