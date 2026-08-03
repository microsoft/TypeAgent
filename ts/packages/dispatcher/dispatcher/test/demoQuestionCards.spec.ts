// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit test for the `@demo questionCards` command.
 *
 * The command returns a QuestionForm covering the question kinds - all at once
 * by default, or as a paged Back/Next wizard with `--paged`. On submit its
 * callback (invoked via the shared ChoiceManager, exactly as the system
 * AppAgent's handleChoice does) REPLACES the prompt with a summary via
 * actionIO.setDisplay and returns undefined.
 */

import type {
    ActionResultSuccess,
    PendingChoice,
    QuestionFormResponse,
} from "@typeagent/agent-sdk";
import type { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import { getDemoCommandHandlers } from "../src/context/system/handlers/demoCommandHandlers.js";

function questionCards(): CommandHandler {
    return getDemoCommandHandlers().commands.questionCards as CommandHandler;
}

function pendingChoiceOf(result: unknown): PendingChoice {
    const pc = (result as ActionResultSuccess).pendingChoice;
    if (pc === undefined) {
        throw new Error("expected a pendingChoice on the result");
    }
    return pc;
}

type Captured = { display?: unknown };

function makeContext(cm: ChoiceManager, captured: Captured = {}): any {
    return {
        sessionContext: { agentContext: { choiceManager: cm } },
        actionIO: {
            setDisplay: (content: unknown) => {
                captured.display = content;
            },
            appendDisplay: () => {},
        },
    };
}

function runCards(cm: ChoiceManager, paged: boolean, ctx = makeContext(cm)) {
    return questionCards().run(ctx, { flags: { paged } } as any);
}

describe("@demo questionCards", () => {
    it("renders an all-at-once form by default, covering the question kinds", async () => {
        const pc = pendingChoiceOf(await runCards(new ChoiceManager(), false));
        expect(pc.type).toBe("form");
        if (pc.type === "form") {
            expect(pc.paged).toBeFalsy();
            expect(pc.fields.map((f) => f.kind)).toEqual([
                "yesNo",
                "pick",
                "multiChoice",
                "pick",
                "yesNo",
            ]);
        }
    });

    it("renders a paged wizard with --paged", async () => {
        const pc = pendingChoiceOf(await runCards(new ChoiceManager(), true));
        expect(pc.type).toBe("form");
        if (pc.type === "form") {
            expect(pc.paged).toBe(true);
        }
    });

    it("replaces the prompt with a summary on submit", async () => {
        const cm = new ChoiceManager();
        const captured: Captured = {};
        const ctx = makeContext(cm, captured);
        const pc = pendingChoiceOf(await runCards(cm, true, ctx));

        const response: QuestionFormResponse = {
            answers: {
                likes: { kind: "yesNo", value: true },
                theme: { kind: "pick", selected: 1 }, // Dark
                interests: {
                    kind: "multiChoice",
                    selected: [0],
                    text: "Docs",
                },
                color: { kind: "pick", selected: -1, text: "Teal" },
                subscribe: { kind: "yesNo", value: false },
            },
        };
        const done = await cm.handleChoice(pc.choiceId, response, ctx);

        // Nothing appended - the summary is delivered via setDisplay (replace).
        expect(done).toBeUndefined();

        // Rendered as structured output: a heading + a Question/Answer table.
        const display = captured.display as any;
        expect(display.type).toBe("structured");
        const table = display.blocks.find((b: any) => b.kind === "table");
        expect(table).toBeDefined();
        expect(table.columns.map((c: any) => c.header)).toEqual([
            "Question",
            "Answer",
        ]);

        const content = JSON.stringify(display);
        expect(content).toContain("demo complete");
        expect(content).toContain("Dark"); // pick by index
        expect(content).toContain("Docs (typed)"); // multi-select free text
        expect(content).toContain("Teal (typed)"); // single-select free text
    });

    it("reports cancellation", async () => {
        const cm = new ChoiceManager();
        const captured: Captured = {};
        const ctx = makeContext(cm, captured);
        const pc = pendingChoiceOf(await runCards(cm, false, ctx));
        await cm.handleChoice(
            pc.choiceId,
            { answers: {}, cancelled: true },
            ctx,
        );
        expect(JSON.stringify(captured.display)).toContain("cancelled");
    });
});
