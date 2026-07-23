// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression test: the dispatcher must forward a QuestionForm's `paged` flag
 * (along with fields/message) to ClientIO.requestForm. `paged` was added to the
 * type but initially dropped in emitActionResult's form forwarding, so a
 * `--paged` form still rendered all-at-once. The agent-side helper test can't
 * catch this - the flag is only lost on the wire hop - so assert it here at the
 * dispatcher -> ClientIO boundary with a capturing ClientIO.
 */

import {
    AppAgent,
    AppAgentManifest,
    QuestionForm,
    QuestionFormField,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createQuestionFormResult,
} from "@typeagent/agent-sdk/helpers/action";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { createDispatcher } from "../src/dispatcher.js";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-types";

const choiceManager = new ChoiceManager();

const config: AppAgentManifest = {
    emojiChar: "📝",
    description: "Question-form test agent",
};

const fields: QuestionFormField[] = [
    { id: "a", kind: "pick", prompt: "A?", choices: ["x", "y"] },
    { id: "b", kind: "yesNo", prompt: "B?" },
];

const handlers = {
    description: "Question-form test command table",
    commands: {
        paged: {
            description: "Return a paged form",
            run: async () =>
                createQuestionFormResult(
                    choiceManager,
                    "paged form",
                    fields,
                    async () => undefined,
                    { paged: true },
                ),
        },
        plain: {
            description: "Return an all-at-once form",
            run: async () =>
                createQuestionFormResult(
                    choiceManager,
                    "plain form",
                    fields,
                    async () => undefined,
                ),
        },
    },
} as const;

const agent: AppAgent = {
    ...getCommandInterface(handlers),
    handleChoice: async (choiceId, response, context) =>
        choiceManager.handleChoice(choiceId, response, context),
};

const agentProvider: AppAgentProvider = {
    getAppAgentNames: () => ["formtest"],
    getAppAgentManifest: async (name) => {
        if (name !== "formtest") throw new Error(`Unknown agent: ${name}`);
        return config;
    },
    loadAppAgent: async (name) => {
        if (name !== "formtest") throw new Error(`Unknown agent: ${name}`);
        return agent;
    },
    unloadAppAgent: async () => {},
};

function makeClientIO(captured: QuestionForm[]): ClientIO {
    return {
        clear: () => {},
        exit: () => process.exit(0),
        shutdown: () => process.exit(0),
        setUserRequest: () => {},
        setDisplayInfo: () => {},
        setDisplay: () => {},
        appendDisplay: () => {},
        appendDiagnosticData: () => {},
        setDynamicDisplay: () => {},
        question: async (_r, _m, _c, defaultId) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: () => {},
        openLocalView: async () => {},
        closeLocalView: async () => {},
        requestChoice: () => {},
        requestForm: (_requestId, _choiceId, form) => {
            captured.push(form);
        },
        requestInteraction: () => {},
        interactionResolved: () => {},
        interactionCancelled: () => {},
        takeAction: (_requestId, action) => {
            throw new Error(`Action ${action} not supported`);
        },
    };
}

describe("QuestionForm forwarding to requestForm", () => {
    let dispatcher: Dispatcher;
    const captured: QuestionForm[] = [];

    beforeAll(async () => {
        dispatcher = await createDispatcher("test-form-forward", {
            agents: { actions: false, schemas: false },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [agentProvider],
            collectCommandResult: true,
            clientIO: makeClientIO(captured),
        });
    });

    afterAll(async () => {
        if (dispatcher) {
            await dispatcher.close();
        }
    });

    beforeEach(() => {
        captured.length = 0;
    });

    it("forwards paged:true and the fields for a paged form", async () => {
        await awaitCommand(dispatcher, "@formtest paged");
        expect(captured).toHaveLength(1);
        expect(captured[0].paged).toBe(true);
        expect(captured[0].fields.map((f) => f.kind)).toEqual([
            "pick",
            "yesNo",
        ]);
        expect(captured[0].message).toBe("paged form");
    }, 10_000);

    it("omits paged for an all-at-once form", async () => {
        await awaitCommand(dispatcher, "@formtest plain");
        expect(captured).toHaveLength(1);
        expect(captured[0].paged).toBeFalsy();
    }, 10_000);
});
