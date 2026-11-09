// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createExecutableAction,
    type HistoryContext,
} from "@typeagent/agent-cache";
import {
    createPendingRequestHistory,
    MAX_PENDING_REQUEST_CONTEXT_BYTES,
    type CompletedAction,
    type PendingRequestAction,
} from "../src/translation/pendingRequest.js";

const action: PendingRequestAction = {
    actionName: "pendingRequestAction",
    parameters: {
        pendingRequest: "Use both outputs",
        pendingResultEntityId: "output",
    },
};

function completed(result: CompletedAction["result"]): CompletedAction {
    return {
        executableAction: createExecutableAction(
            "fixture",
            "read",
            { path: "report.txt" },
            "output",
        ),
        result,
    };
}

function resultRecord(history: HistoryContext) {
    return JSON.parse(String(history.promptSections.at(-1)!.content)).result;
}

describe("bounded deferred translation context", () => {
    test("deduplicates identical outputs and excludes display alternates and execution metadata", () => {
        const result = {
            entities: [],
            historyText: "passport\ncharger\n",
            resultValue: "passport\ncharger\n",
            displayContent: {
                type: "text" as const,
                content: "passport\ncharger\n",
                alternates: [
                    { type: "html" as const, content: "x".repeat(100_000) },
                ],
            },
            dynamicDisplayId: "view",
            dynamicDisplayNextRefreshMs: 100,
        };
        expect(
            resultRecord(
                createPendingRequestHistory(action, [completed(result)]),
            ),
        ).toEqual({ resultValue: "passport\ncharger\n" });
        expect(result.displayContent.alternates[0].content).toHaveLength(
            100_000,
        );
    });

    test("keeps distinct display data rather than replacing it with a history summary", () => {
        const result = {
            entities: [],
            historyText: "Read report.txt",
            displayContent: {
                type: "text" as const,
                content: "passport\n\ncharger\n",
            },
        };
        expect(
            resultRecord(
                createPendingRequestHistory(action, [completed(result)]),
            ),
        ).toEqual({
            historyText: result.historyText,
            displayContent: result.displayContent,
        });
    });

    test.each(["", [], 0, false, null])(
        "preserves the concrete value %j",
        (value) => {
            expect(
                resultRecord(
                    createPendingRequestHistory(action, [
                        completed({ entities: [], resultValue: value }),
                    ]),
                ),
            ).toEqual({ resultValue: value });
        },
    );

    test("keeps structured blocks and distinct raw data without promoting display data to a result value", () => {
        const displayContent = {
            type: "structured" as const,
            blocks: [{ kind: "text" as const, text: "One item" }],
            rawData: ["rice"],
            alternates: [{ type: "text" as const, content: "One item" }],
        };
        const record = resultRecord(
            createPendingRequestHistory(action, [
                completed({ entities: [], displayContent }),
            ]),
        );
        expect(record).toEqual({
            displayContent: {
                type: "structured",
                blocks: displayContent.blocks,
                rawData: ["rice"],
            },
        });
        const withValue = resultRecord(
            createPendingRequestHistory(action, [
                completed({
                    entities: [],
                    displayContent,
                    resultValue: ["rice"],
                }),
            ]),
        );
        expect(withValue.resultValue).toEqual(["rice"]);
        expect(withValue.displayContent.rawData).toBeUndefined();
    });

    test("accepts exactly the byte limit and rejects one byte over without truncating", () => {
        const output = completed({ entities: [], historyText: "" });
        const history = createPendingRequestHistory(action, [output]);
        const overhead = Buffer.byteLength(
            JSON.stringify({
                pendingRequest: action.parameters.pendingRequest,
                history,
            }),
            "utf8",
        );
        const content = "a".repeat(
            MAX_PENDING_REQUEST_CONTEXT_BYTES - overhead,
        );
        output.result.historyText = content;
        expect(
            resultRecord(createPendingRequestHistory(action, [output]))
                .historyText,
        ).toBe(content);
        output.result.historyText += "a";
        expect(() => createPendingRequestHistory(action, [output])).toThrow(
            `(${MAX_PENDING_REQUEST_CONTEXT_BYTES + 1} bytes)`,
        );
        expect(output.result.historyText).toBe(content + "a");
    });

    test("counts UTF-8 bytes rather than characters", () => {
        const content = "\u00e9".repeat(MAX_PENDING_REQUEST_CONTEXT_BYTES / 2);
        expect(content.length).toBeLessThan(MAX_PENDING_REQUEST_CONTEXT_BYTES);
        expect(() =>
            createPendingRequestHistory(action, [
                completed({ entities: [], historyText: content }),
            ]),
        ).toThrow("byte limit");
    });

    test("bounds aggregate outputs rather than only the named dependency", () => {
        const first = completed({
            entities: [],
            historyText: "a".repeat(MAX_PENDING_REQUEST_CONTEXT_BYTES / 2),
        });
        const second = completed({
            entities: [],
            historyText: "b".repeat(MAX_PENDING_REQUEST_CONTEXT_BYTES / 2),
        });
        first.executableAction.resultEntityId = "first";
        expect(() =>
            createPendingRequestHistory(action, [first, second]),
        ).toThrow("byte limit");
    });

    test.each([
        "promptSections",
        "entities",
        "actions",
        "additionalInstructions",
        "activityContext",
    ] as const)("includes existing history %s in the budget", (field) => {
        const content = "x".repeat(MAX_PENDING_REQUEST_CONTEXT_BYTES);
        const history: HistoryContext = {
            promptSections: [],
            entities: [],
        };
        const values: HistoryContext = {
            promptSections: [{ role: "assistant", content }],
            entities: [
                {
                    name: content,
                    type: ["text"],
                    sourceAppAgentName: "fixture",
                },
            ],
            actions: [
                {
                    schemaName: "fixture",
                    actionName: "read",
                    parameters: { path: content },
                },
            ],
            additionalInstructions: [content],
            activityContext: {
                appAgentName: "fixture",
                activityName: "read",
                description: "Read reports",
                state: { content },
            },
        };
        Object.assign(history, { [field]: values[field] });
        expect(() =>
            createPendingRequestHistory(
                action,
                [completed({ entities: [] })],
                history,
            ),
        ).toThrow("byte limit");
    });

    test("includes the remaining request and completed action parameters in the budget", () => {
        const content = "x".repeat(MAX_PENDING_REQUEST_CONTEXT_BYTES);
        expect(() =>
            createPendingRequestHistory(
                {
                    ...action,
                    parameters: {
                        ...action.parameters,
                        pendingRequest: content,
                    },
                },
                [completed({ entities: [] })],
            ),
        ).toThrow("byte limit");
        const output = completed({ entities: [] });
        output.executableAction.action.parameters = { path: content };
        expect(() => createPendingRequestHistory(action, [output])).toThrow(
            "byte limit",
        );
    });
});
