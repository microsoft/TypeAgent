// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentManifest,
} from "@typeagent/agent-sdk";
import { createExecutableAction, RequestAction } from "@typeagent/agent-cache";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";
import type { AppAgentProvider } from "../src/agentProvider/agentProvider.js";

const translatePending =
    jest.fn<
        typeof import("../src/translation/translateRequest.js").translatePendingRequestAction
    >();
jest.unstable_mockModule("../src/translation/translateRequest.js", () => ({
    isSwitchEnabled: () => false,
    translatePendingRequestAction: translatePending,
    translateRequest: jest.fn(),
    getTranslatorForSchema: jest.fn(),
}));
const { nullClientIO } = await import("../src/context/interactiveIO.js");
const { createPendingRequestAction, createPendingRequestHistory } =
    await import("../src/translation/pendingRequest.js");
const { initializeCommandHandlerContext, closeCommandHandlerContext } =
    await import("../src/context/commandHandlerContext.js");
const { executeActions } = await import("../src/execute/actionHandlers.js");
const { toPendingActions } = await import("../src/execute/pendingActions.js");

const manifest: AppAgentManifest = {
    description: "Offline result handoff fixture",
    emojiChar: "",
    schema: {
        description: "Result producers and consumers",
        schemaType: "Actions",
        schemaFile: {
            format: "ts",
            content: `
                export type Actions = Produce | Consume | ConsumeItems;
                type Produce = { actionName: "produce"; parameters: { key: string } };
                type Consume = { actionName: "consume"; parameters: { value: string } };
                type ConsumeItems = { actionName: "consumeItems"; parameters: { items: string[] } };
            `,
        },
    },
};

