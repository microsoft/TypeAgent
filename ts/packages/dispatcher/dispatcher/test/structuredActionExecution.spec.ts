// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentManifest,
    PendingChoice,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import type {
    Dispatcher,
    ExecuteActionRequest,
    StructuredActionExecutionResult,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import { createDispatcherFromContext } from "../src/dispatcher.js";
import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    type CommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { nullClientIO } from "../src/context/interactiveIO.js";
import type { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { closeStructuredActions } from "../src/structuredAction/executionHooks.js";
import type { FlowDefinition } from "../src/execute/flowInterpreter.js";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import { createAgentRpcServer } from "@typeagent/agent-rpc/server";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";

const manifest: AppAgentManifest = {
    description: "Offline structured execution fixture",
    emojiChar: "",
    schema: {
        description: "Guarded actions",
        schemaType: { action: "Actions", entities: "Entities" },
        schemaFile: {
            format: "ts",
            content: `
            export type Actions = Write | Read | ConfirmedRead | Resolve;
            export type Entities = Item;
            type Item = string;
            type Resolve = { actionName: "resolve"; parameters: { value: Item; mode?: string } };
            type Write = { actionName: "write"; parameters: { value: string; mode?: string } };
            type Read = { actionName: "read"; parameters: { value: string; mode?: string } };
            type ConfirmedRead = { actionName: "confirmedRead"; parameters: { value: string; mode?: string } };
        `,
        },
        actionPolicies: {
            read: { effects: "read-only" },
            confirmedRead: { effects: "read-only", confirmation: "required" },
        },
    },
};

function requirePrompt(result: StructuredActionExecutionResult) {
    if (result.status !== "requires_interaction")
        throw new Error(`Expected prompt: ${JSON.stringify(result)}`);
    return result;
}

describe("real structured dispatcher execution", () => {
    let context: CommandHandlerContext;
    let dispatcher: Dispatcher;
    let choices: ChoiceManager;
    let readiness: ReadinessReport;
    let entered: string[];
    let callbacks: number;
    let resolutions: number;
    let holdResolution: boolean;
    let liveContext: ActionContext<unknown> | undefined;
    let release: (() => void) | undefined;
    let held: Promise<void>;
    let scope: object;
    let active: boolean;
    let executionAllowed: boolean | undefined;
    let closeRpc: (() => void) | undefined;
    const broadcasts: string[] = [];
    const setup = jest.fn<NonNullable<AppAgent["setup"]>>();

    const complete = (): ActionResult => ({
        entities: [{ name: "saved", type: ["Item"], uniqueId: "stable-1" }],
        resultEntity: { name: "saved", type: ["Item"], uniqueId: "stable-1" },
        resultValue: { ids: ["stable-1"], count: 42 },
        historyText: "Saved item",
        displayContent: { type: "html", content: "<b>Saved</b>" },
    });
    const form = {
        message: "Every field matters",
        paged: true,
        fields: [
            {
                id: "pick",
                kind: "pick" as const,
                prompt: "Pick",
                choices: ["a", "b"],
                allowFreeText: true,
            },
            {
                id: "many",
                kind: "multiChoice" as const,
                prompt: "Many",
                choices: ["a", "b"],
                allowFreeText: true,
            },
            {
                id: "yes",
                kind: "yesNo" as const,
                prompt: "Yes?",
                defaultValue: true,
            },
        ],
    };
    const formAnswer: StructuredActionResponse = {
        type: "form",
        value: {
            answers: {
                pick: { kind: "pick", selected: -1, text: "other" },
                many: { kind: "multiChoice", selected: [0, 1] },
                yes: { kind: "yesNo", value: false },
            },
        },
    };

    beforeEach(async () => {
        choices = new ChoiceManager();
        readiness = { state: "ready" };
        entered = [];
        callbacks = 0;
        resolutions = 0;
        holdResolution = false;
        active = true;
        executionAllowed = undefined;
        scope = {};
        broadcasts.length = 0;
        setup.mockClear();
        held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const agent: AppAgent = {
            checkReadiness: async () => readiness,
            setup,
            resolveEntity: async (type, name) => {
                resolutions++;
                if (holdResolution) await held;
                return {
                    match: "exact",
                    entities: [{ name, type: [type], uniqueId: "resolved-id" }],
                };
            },
            cancelChoice: async (id) => {
                choices.cancelChoice(id);
            },
            handleChoice: (id, response, actionContext) =>
                choices.handleChoice(id, response, actionContext),
            executeAction: async (action, actionContext) => {
                liveContext = actionContext;
                const params = action.parameters as {
                    value: string;
                    mode?: string;
                };
                entered.push(params.value);
                expect(actionContext.activityContext).toBeUndefined();
                switch (params.mode) {
                    case "parallelQuestions":
                        await Promise.all(
                            ["first", "second"].map((message) =>
                                actionContext.sessionContext.popupQuestion(
                                    message,
                                    ["yes", "no"],
                                    0,
                                ),
                            ),
                        );
                        callbacks++;
                        return complete();
                    case "choiceChild":
                        return {
                            entities: [],
                            additionalActions: [
                                {
                                    actionName: "write",
                                    parameters: { value: "initial-child" },
                                },
                            ],
                            pendingChoice: {
                                type: "yesNo",
                                message: "Continue",
                                choiceId: choices.registerChoice(async () => {
                                    callbacks++;
                                    return {
                                        ...complete(),
                                        additionalActions: [
                                            {
                                                actionName: "write",
                                                parameters: {
                                                    value: "callback-child",
                                                },
                                            },
                                        ],
                                    };
                                }),
                            },
                        };
                    case "hold":
                        await held;
                        return complete();
                    case "throw":
                        throw new Error("handler failed");
                    case "fallback":
                        return {
                            error: "No model retry",
                            fallbackToReasoning: true,
                        } as ActionResult;
                    case "empty":
                        return undefined;
                    case "parentChild":
                        return {
                            ...complete(),
                            resultValue: { ids: ["source-id"] },
                            historyText: "Parent result",
                            additionalActions: [
                                {
                                    actionName: "write",
                                    parameters: {
                                        value: "child",
                                        mode: "distinctChild",
                                    },
                                },
                            ],
                        };
                    case "distinctChild":
                        return {
                            ...complete(),
                            resultValue: { ids: ["child-id"] },
                            historyText: "Child result",
                        };
                    case "question": {
                        const selected =
                            await actionContext.sessionContext.popupQuestion(
                                "Choose",
                                ["yes", "no"],
                                0,
                            );
                        callbacks += selected === 0 ? 1 : 10;
                        return complete();
                    }
                    case "blockingForm":
                        await context.clientIO.askForm!(
                            context.currentRequestId,
                            form,
                            "guarded",
                        );
                        callbacks++;
                        return complete();
                    case "proposal":
                        await context.clientIO.proposeAction(
                            context.currentRequestId!,
                            {
                                templateAgentName: "guarded",
                                templateName: "edit",
                                defaultTemplate: {
                                    type: "object",
                                    fields: {
                                        value: { type: { type: "string" } },
                                    },
                                },
                                templateData: {
                                    schema: {
                                        type: "object",
                                        fields: {
                                            value: { type: { type: "string" } },
                                        },
                                    },
                                    data: { value: "old" },
                                },
                            },
                            "guarded",
                        );
                        callbacks++;
                        return complete();
                    case "child":
                        return {
                            ...complete(),
                            additionalActions: [
                                {
                                    actionName: "write",
                                    parameters: { value: "child" },
                                },
                            ],
                        };
                    case "reason":
                        return {
                            ...complete(),
                            additionalActions: [
                                {
                                    schemaName: "dispatcher",
                                    actionName: "reasoningAction",
                                    parameters: { request: "do not run" },
                                },
                            ],
                        };
                }
                if (
                    ["yesNo", "multiChoice", "pickRemember", "form"].includes(
                        params.mode ?? "",
                    )
                ) {
                    const choiceId = choices.registerChoice(
                        async (_response, callbackContext) => {
                            callbacks++;
                            callbackContext.actionIO.appendDisplay(
                                "callback output",
                            );
                            return complete();
                        },
                    );
                    const pendingChoice: PendingChoice =
                        params.mode === "form"
                            ? { type: "form", choiceId, ...form }
                            : params.mode === "yesNo"
                              ? { type: "yesNo", choiceId, message: "Really?" }
                              : params.mode === "pickRemember"
                                ? {
                                      type: "pickRemember",
                                      choiceId,
                                      message: "Pick",
                                      choices: ["a", "b"],
                                      checkboxLabel: "Remember",
                                  }
                                : {
                                      type: "multiChoice",
                                      choiceId,
                                      message: "Many",
                                      choices: ["a", "b"],
                                  };
                    return { entities: [], pendingChoice };
                }
                return complete();
            },
        };
        const provider: AppAgentProvider = {
            getAppAgentNames: () => ["guarded"],
            getAppAgentManifest: async () => manifest,
            loadAppAgent: async () => agent,
            unloadAppAgent: async () => {},
        };
        context = await initializeCommandHandlerContext(
            "structured-execution-test",
            {
                agents: {
                    schemas: ["guarded", "system.config"],
                    actions: ["guarded", "system.config"],
                },
                translation: { enabled: false },
                explainer: { enabled: false },
                cache: { enabled: false },
                appAgentProviders: [provider],
                collectCommandResult: true,
                metrics: true,
                conversationMemorySettings: {
                    requestKnowledgeExtraction: false,
                    actionResultEntityStorage: false,
                    actionResultKnowledgeExtraction: false,
                },
                clientIO: {
                    ...nullClientIO,
                    question: async () => {
                        broadcasts.push("question");
                        return 0;
                    },
                    askForm: async () => {
                        broadcasts.push("form");
                        return { answers: {} };
                    },
                    proposeAction: async () => {
                        broadcasts.push("proposal");
                    },
                    requestChoice: () => {
                        broadcasts.push("choice");
                    },
                    requestForm: () => {
                        broadcasts.push("form");
                    },
                    requestInteraction: () => {
                        broadcasts.push("interaction");
                    },
                },
            },
        );
        dispatcher = createDispatcherFromContext(
            context,
            "owner",
            undefined,
            () => ({
                scope,
                canDiscoverSchema: () => true,
                ...(executionAllowed === undefined
                    ? {}
                    : { canExecute: executionAllowed }),
                isActive: () => active,
            }),
        );
    });

    afterEach(async () => {
        release?.();
        await closeCommandHandlerContext(context);
        closeRpc?.();
        closeRpc = undefined;
    });

    async function useAgentRpc() {
        let clientProvider: ChannelProviderAdapter;
        let serverProvider: ChannelProviderAdapter;
        clientProvider = createChannelProviderAdapter(
            "client",
            (message, callback) => {
                setImmediate(() =>
                    serverProvider.notifyMessage(structuredClone(message)),
                );
                callback?.(null);
            },
        );
        serverProvider = createChannelProviderAdapter(
            "server",
            (message, callback) => {
                setImmediate(() =>
                    clientProvider.notifyMessage(structuredClone(message)),
                );
                callback?.(null);
            },
        );
        const original = context.agents.getAppAgent.bind(context.agents);
        const server = createAgentRpcServer(
            "guarded",
            original("guarded"),
            serverProvider,
        );
        const client = await createAgentRpcClient(
            "guarded",
            clientProvider,
            server.agentInterface,
        );
        const spy = jest
            .spyOn(context.agents, "getAppAgent")
            .mockImplementation((name) =>
                name === "guarded" ? client : original(name),
            );
        closeRpc = () => {
            spy.mockRestore();
            server.closeFn();
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        };
        return () => {
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        };
    }

    async function request(
        actionName = "write",
        mode?: string,
    ): Promise<ExecuteActionRequest> {
        const found = await dispatcher.getActionContract({
            schemaName: "guarded",
            actionName,
        });
        if (found.status !== "found")
            throw new Error("Missing fixture contract");
        return {
            protocolVersion: 1,
            scopeId: found.scopeId,
            schemaName: "guarded",
            actionName,
            fingerprint: found.contract.fingerprint,
            parameters: {
                value: "original",
                ...(mode === undefined ? {} : { mode }),
            },
        };
    }

    async function answer(
        result: StructuredActionExecutionResult,
        response: StructuredActionResponse,
    ) {
        const prompt = requirePrompt(result);
        return dispatcher.continueAction({
            protocolVersion: 1,
            scopeId: prompt.scopeId,
            operationId: prompt.operationId,
            interactionId: prompt.interactionId,
            response,
        });
    }

    it("confirms an immutable action, preserves real result data, and never broadcasts prompts", async () => {
        const input = await request();
        const pending = dispatcher.executeAction(input);
        input.parameters!.value = "mutated";
        const prompt = requirePrompt(await pending);
        expect(prompt.prompt).toMatchObject({
            type: "confirmation",
            action: { parameters: { value: "original" } },
        });
        expect(entered).toEqual([]);
        expect(context.currentRequestId?.requestId).toBe(prompt.operationId);
        expect(context.activeRequests.has(prompt.operationId)).toBe(true);
        expect(context.currentAbortSignal).toBeDefined();
        expect((await dispatcher.getQueueSnapshot()).running?.blockedOn).toBe(
            "interaction",
        );
        const result = await answer(prompt, {
            type: "confirmation",
            approved: true,
        });
        expect(result.status).toBe("completed");
        expect(entered).toEqual(["original"]);
        expect(result.results[0].result).toMatchObject(complete());
        expect(result.output).toContain("Saved item");
        expect(broadcasts).toEqual([]);
    });

    it.each([
        "stale",
        "scope",
        "parameter",
        "approval",
        "reference",
        "resultReference",
    ])("rejects %s before any agent effect", async (kind) => {
        const input = await request();
        if (kind === "stale") input.fingerprint = "stale";
        if (kind === "scope") input.scopeId = "wrong";
        if (kind === "parameter") input.parameters = { value: 1 };
        if (kind === "approval") Object.assign(input, { approved: true });
        if (kind === "reference") input.parameters!.value = "${entity-1}";
        if (kind === "resultReference")
            input.parameters!.value = { $result: "1" };
        const result = await dispatcher.executeAction(input);
        expect(result.status).not.toBe("completed");
        expect(result.status).not.toBe("requires_interaction");
        expect(entered).toEqual([]);
        expect(setup).not.toHaveBeenCalled();
        expect(resolutions).toBe(0);
    });

    it.each(["read", "write", "resolve"])(
        "allows discovery but denies %s execution without opt-in",
        async (actionName) => {
            executionAllowed = false;
            const input = await request(actionName);
            const result = await dispatcher.executeAction(input);
            expect(result).toMatchObject({
                status: "unavailable",
                operationId: "",
                error: { code: "unavailable" },
            });
            expect(context.requestQueue.getSnapshot().running).toBeNull();
            expect(entered).toEqual([]);
            expect(resolutions).toBe(0);
            expect(setup).not.toHaveBeenCalled();
        },
    );

    it("denies continuation without consuming the prompt when execution access is revoked", async () => {
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request()),
        );
        executionAllowed = false;
        expect(
            (await answer(prompt, { type: "confirmation", approved: true }))
                .status,
        ).toBe("unavailable");
        expect(
            (
                await dispatcher.cancelAction({
                    protocolVersion: 1,
                    scopeId: prompt.scopeId,
                    operationId: prompt.operationId,
                })
            ).status,
        ).toBe("unavailable");
        expect(entered).toEqual([]);
        executionAllowed = true;
        expect(
            (await answer(prompt, { type: "confirmation", approved: true }))
                .status,
        ).toBe("completed");
        expect(entered).toEqual(["original"]);
    });

    it("rechecks execution access after asynchronous entity preparation", async () => {
        holdResolution = true;
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request("resolve")),
        );
        const result = answer(prompt, { type: "confirmation", approved: true });
        for (let ticks = 0; resolutions === 0 && ticks < 20; ticks++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(resolutions).toBe(1);
        executionAllowed = false;
        release!();
        expect((await result).status).toBe("unavailable");
        expect(entered).toEqual([]);
        expect(setup).not.toHaveBeenCalled();
    });

    it("does not execute or run setup while unready", async () => {
        const input = await request();
        readiness = { state: "setup-required", message: "Configure fixture" };
        await context.agents.refreshReadiness("guarded");
        const result = await dispatcher.executeAction(input);
        expect(result.status).toBe("unavailable");
        expect(entered).toEqual([]);
        expect(setup).not.toHaveBeenCalled();
    });

    it("requires explicit read-only policy and honors required confirmation", async () => {
        expect(
            (await dispatcher.executeAction(await request("read"))).status,
        ).toBe("completed");
        const prompt = await dispatcher.executeAction(
            await request("confirmedRead"),
        );
        expect(requirePrompt(prompt).prompt.type).toBe("confirmation");
        await dispatcher.cancelAction({
            protocolVersion: 1,
            scopeId: prompt.scopeId,
            operationId: prompt.operationId,
        });
        expect(entered).toEqual(["original"]);
    });

    it("does not consume invalid or duplicate concurrent responses", async () => {
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request()),
        );
        expect(
            (await answer(prompt, { type: "yesNo", value: true })).status,
        ).toBe("failed");
        const [first, second] = await Promise.all([
            answer(prompt, { type: "confirmation", approved: true }),
            answer(prompt, { type: "confirmation", approved: true }),
        ]);
        expect(first.status).toBe("completed");
        expect(second.status).toBe("failed");
        expect(entered).toEqual(["original"]);
    });

    it("rechecks changed contracts after waiting without invoking the handler", async () => {
        const prompt = await dispatcher.executeAction(await request());
        const config = context.agents.getActionConfig("guarded");
        config.actionPolicies = {
            ...config.actionPolicies,
            write: { effects: "state-changing" },
        };
        expect(
            (await answer(prompt, { type: "confirmation", approved: true }))
                .status,
        ).toBe("contract_stale");
        expect(entered).toEqual([]);
    });

    it.each([
        "yesNo",
        "multiChoice",
        "pickRemember",
        "form",
        "question",
        "blockingForm",
        "proposal",
    ])(
        "resumes the same %s operation without rerunning the action",
        async (mode) => {
            const prompt = requirePrompt(
                await dispatcher.executeAction(await request("read", mode)),
            );
            const responses: Record<string, StructuredActionResponse> = {
                yesNo: { type: "yesNo", value: true },
                multiChoice: { type: "multiChoice", selected: [0, 1] },
                pickRemember: {
                    type: "pickRemember",
                    selected: 1,
                    remember: false,
                },
                form: formAnswer,
                blockingForm: formAnswer,
                question: { type: "question", selected: 0 },
                proposal: {
                    type: "proposal",
                    accepted: true,
                    data: { value: "edited" },
                },
            };
            expect(
                (await answer(prompt, { type: "question", selected: 99 }))
                    .status,
            ).toBe("failed");
            const result = await answer(prompt, responses[mode]);
            if (result.status !== "completed")
                throw new Error(JSON.stringify(result));
            expect(result).toMatchObject({ status: "completed" });
            expect(entered).toEqual(["original"]);
            expect(callbacks).toBe(1);
            expect(broadcasts).toEqual([]);
            expect(() => liveContext!.actionIO).toThrow("Context is closed");
        },
    );

    it("requires every form answer and rejects duplicates without consuming the prompt", async () => {
        const prompt = await dispatcher.executeAction(
            await request("read", "form"),
        );
        expect(
            (await answer(prompt, { type: "form", value: { answers: {} } }))
                .status,
        ).toBe("failed");
        const invalid = structuredClone(formAnswer);
        if (invalid.type === "form")
            invalid.value.answers.many = {
                kind: "multiChoice",
                selected: [0, 0],
            };
        expect((await answer(prompt, invalid)).status).toBe("failed");
        expect((await answer(prompt, formAnswer)).status).toBe("completed");
        expect(callbacks).toBe(1);
    });

    it.each(["write", "question", "yesNo"])(
        "cancellation of %s never chooses a default",
        async (mode) => {
            const prompt = requirePrompt(
                await dispatcher.executeAction(
                    await request(mode === "write" ? "write" : "read", mode),
                ),
            );
            const result = await dispatcher.cancelAction({
                protocolVersion: 1,
                scopeId: prompt.scopeId,
                operationId: prompt.operationId,
            });
            expect(result.status).toBe(
                mode === "write" ? "cancelled" : "execution_uncertain",
            );
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(callbacks).toBe(0);
            expect(
                (choices as unknown as { callbacks: Map<string, unknown> })
                    .callbacks.size,
            ).toBe(0);
        },
    );

    it("guards additional actions independently", async () => {
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request("read", "child")),
        );
        expect(prompt.prompt).toMatchObject({
            type: "confirmation",
            action: { parameters: { value: "child" } },
        });
        expect(entered).toEqual(["original"]);
        expect(
            (await answer(prompt, { type: "confirmation", approved: true }))
                .status,
        ).toBe("completed");
        expect(entered).toEqual(["original", "child"]);
    });

    it("serializes concurrent blocking prompts without dropping an answer", async () => {
        const first = requirePrompt(
            await dispatcher.executeAction(
                await request("read", "parallelQuestions"),
            ),
        );
        expect(first.prompt).toMatchObject({
            type: "question",
            message: "first",
        });
        const second = requirePrompt(
            await answer(first, { type: "question", selected: 1 }),
        );
        expect(second.prompt).toMatchObject({
            type: "question",
            message: "second",
        });
        expect(
            (await answer(second, { type: "question", selected: 0 })).status,
        ).toBe("completed");
        expect(callbacks).toBe(1);
        expect(broadcasts).toEqual([]);
    });

    it("preserves additional actions from both a pending choice and its callback", async () => {
        const choice = requirePrompt(
            await dispatcher.executeAction(
                await request("read", "choiceChild"),
            ),
        );
        const first = requirePrompt(
            await answer(choice, { type: "yesNo", value: true }),
        );
        expect(first.prompt).toMatchObject({
            action: { parameters: { value: "initial-child" } },
        });
        const second = requirePrompt(
            await answer(first, { type: "confirmation", approved: true }),
        );
        expect(second.prompt).toMatchObject({
            action: { parameters: { value: "callback-child" } },
        });
        expect(
            (await answer(second, { type: "confirmation", approved: true }))
                .status,
        ).toBe("completed");
        expect(entered).toEqual([
            "original",
            "initial-child",
            "callback-child",
        ]);
        expect(callbacks).toBe(1);
    });

    it.each(["question", "yesNo"])(
        "resumes a real agent-RPC %s without legacy broadcasting",
        async (mode) => {
            await useAgentRpc();
            const prompt = requirePrompt(
                await dispatcher.executeAction(await request("read", mode)),
            );
            expect(broadcasts).toEqual([]);
            const result = await answer(
                prompt,
                mode === "question"
                    ? { type: "question", selected: 0 }
                    : { type: "yesNo", value: true },
            );
            expect(result.status).toBe("completed");
            expect(callbacks).toBe(1);
            expect(entered).toEqual(["original"]);
            expect(result.results.at(-1)?.result).toMatchObject({
                resultValue: { ids: ["stable-1"], count: 42 },
            });
        },
    );

    it("retains the queue lock after aborting an uncooperative agent-RPC handler", async () => {
        await useAgentRpc();
        const input = await request("read", "hold");
        const running = dispatcher.executeAction(input);
        for (let ticks = 0; entered.length === 0 && ticks < 50; ticks++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(entered).toEqual(["original"]);
        const cancelled = await dispatcher.cancelAction({
            protocolVersion: 1,
            scopeId: input.scopeId,
            operationId: context.currentRequestId!.requestId,
        });
        expect(cancelled.status).toBe("execution_uncertain");
        expect((await running).status).toBe("execution_uncertain");
        const next = dispatcher.executeAction(await request("read"));
        for (let ticks = 0; ticks < 10; ticks++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(entered).toHaveLength(1);
        release!();
        expect((await next).status).toBe("completed");
        expect(entered).toHaveLength(2);
    });

    it("returns uncertainty and stops admission when the agent transport is lost", async () => {
        const disconnect = await useAgentRpc();
        const input = await request("read", "hold");
        const running = dispatcher.executeAction(input);
        for (let ticks = 0; entered.length === 0 && ticks < 50; ticks++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(entered).toEqual(["original"]);
        disconnect();
        expect((await running).status).toBe("execution_uncertain");
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        expect(context.currentRequestId).toBeDefined();
    });

    it("chains same-operation resultValue through guarded flow actions and their children", async () => {
        const registry = (
            context.agents as unknown as {
                flowRegistry: Map<string, FlowDefinition>;
            }
        ).flowRegistry;
        registry.set("guarded/read", {
            name: "read",
            description: "Chained flow",
            parameters: {},
            steps: [
                {
                    id: "first",
                    schemaName: "guarded",
                    actionName: "write",
                    parameters: { value: "first" },
                },
                {
                    id: "second",
                    schemaName: "guarded",
                    actionName: "write",
                    parameters: { value: "${first.data.ids.0}", mode: "child" },
                },
            ],
        });
        const first = requirePrompt(
            await dispatcher.executeAction(await request("read")),
        );
        const second = requirePrompt(
            await answer(first, { type: "confirmation", approved: true }),
        );
        expect(second.prompt).toMatchObject({
            action: { parameters: { value: "stable-1" } },
        });
        const child = requirePrompt(
            await answer(second, { type: "confirmation", approved: true }),
        );
        expect(child.prompt).toMatchObject({
            action: { parameters: { value: "child" } },
        });
        expect(
            (await answer(child, { type: "confirmation", approved: true }))
                .status,
        ).toBe("completed");
        expect(entered).toEqual(["first", "stable-1", "child"]);
    });

    it("guards each nested flow step, including entity preparation", async () => {
        const registry = (
            context.agents as unknown as {
                flowRegistry: Map<string, FlowDefinition>;
            }
        ).flowRegistry;
        registry.set("guarded/read", {
            name: "read",
            description: "Flow fixture",
            parameters: {},
            steps: [
                {
                    id: "resolve",
                    schemaName: "guarded",
                    actionName: "resolve",
                    parameters: { value: "${value}" },
                },
            ],
        });
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request("read")),
        );
        expect(prompt.prompt).toMatchObject({
            type: "confirmation",
            action: { actionName: "resolve" },
        });
        expect(entered).toEqual([]);
        expect(resolutions).toBe(0);
        expect(
            (await answer(prompt, { type: "confirmation", approved: true }))
                .status,
        ).toBe("completed");
        expect(entered).toEqual(["original"]);
        expect(resolutions).toBe(1);
    });

    it.each(["disabled", "inactive"])(
        "does not enter a %s schema",
        async (state) => {
            const input = await request("resolve");
            if (state === "disabled") {
                const agents = context.agents as unknown as {
                    agents: Map<string, { actions: Set<string> }>;
                };
                agents.agents.get("guarded")!.actions.delete("guarded");
            } else {
                const agents = context.agents as unknown as {
                    transientAgents: Record<string, boolean>;
                };
                agents.transientAgents.guarded = false;
            }
            expect((await dispatcher.executeAction(input)).status).toBe(
                "unavailable",
            );
            expect(entered).toEqual([]);
            expect(resolutions).toBe(0);
            expect(setup).not.toHaveBeenCalled();
        },
    );

    it("does not let legacy choice responses consume a structured SDK choice", async () => {
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request("read", "yesNo")),
        );
        const choiceResult = prompt.results[0].result;
        if (
            choiceResult.error !== undefined ||
            choiceResult.pendingChoice === undefined
        )
            throw new Error("Missing SDK choice");
        await expect(
            dispatcher.respondToChoice(
                choiceResult.pendingChoice.choiceId,
                true,
            ),
        ).rejects.toThrow("Choice not found or expired");
        expect(callbacks).toBe(0);
        expect(
            (await answer(prompt, { type: "yesNo", value: true })).status,
        ).toBe("completed");
        expect(callbacks).toBe(1);
    });

    it.each(["throw", "fallback", "reason"])(
        "returns %s failures without model retry",
        async (mode) => {
            const result = await dispatcher.executeAction(
                await request("read", mode),
            );
            expect(result.status).toBe("failed");
            expect(entered).toEqual(["original"]);
        },
    );

    it("accepts an empty handler result as completion", async () => {
        expect(
            (await dispatcher.executeAction(await request("read", "empty")))
                .status,
        ).toBe("completed");
    });

    it("returns nested built-in command errors instead of synthesized success", async () => {
        const identity = {
            schemaName: "system.config",
            actionName: "toggleAgent",
        };
        const found = await dispatcher.getActionContract(identity);
        if (found.status !== "found")
            throw new Error("Expected built-in action");
        const prompt = requirePrompt(
            await dispatcher.executeAction({
                protocolVersion: found.protocolVersion,
                scopeId: found.scopeId,
                ...identity,
                fingerprint: found.contract.fingerprint,
                parameters: {
                    enable: true,
                    agentNames: ["review-no-such-agent"],
                },
            }),
        );
        const result = await answer(prompt, {
            type: "confirmation",
            approved: true,
        });
        expect(result.status).toBe("failed");
        expect(result.results[0].result.error).toContain("Invalid agent name");
        expect(result.output.join("\n")).toContain("review-no-such-agent");
        expect(result.output.join("\n")).not.toContain("completed.");

        const legacy = await dispatcher.submitCommand(
            "@config agent review-no-such-agent",
        );
        if (!legacy.ok) throw new Error("Expected legacy submission");
        expect((await legacy.entry.completion)?.disposition?.status).toBe(
            "failed",
        );
    });

    it("binds a flow step's own result and never replays its additional actions", async () => {
        const registry = (
            context.agents as unknown as {
                flowRegistry: Map<string, FlowDefinition>;
            }
        ).flowRegistry;
        registry.set("guarded/read", {
            name: "read",
            description: "Distinct parent and child results",
            parameters: {},
            steps: [
                {
                    id: "first",
                    schemaName: "guarded",
                    actionName: "write",
                    parameters: { value: "first", mode: "parentChild" },
                },
                {
                    id: "last",
                    schemaName: "guarded",
                    actionName: "write",
                    parameters: {
                        value: "${first.data.ids.0}",
                        mode: "parentChild",
                    },
                },
            ],
        });
        let result = await dispatcher.executeAction(await request("read"));
        for (const value of ["first", "child", "source-id", "child"]) {
            const current = requirePrompt(result);
            expect(current.prompt).toMatchObject({
                type: "confirmation",
                action: { parameters: { value } },
            });
            result = await answer(current, {
                type: "confirmation",
                approved: true,
            });
        }
        expect(result.status).toBe("completed");
        expect(entered).toEqual(["first", "child", "source-id", "child"]);
        const root = result.results.find(
            ({ action }) => action.actionName === "read",
        );
        expect(root?.result).toMatchObject({
            resultValue: { ids: ["source-id"] },
        });
        expect(root?.result).not.toHaveProperty("additionalActions");
    });

    it("retains uncertainty and serialization while an uncooperative handler runs", async () => {
        const input = await request("read", "hold");
        const running = dispatcher.executeAction(input);
        while (entered.length === 0)
            await new Promise<void>((resolve) => setImmediate(resolve));
        const id = context.currentRequestId!.requestId;
        const result = await dispatcher.cancelAction({
            protocolVersion: 1,
            scopeId: input.scopeId,
            operationId: id,
        });
        expect(result.status).toBe("execution_uncertain");
        expect((await running).status).toBe("execution_uncertain");
        const next = dispatcher.executeAction(await request("read"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(entered).toHaveLength(1);
        release!();
        expect((await next).status).toBe("completed");
        expect(entered).toHaveLength(2);
        expect(
            (
                await dispatcher.cancelAction({
                    protocolVersion: 1,
                    scopeId: input.scopeId,
                    operationId: id,
                })
            ).status,
        ).toBe("execution_uncertain");
    });

    it("supports trusted reconnect takeover but rejects stale and foreign facades", async () => {
        const prompt = requirePrompt(
            await dispatcher.executeAction(await request()),
        );
        const ownerScope = scope;
        const resumed = createDispatcherFromContext(
            context,
            "new-owner",
            undefined,
            () => ({ scope: ownerScope, canDiscoverSchema: () => true }),
        );
        const foreign = createDispatcherFromContext(
            context,
            "foreign",
            undefined,
            () => ({ scope: {}, canDiscoverSchema: () => true }),
        );
        const input = {
            protocolVersion: 1 as const,
            scopeId: prompt.scopeId,
            operationId: prompt.operationId,
            interactionId: prompt.interactionId,
            response: { type: "confirmation" as const, approved: true },
        };
        active = false;
        expect((await dispatcher.continueAction(input)).status).toBe("failed");
        expect((await foreign.continueAction(input)).status).toBe("failed");
        expect((await resumed.continueAction(input)).status).toBe("completed");
        expect(entered).toEqual(["original"]);
    });

    it("rebinds a denied-scope facade to the current lease before resuming each wait", async () => {
        const logicalScope = scope;
        const deniedScope = {};
        let current = true;
        const original = createDispatcherFromContext(
            context,
            "old-lease",
            undefined,
            () => ({
                scope: current ? logicalScope : deniedScope,
                canDiscoverSchema: () => current,
            }),
        );
        const prompt = requirePrompt(
            await original.executeAction(await request("write", "yesNo")),
        );
        current = false;
        const incoming = createDispatcherFromContext(
            context,
            "new-lease",
            undefined,
            () => ({
                scope: logicalScope,
                canDiscoverSchema: () => !current,
            }),
        );
        const continuation = {
            protocolVersion: 1 as const,
            scopeId: prompt.scopeId,
            operationId: prompt.operationId,
            interactionId: prompt.interactionId,
            response: { type: "confirmation" as const, approved: true },
        };
        expect((await original.continueAction(continuation)).status).toBe(
            "failed",
        );
        const choice = requirePrompt(
            await incoming.continueAction(continuation),
        );
        expect(choice.prompt.type).toBe("yesNo");
        expect(
            (
                await incoming.continueAction({
                    ...continuation,
                    interactionId: choice.interactionId,
                    response: { type: "yesNo", value: true },
                })
            ).status,
        ).toBe("completed");
        expect(entered).toEqual(["original"]);
        expect(callbacks).toBe(1);
    });

    it.each([
        ["write", undefined, "user", "cancelled"],
        ["read", "question", "no_clients", "execution_uncertain"],
        ["read", "yesNo", "no_clients", "execution_uncertain"],
    ] as const)(
        "host cancellation handles %s/%s without legacy interaction entries",
        async (action, mode, reason, status) => {
            const prompt = requirePrompt(
                await dispatcher.executeAction(await request(action, mode)),
            );
            expect(context.requestQueue.getSnapshot().running).toMatchObject({
                requestId: prompt.operationId,
                blockedOn: "interaction",
            });
            // The host's existing supersession path performs these two steps
            // even when its legacy interaction manager has no matching entry.
            expect(
                context.requestQueue.cancelRunning(prompt.operationId, reason),
            ).toBe(true);
            const controller = context.activeRequests.get(prompt.operationId);
            expect(controller).toBeDefined();
            controller!.abort();
            expect(
                context.requestQueue.cancelRunning(prompt.operationId, reason),
            ).toBe(false);
            const result = await dispatcher.cancelAction({
                protocolVersion: 1,
                scopeId: prompt.scopeId,
                operationId: prompt.operationId,
            });
            expect(result.status).toBe(status);
            expect(callbacks).toBe(0);
            expect(broadcasts).toEqual([]);
            expect(
                (await dispatcher.executeAction(await request("read"))).status,
            ).toBe("completed");
        },
    );

    it("uses concrete owning-agent resolution without conversation memory or prior activity", async () => {
        const memory = context.conversationMemory;
        const search =
            memory === undefined
                ? undefined
                : jest.spyOn(memory, "searchKnowledge");
        context.activityContext = {
            appAgentName: "guarded",
            activityName: "old",
            context: { value: "past" },
        } as unknown as NonNullable<CommandHandlerContext["activityContext"]>;
        const prompt = await dispatcher.executeAction(await request("resolve"));
        expect(resolutions).toBe(0);
        const result = await answer(prompt, {
            type: "confirmation",
            approved: true,
        });
        expect(result.status).toBe("completed");
        expect(resolutions).toBe(1);
        expect(entered).toEqual(["original"]);
        expect(search?.mock.calls ?? []).toEqual([]);
        search?.mockRestore();
    });

    it("rechecks the contract after asynchronous entity preparation", async () => {
        holdResolution = true;
        const prompt = await dispatcher.executeAction(await request("resolve"));
        const result = answer(prompt, { type: "confirmation", approved: true });
        for (let i = 0; i < 20 && resolutions === 0; i++)
            await new Promise<void>((resolve) => setImmediate(resolve));
        expect(resolutions).toBe(1);
        const config = context.agents.getActionConfig("guarded");
        config.actionPolicies = {
            ...config.actionPolicies,
            resolve: { effects: "state-changing" },
        };
        release!();
        expect((await result).status).toBe("contract_stale");
        expect(entered).toEqual([]);
    });

    it("honors normal queue/controller cancellation of a blocked structured request", async () => {
        const prompt = await dispatcher.executeAction(await request());
        await dispatcher.cancelCommand(prompt.operationId);
        expect(
            (
                await dispatcher.cancelAction({
                    protocolVersion: 1,
                    scopeId: prompt.scopeId,
                    operationId: prompt.operationId,
                })
            ).status,
        ).toBe("cancelled");
        expect(entered).toEqual([]);
        expect(
            (await dispatcher.executeAction(await request("read"))).status,
        ).toBe("completed");
    });

    it("expires a prompt without selecting its affirmative default", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
        try {
            const prompt = requirePrompt(
                await dispatcher.executeAction(
                    await request("read", "question"),
                ),
            );
            await jest.advanceTimersByTimeAsync(10 * 60_000);
            const result = await dispatcher.cancelAction({
                protocolVersion: 1,
                scopeId: prompt.scopeId,
                operationId: prompt.operationId,
            });
            expect(result.status).toBe("execution_uncertain");
            expect(callbacks).toBe(0);
            closeStructuredActions(context);
        } finally {
            jest.useRealTimers();
        }
    });

    it("bounds live operations at the existing queue capacity without evicting a prompt", async () => {
        const input = await request();
        const first = requirePrompt(await dispatcher.executeAction(input));
        const queued = Array.from({ length: 99 }, () =>
            dispatcher.executeAction(input),
        );
        expect((await dispatcher.executeAction(input)).status).toBe(
            "unavailable",
        );
        expect((await dispatcher.getQueueSnapshot()).queued).toHaveLength(99);
        expect(entered).toEqual([]);
        closeStructuredActions(context);
        expect(
            (await Promise.all(queued)).every(
                (result) => result.status === "cancelled",
            ),
        ).toBe(true);
        expect(
            (
                await dispatcher.cancelAction({
                    protocolVersion: 1,
                    scopeId: first.scopeId,
                    operationId: first.operationId,
                })
            ).status,
        ).not.toBe("completed");
    });

    it("retains only the latest 100 terminal outcomes and never replays lost state", async () => {
        const input = await request("read");
        const first = await dispatcher.executeAction(input);
        for (let i = 0; i < 101; i++) await dispatcher.executeAction(input);
        const result = await dispatcher.cancelAction({
            protocolVersion: 1,
            scopeId: first.scopeId,
            operationId: first.operationId,
        });
        expect(result.status).toBe("execution_uncertain");
        if (result.status === "execution_uncertain")
            expect(result.error.code).toBe("execution_state_lost");
        expect(entered).toHaveLength(102);
    });
});
