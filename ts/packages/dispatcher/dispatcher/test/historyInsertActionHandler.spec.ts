// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, it, jest } from "@jest/globals";
import { executeHistoryAction } from "../src/context/system/action/historyActionHandler.js";

it("inserts the complete saved-history JSON shape", async () => {
    const imported: unknown[] = [];
    const input = {
        user: "What changed?",
        assistant: {
            text: "The task completed.",
            source: "test",
            entities: [
                {
                    name: "result",
                    type: ["artifact"],
                    facets: [{ name: "details", value: { nested: true } }],
                },
            ],
            additionalInstructions: ["Keep this context."],
            activityContext: {
                activityName: "test",
                description: "Testing",
                state: { step: 2 },
                activityEndAction: { actionName: "finish" },
            },
            action: {
                schemaName: "test",
                actionName: "complete",
                parameters: { nested: { value: true } },
            },
        },
    };
    const context = {
        sessionContext: {
            agentContext: {
                chatHistory: {
                    count: () => imported.length,
                    import: (value: unknown) => imported.push(value),
                    getLastActivityContextInfo: () => undefined,
                },
            },
        },
        actionIO: {
            appendDisplay: jest.fn(),
            setDisplay: jest.fn(),
        },
    } as any;

    await executeHistoryAction(
        {
            schemaName: "system.history",
            actionName: "insertHistory",
            parameters: { messagesJson: JSON.stringify(input) },
        },
        context,
    );

    expect(imported).toEqual([input]);
});
