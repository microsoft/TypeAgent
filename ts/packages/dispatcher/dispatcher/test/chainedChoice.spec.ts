// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Regression test for chained (nested) choice cards.
 *
 * When a choice callback returns a new ActionResult that itself carries a
 * `pendingChoice` (e.g. the desktop agent's "confirm the fuzzy service match"
 * yes/no, whose Yes leads to a "run elevated?" yes/no), the follow-up card must
 * actually render. Before the fix, `respondToChoice` only forwarded a callback
 * result's error/displayContent and dropped the chained `pendingChoice`, so the
 * second card's message appeared but its yes/no buttons never did.
 *
 * Strategy: a test agent exposes a command that returns a yes/no choice whose
 * callback returns a second yes/no choice. A capturing ClientIO records every
 * `requestChoice` call. After answering the first choice, a second choice card
 * must have been requested.
 */

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { createDispatcher } from "../src/dispatcher.js";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type { ClientIO, Dispatcher } from "@typeagent/dispatcher-types";

const choiceManager = new ChoiceManager();

const config: AppAgentManifest = {
    emojiChar: "🔗",
    description: "Chained-choice test agent",
};

const handlers = {
    description: "Chained choice command table",
    commands: {
        chain: {
            description:
                "Returns a yes/no choice whose Yes leads to a second yes/no choice",
            run: async () =>
                createYesNoChoiceResult(choiceManager, "first?", async () =>
                    createYesNoChoiceResult(
                        choiceManager,
                        "second?",
                        async () => createActionResultFromTextDisplay("done"),
                    ),
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
    getAppAgentNames: () => ["choicechain"],
    getAppAgentManifest: async (name) => {
        if (name !== "choicechain") throw new Error(`Unknown agent: ${name}`);
        return config;
    },
    loadAppAgent: async (name) => {
        if (name !== "choicechain") throw new Error(`Unknown agent: ${name}`);
        return agent;
    },
    unloadAppAgent: async () => {},
};

type CapturedChoice = { choiceId: string; message: string };

function makeClientIO(captured: CapturedChoice[]): ClientIO {
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
        requestChoice: (_requestId, choiceId, _type, message) => {
            captured.push({ choiceId, message });
        },
        requestForm: () => {},
        requestInteraction: () => {},
        interactionResolved: () => {},
        interactionCancelled: () => {},
        takeAction: (_requestId, action) => {
            throw new Error(`Action ${action} not supported`);
        },
    };
}

describe("Chained choice cards", () => {
    let dispatcher: Dispatcher;
    const captured: CapturedChoice[] = [];

    beforeAll(async () => {
        dispatcher = await createDispatcher("test-chained-choice", {
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

    it("renders a second choice card when a choice callback returns a new pendingChoice", async () => {
        await awaitCommand(dispatcher, "@choicechain chain");

        // The command presents the first yes/no card.
        expect(captured).toHaveLength(1);
        expect(captured[0].message).toBe("first?");

        // Simulate the user clicking "Yes" on the first card. Its callback
        // returns a second yes/no choice, whose card must now be requested.
        await dispatcher.respondToChoice(captured[0].choiceId, true);

        expect(captured).toHaveLength(2);
        expect(captured[1].message).toBe("second?");
        expect(captured[1].choiceId).not.toBe(captured[0].choiceId);
    }, 10_000);
});