describe("action result handoff", () => {
    let system: CommandHandlerContext;
    let context: ActionContext<CommandHandlerContext>;
    let results: Map<string, ActionResult>;
    let executed: string[];
    const consume = jest.fn<NonNullable<AppAgent["executeAction"]>>();
    const produce = (key: string, id = key) =>
        createExecutableAction("handoff", "produce", { key }, id);

    beforeEach(async () => {
        results = new Map();
        executed = [];
        consume.mockReset();
        consume.mockResolvedValue({ entities: [] });
        translatePending.mockReset();
        const agent: AppAgent = {
            executeAction: async (action, actionContext) => {
                executed.push(action.actionName);
                if (action.actionName !== "produce") {
                    return consume(action, actionContext);
                }
                const result = results.get(String(action.parameters?.key));
                if (result === undefined) throw new Error("Missing fixture");
                return result;
            },
        };
        const provider: AppAgentProvider = {
            getAppAgentNames: () => ["handoff"],
            getAppAgentManifest: async () => manifest,
            loadAppAgent: async () => agent,
            unloadAppAgent: async () => {},
        };
        system = await initializeCommandHandlerContext("result-handoff-test", {
            agents: { schemas: ["handoff"], actions: ["handoff"] },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [provider],
            conversationMemorySettings: {
                requestKnowledgeExtraction: false,
                actionResultEntityStorage: false,
                actionResultKnowledgeExtraction: false,
            },
            clientIO: nullClientIO,
        });
        system.currentRequestId = { requestId: "handoff-request" };
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
        await closeCommandHandlerContext(system);
    });

    test("an unused result label does not stop an already completed mutation", async () => {
        results.set("clear", {
            entities: [],
            historyText: "Cleared list: grocery",
        });
        await expect(
            executeActions(
                [
                    produce("clear"),
                    createExecutableAction("handoff", "consume", {
                        value: "bread",
                    }),
                ],
                undefined,
                context,
            ),
        ).resolves.toBeUndefined();
        expect(executed).toEqual(["produce", "consume"]);
    });

    test.each(["", "  passport\n\ncharger\n", "${result-another}"])(
        "passes the exact concrete text value %j, not display text or entity name",
        async (value) => {
            results.set("file", {
                entities: [],
                resultEntity: { name: "report.txt", type: ["file"] },
                resultValue: value,
                displayContent: "A formatted preview",
            });
            await executeActions(
                [
                    produce("file"),
                    createExecutableAction("handoff", "consume", {
                        value: { $result: "file" },
                    }),
                ],
                undefined,
                context,
            );
            expect(consume.mock.calls[0]?.[0].parameters).toEqual({ value });
        },
    );

    test.each([{ items: [] }, { items: ["rice", "milk"] }])(
        "passes array result $items without an entity",
        async ({ items }) => {
            results.set("items", { entities: [], resultValue: items });
            await executeActions(
                [
                    produce("items"),
                    createExecutableAction("handoff", "consumeItems", {
                        items: { $result: "items" },
                    }),
                ],
                undefined,
                context,
            );
            expect(consume.mock.calls[0]?.[0].parameters).toEqual({ items });
        },
    );

    test("keeps legacy entity-name references separate from concrete values", async () => {
        results.set("list", {
            entities: [],
            resultEntity: { name: "grocery", type: ["list"] },
            resultValue: ["rice"],
        });
        await executeActions(
            [
                produce("list"),
                createExecutableAction("handoff", "consume", {
                    value: "${result-list}",
                }),
            ],
            undefined,
            context,
        );
        expect(consume.mock.calls[0]?.[0].parameters).toEqual({
            value: "grocery",
        });
    });

    test("retains deferred requests after both prerequisite reads", async () => {
        const pending = createPendingRequestAction({
            request: "Compare the nonempty lines of both reports",
            pendingResultEntityId: "b",
        });
        const actions = [produce("a"), produce("b"), pending];
        const queue = await toPendingActions(context, actions, undefined);
        expect(queue.map((entry) => entry.executableAction)).toEqual(actions);
    });

    test("executes a deferred continuation exactly once after display-only results", async () => {
        results.set("a", {
            entities: [],
            historyText: "passport\ncharger\nsocks\n",
        });
        results.set("b", { entities: [], historyText: "charger\nadapter\n" });
        translatePending.mockImplementation(
            async (action, _context, completed) => {
                expect(executed).toEqual(["produce", "produce"]);
                const history = createPendingRequestHistory(action, completed);
                expect(history.actions).toEqual([
                    produce("a").action,
                    produce("b").action,
                ]);
                const records = history.promptSections
                    .slice(1)
                    .map((section) => JSON.parse(String(section.content)));
                expect(
                    records.map((record) => record.result.historyText),
                ).toEqual(["passport\ncharger\nsocks\n", "charger\nadapter\n"]);
                return {
                    type: "translate",
                    requestAction: RequestAction.create(
                        "comparison",
                        createExecutableAction("handoff", "consume", {
                            value: "3 versus 2; difference 1",
                        }),
                    ),
                    elapsedMs: 0,
                    config: system.session.getConfig().translation,
                };
            },
        );
        await executeActions(
            [
                produce("a"),
                produce("b"),
                createPendingRequestAction({
                    request: "Compare both reports",
                    pendingResultEntityId: "b",
                }),
            ],
            undefined,
            context,
        );
        expect(translatePending).toHaveBeenCalledTimes(1);
        expect(executed).toEqual(["produce", "produce", "consume"]);
    });

    test.each([
        {
            result: { entities: [], displayContent: "not a concrete value" },
            error: "Result value reference not found",
        },
        {
            result: { entities: [], resultValue: ["not", "text"] },
            error: "is not a string",
        },
        {
            result: { entities: [], resultValue: { $result: "another" } },
            error: "is not a string",
        },
        {
            result: { entities: [], resultValue: 0 },
            error: "is not a string",
        },
    ])(
        "rejects a missing or invalid concrete result before invoking its consumer",
        async ({ result, error }) => {
            results.set("bad", result);
            await expect(
                executeActions(
                    [
                        produce("bad"),
                        createExecutableAction("handoff", "consume", {
                            value: { $result: "bad" },
                        }),
                    ],
                    undefined,
                    context,
                ),
            ).rejects.toThrow(error);
            expect(consume).not.toHaveBeenCalled();
            expect(executed).toEqual(["produce"]);
        },
    );

    test("rejects nested placeholders in a concrete array result", async () => {
        results.set("items", {
            entities: [],
            resultValue: [{ $result: "other" }],
        });
        await expect(
            executeActions(
                [
                    produce("items"),
                    createExecutableAction("handoff", "consumeItems", {
                        items: { $result: "items" },
                    }),
                ],
                undefined,
                context,
            ),
        ).rejects.toThrow("is not a string");
        expect(consume).not.toHaveBeenCalled();
    });

    test("rejects an undeclared result reference before any action executes", async () => {
        await expect(
            executeActions(
                [
                    createExecutableAction("handoff", "consume", {
                        value: { $result: "unknown" },
                    }),
                ],
                undefined,
                context,
            ),
        ).rejects.toThrow(
            "Result value reference not found: ${result-unknown}",
        );
        expect(executed).toEqual([]);
    });

    test("rejects duplicate result labels before executing either producer", async () => {
        await expect(
            executeActions(
                [produce("first", "same"), produce("second", "same")],
                undefined,
                context,
            ),
        ).rejects.toThrow("Duplicate result entity reference: ${result-same}");
        expect(executed).toEqual([]);
    });

    test("does not publish a result value while its producer awaits confirmation", async () => {
        results.set("choice", {
            entities: [],
            resultValue: "not committed",
            pendingChoice: {
                choiceId: "choice",
                type: "yesNo",
                message: "Approve?",
            },
        });
        const display = jest.spyOn(context.actionIO, "appendDisplay");
        await expect(
            executeActions(
                [
                    produce("choice"),
                    createExecutableAction("handoff", "consume", {
                        value: { $result: "choice" },
                    }),
                ],
                undefined,
                context,
            ),
        ).resolves.toMatchObject({
            error: expect.stringContaining(
                "Remaining steps were not executed and will not resume automatically.",
            ),
            failedAction: produce("choice"),
            fallbackToReasoning: false,
        });
        expect(display).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "error",
                content: expect.stringContaining(
                    "will not resume automatically",
                ),
            }),
            "block",
        );
        expect(executed).toEqual(["produce"]);
        expect(consume).not.toHaveBeenCalled();
        expect(system.pendingChoiceRoutes.has("choice")).toBe(true);
    });

    test.each([true, false])(
        "stops an independent mutation after a pending choice (result label: %s)",
        async (labeled) => {
            results.set("before", {
                entities: [],
                historyText: "Already completed",
            });
            results.set("choice", {
                entities: [],
                pendingChoice: {
                    choiceId: "choice",
                    type: "yesNo",
                    message: "Approve?",
                },
            });
            const choice = createExecutableAction(
                "handoff",
                "produce",
                { key: "choice" },
                labeled ? "choice" : undefined,
            );
            await expect(
                executeActions(
                    [
                        produce("before"),
                        choice,
                        createExecutableAction("handoff", "consume", {
                            value: "bread",
                        }),
                    ],
                    undefined,
                    context,
                ),
            ).resolves.toMatchObject({
                error: expect.stringContaining("awaiting a user choice"),
                failedAction: choice,
                fallbackToReasoning: false,
            });
            expect(executed).toEqual(["produce", "produce"]);
            expect(consume).not.toHaveBeenCalled();
            expect(translatePending).not.toHaveBeenCalled();
            expect(system.pendingChoiceRoutes.has("choice")).toBe(true);
        },
    );

    test("stops a deferred request while retaining the producer's choice", async () => {
        results.set("choice", {
            entities: [],
            pendingChoice: {
                choiceId: "choice",
                type: "yesNo",
                message: "Approve?",
            },
        });
        await expect(
            executeActions(
                [
                    produce("choice"),
                    createPendingRequestAction({
                        request: "Use the approved result",
                        pendingResultEntityId: "choice",
                    }),
                ],
                undefined,
                context,
            ),
        ).resolves.toMatchObject({
            error: expect.stringContaining("will not resume automatically"),
            fallbackToReasoning: false,
        });
        expect(executed).toEqual(["produce"]);
        expect(translatePending).not.toHaveBeenCalled();
        expect(system.pendingChoiceRoutes.has("choice")).toBe(true);
    });

    test("does not schedule additional actions from a pending choice", async () => {
        results.set("choice", {
            entities: [],
            pendingChoice: {
                choiceId: "choice",
                type: "yesNo",
                message: "Approve?",
            },
            additionalActions: [
                {
                    schemaName: "handoff",
                    actionName: "consume",
                    parameters: { value: "bread" },
                },
            ],
        });
        await expect(
            executeActions([produce("choice")], undefined, context),
        ).resolves.toMatchObject({
            error: expect.stringContaining("will not resume automatically"),
            fallbackToReasoning: false,
        });
        expect(executed).toEqual(["produce"]);
        expect(consume).not.toHaveBeenCalled();
        expect(system.pendingChoiceRoutes.has("choice")).toBe(true);
    });

    test("preserves a standalone pending choice without reporting discarded steps", async () => {
        results.set("choice", {
            entities: [],
            pendingChoice: {
                choiceId: "choice",
                type: "yesNo",
                message: "Approve?",
            },
        });
        const display = jest.spyOn(context.actionIO, "appendDisplay");
        await expect(
            executeActions([produce("choice")], undefined, context),
        ).resolves.toBeUndefined();
        expect(display).not.toHaveBeenCalledWith(
            expect.objectContaining({ kind: "error" }),
            "block",
        );
        expect(executed).toEqual(["produce"]);
        expect(system.pendingChoiceRoutes.has("choice")).toBe(true);
    });

    test("does not invent an entity name from a successful display-only mutation", async () => {
        results.set("clear", {
            entities: [],
            historyText: "Cleared list: grocery",
        });
        await expect(
            executeActions(
                [
                    produce("clear"),
                    createExecutableAction("handoff", "consume", {
                        value: "${result-clear}",
                    }),
                ],
                undefined,
                context,
            ),
        ).rejects.toThrow("Result entity reference not found: ${result-clear}");
        expect(executed).toEqual(["produce"]);
        expect(consume).not.toHaveBeenCalled();
    });

    test("chains three actions and isolates a concrete array from consumer mutation", async () => {
        const original = ["rice"];
        results.set("source", { entities: [], resultValue: original });
        consume.mockImplementationOnce(async (action) => {
            const items = action.parameters?.items;
            if (!Array.isArray(items))
                throw new Error("Expected concrete items");
            items.push("milk");
            return { entities: [], resultValue: "two items" };
        });
        await executeActions(
            [
                produce("source"),
                createExecutableAction(
                    "handoff",
                    "consumeItems",
                    { items: { $result: "source" } },
                    "middle",
                ),
                createExecutableAction("handoff", "consume", {
                    value: { $result: "middle" },
                }),
            ],
            undefined,
            context,
        );
        expect(original).toEqual(["rice"]);
        expect(consume.mock.calls[1]?.[0].parameters).toEqual({
            value: "two items",
        });
        expect(executed).toEqual(["produce", "consumeItems", "consume"]);
    });

    test("deferred history preserves structured/empty data without saved conversation history", () => {
        const action = {
            actionName: "pendingRequestAction" as const,
            parameters: {
                pendingRequest: "Use both outputs",
                pendingResultEntityId: "second",
            },
        };
        const first = {
            executableAction: produce("first"),
            result: {
                entities: [],
                resultValue: [],
                displayContent: { type: "text" as const, content: "No items" },
            },
        };
        const second = {
            executableAction: produce("second"),
            result: { entities: [], resultValue: "", historyText: "" },
        };
        const history = createPendingRequestHistory(action, [first, second]);
        expect(history.promptSections[1]?.content).toBe(
            JSON.stringify({
                action: first.executableAction.action,
                resultEntityId: "first",
                result: {
                    resultValue: [],
                    displayContent: first.result.displayContent,
                },
            }),
        );
        expect(history.promptSections[2]?.content).toContain(
            '"resultValue":""',
        );
        expect(() => createPendingRequestHistory(action, [first])).toThrow(
            "Pending request result not found: second",
        );
        expect(() =>
            createPendingRequestHistory(action, [
                {
                    ...second,
                    result: {
                        entities: [],
                        pendingChoice: {
                            choiceId: "choice",
                            type: "yesNo",
                            message: "Approve?",
                        },
                    },
                },
            ]),
        ).toThrow("Pending request cannot use an action awaiting confirmation");
    });

    test("does not translate or execute downstream actions after a producer error", async () => {
        results.set("failed", { error: "Read failed" });
        const action = produce("failed");
        await expect(
            executeActions(
                [
                    action,
                    createPendingRequestAction({
                        request: "Use the read",
                        pendingResultEntityId: "failed",
                    }),
                ],
                undefined,
                context,
            ),
        ).resolves.toMatchObject({
            error: "Read failed",
            failedAction: action,
        });
        expect(translatePending).not.toHaveBeenCalled();
        expect(executed).toEqual(["produce"]);
    });

    test("stops oversized deferred context without replaying the completed producer", async () => {
        results.set("large", {
            entities: [],
            historyText: "x".repeat(64 * 1024),
        });
        const translateRemaining = jest.fn();
        translatePending.mockImplementation(
            async (action, _context, completed) => {
                createPendingRequestHistory(action, completed);
                translateRemaining();
                throw new Error("Unexpected translation");
            },
        );
        await expect(
            executeActions(
                [
                    produce("large"),
                    createPendingRequestAction({
                        request: "Use the whole output",
                        pendingResultEntityId: "large",
                    }),
                    createExecutableAction("handoff", "consume", {
                        value: "later",
                    }),
                ],
                undefined,
                context,
            ),
        ).rejects.toThrow("do not replay completed actions");
        expect(executed).toEqual(["produce"]);
        expect(translateRemaining).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    test("retains completed continuations for the next deferred request without leaking bindings", async () => {
        results.set("initial", {
            entities: [],
            historyText: "Read original report",
        });
        results.set("nested", { entities: [], resultValue: "nested value" });
        const seen: number[] = [];
        translatePending.mockImplementation(
            async (action, _context, completed) => {
                createPendingRequestHistory(action, completed);
                seen.push(completed.length);
                return {
                    type: "translate",
                    requestAction: RequestAction.create(
                        "continuation",
                        seen.length === 1
                            ? [
                                  produce("nested", "initial"),
                                  createExecutableAction("handoff", "consume", {
                                      value: { $result: "initial" },
                                  }),
                              ]
                            : [
                                  createExecutableAction("handoff", "consume", {
                                      value: "done",
                                  }),
                              ],
                    ),
                    elapsedMs: 0,
                    config: system.session.getConfig().translation,
                };
            },
        );
        await executeActions(
            [
                produce("initial"),
                createPendingRequestAction({
                    request: "Read another report",
                    pendingResultEntityId: "initial",
                }),
                createPendingRequestAction({
                    request: "Finish",
                    pendingResultEntityId: "initial",
                }),
            ],
            undefined,
            context,
        );
        expect(seen).toEqual([1, 3]);
        expect(consume.mock.calls.map(([action]) => action.parameters)).toEqual(
            [{ value: "nested value" }, { value: "done" }],
        );
        expect(executed).toEqual(["produce", "produce", "consume", "consume"]);
    });
});
