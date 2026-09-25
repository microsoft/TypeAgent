// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { ActionContext, AppAgentManifest } from "@typeagent/agent-sdk";
import { createExecutableAction } from "@typeagent/agent-cache";
import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    type CommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { translatePendingRequestAction } from "../src/translation/translateRequest.js";
import { nullClientIO } from "../src/context/interactiveIO.js";
import type { PendingRequestAction } from "../src/translation/pendingRequest.js";

const manifest: AppAgentManifest = {
    description: "Offline schema scope fixture",
    emojiChar: "",
    schema: {
        description: "Scoped action",
        schemaType: "Action",
        schemaFile: {
            format: "ts",
            content: 'export type Action = { actionName: "read" };',
        },
    },
};
const pending: PendingRequestAction = {
    actionName: "pendingRequestAction",
    parameters: {
        pendingRequest: "Use the prior output",
        pendingResultEntityId: "source",
    },
};

describe("deferred request schema scope", () => {
    let system: CommandHandlerContext;
    let context: ActionContext<CommandHandlerContext>;
    const reachedTranslator = jest.fn();

    beforeEach(async () => {
        reachedTranslator.mockReset();
        system = await initializeCommandHandlerContext("pending-scope-test", {
            agents: {
                schemas: ["allowed", "other"],
                actions: ["allowed", "other"],
            },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [
                {
                    getAppAgentNames: () => ["allowed", "other"],
                    getAppAgentManifest: async () => manifest,
                    loadAppAgent: async () => ({}),
                    unloadAppAgent: async () => {},
                },
            ],
            clientIO: nullClientIO,
        });
        system.currentRequestId = { requestId: "scope-request" };
        const translation = system.session.getConfig().translation;
        translation.enabled = true;
        translation.switch.fixed = "other";
        translation.switch.embedding = false;
        translation.schema.optimize.enabled = false;
        jest.spyOn(system.translatorCache, "get").mockImplementation(
            (schema) => {
                reachedTranslator(schema);
                throw new Error("Offline translator boundary");
            },
        );
        context = {
            sessionContext: {
                ...system.agents.getSessionContext("dispatcher"),
                agentContext: system,
            },
            streamingContext: undefined,
            activityContext: undefined,
            isFromReasoningLoop: false,
            queueToggleTransientAgent: async () => {},
            actionIO: {
                setDisplay: () => {},
                appendDisplay: () => {},
                appendDiagnosticData: () => {},
                takeAction: () => {},
            },
        };
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await closeCommandHandlerContext(system);
    });

    function translate() {
        return translatePendingRequestAction(pending, context, [
            {
                executableAction: createExecutableAction(
                    "allowed",
                    "read",
                    undefined,
                    "source",
                ),
                result: { entities: [], historyText: "Completed read" },
            },
        ]);
    }

    test.each([
        { activeSchemas: ["allowed"] },
        { activeSchemaFamilies: ["allowed"] },
    ])("does not select an out-of-scope fixed schema for %j", async (scope) => {
        system.currentOptions = scope;
        await expect(translate()).rejects.toThrow(
            "Fixed initial schema not active",
        );
        expect(reachedTranslator).not.toHaveBeenCalled();
    });

    test.each([
        { activeSchemas: ["missing"] },
        { activeSchemaFamilies: ["missing"] },
        { activeSchemas: [] },
    ])(
        "stops unavailable or empty scope %j before translation",
        async (scope) => {
            system.currentOptions = scope;
            await expect(translate()).rejects.toThrow(
                "No active schema scope for deferred request",
            );
            expect(reachedTranslator).not.toHaveBeenCalled();
        },
    );

    test("still selects an allowed schema", async () => {
        system.currentOptions = { activeSchemaFamilies: ["allowed"] };
        system.session.getConfig().translation.switch.fixed = "allowed";
        await expect(translate()).rejects.toThrow(
            "Offline translator boundary",
        );
        expect(reachedTranslator).toHaveBeenCalledWith("allowed");
    });

    test("preserves unrestricted requests", async () => {
        await expect(translate()).rejects.toThrow(
            "Offline translator boundary",
        );
        expect(reachedTranslator).toHaveBeenCalledWith("other");
    });
});
