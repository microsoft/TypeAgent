// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import type { FullAction } from "@typeagent/agent-cache";
import type {
    ActionContext,
    ActionResult,
    DisplayContent,
} from "@typeagent/agent-sdk";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import type {
    StructuredActionPrompt,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";

export interface StructuredExecutionHooks {
    guard(action: FullAction, phase: "prepare" | "enter"): Promise<void>;
    effect(action?: FullAction, possibleEffects?: boolean): void;
    display(content: DisplayContent): void;
    result(action: FullAction, result: ActionResult): void;
    choice(
        action: FullAction,
        result: ActionResult,
        context: ActionContext<unknown>,
    ): Promise<ActionResult>;
    prompt(prompt: StructuredActionPrompt): Promise<StructuredActionResponse>;
}

const requests = new WeakMap<
    CommandHandlerContext,
    Map<string, StructuredExecutionHooks>
>();
const active = new AsyncLocalStorage<StructuredExecutionHooks>();
const cleanup = new WeakMap<CommandHandlerContext, () => void>();

export function registerStructuredActionCleanup(
    context: CommandHandlerContext,
    close: () => void,
) {
    cleanup.set(context, close);
}

export function closeStructuredActions(context: CommandHandlerContext) {
    cleanup.get(context)?.();
    cleanup.delete(context);
}

export function getStructuredExecution(
    context: CommandHandlerContext,
    requestId = context.currentRequestId?.requestId,
) {
    return requestId === undefined
        ? undefined
        : requests.get(context)?.get(requestId);
}

export async function runStructuredExecution(
    context: CommandHandlerContext,
    requestId: string,
    hooks: StructuredExecutionHooks,
    run: () => Promise<void>,
) {
    let registry = requests.get(context);
    if (registry === undefined) {
        registry = new Map();
        requests.set(context, registry);
    }
    registry.set(requestId, hooks);
    try {
        await active.run(hooks, run);
    } finally {
        registry.delete(requestId);
    }
}

const routed = new WeakSet<CommandHandlerContext>();

/** Install once, outside requests. Prompts never reach legacy broadcast/ID registries. */
export function installStructuredInteractionRouting(
    context: CommandHandlerContext,
) {
    if (routed.has(context)) return;
    routed.add(context);
    const client = context.clientIO;
    const route = (requestId?: { requestId: string }) =>
        requestId === undefined
            ? active.getStore()
            : getStructuredExecution(context, requestId.requestId);
    context.clientIO = new Proxy(client, {
        get(target, key, receiver) {
            if (key === "question") {
                return async (...args: Parameters<typeof client.question>) => {
                    const hooks = route(args[0]);
                    if (hooks === undefined) return client.question(...args);
                    const response = await hooks.prompt({
                        type: "question",
                        message: args[1],
                        choices: args[2],
                        ...(args[3] === undefined
                            ? {}
                            : { defaultId: args[3] }),
                    });
                    if (response.type !== "question")
                        throw new Error("Invalid question response");
                    return response.selected;
                };
            }
            if (key === "askForm") {
                return async (
                    ...args: Parameters<NonNullable<typeof client.askForm>>
                ) => {
                    const hooks = route(args[0]);
                    if (hooks === undefined) {
                        if (client.askForm === undefined)
                            throw new Error("Forms are not supported");
                        return client.askForm(...args);
                    }
                    const response = await hooks.prompt({
                        type: "form",
                        ...args[1],
                    });
                    if (response.type !== "form")
                        throw new Error("Invalid form response");
                    return response.value;
                };
            }
            if (key === "proposeAction") {
                return async (
                    ...args: Parameters<typeof client.proposeAction>
                ) => {
                    const hooks = route(args[0]);
                    if (hooks === undefined)
                        return client.proposeAction(...args);
                    const template = args[1];
                    const response = await hooks.prompt({
                        type: "proposal",
                        templateAgentName: template.templateAgentName,
                        templateName: template.templateName,
                        schema: template.defaultTemplate,
                        data: template.templateData,
                        templates: template,
                    });
                    if (response.type !== "proposal")
                        throw new Error("Invalid proposal response");
                    return response.accepted ? response.data : undefined;
                };
            }
            if (key === "getUserContext") {
                return (
                    ...args: Parameters<
                        NonNullable<typeof client.getUserContext>
                    >
                ) =>
                    route(args[0]) === undefined
                        ? client.getUserContext?.(...args)
                        : Promise.resolve(undefined);
            }
            return Reflect.get(target, key, receiver);
        },
    });
}
