// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { context as otelContext } from "@opentelemetry/api";
import type { FullAction } from "@typeagent/agent-cache";
import type {
    ActionContext,
    ActionResult,
    DisplayContent,
} from "@typeagent/agent-sdk";
import { getStructuredFallback } from "@typeagent/agent-sdk/helpers/display";
import { convert as htmlToText } from "html-to-text";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { validateAction } from "@typeagent/action-schema";
import { RpcDisconnectedError } from "@typeagent/agent-rpc/rpc";
import {
    QueueFullError,
    ServerStoppingError,
    type ExecuteActionRequest,
    type ContinueActionRequest,
    type CancelActionRequest,
    type StructuredActionExecutionResult,
    type StructuredActionError,
    type StructuredActionPrompt,
    type StructuredActionResponse,
    type ActionContract,
} from "@typeagent/dispatcher-types";
import type { CommandHandlerContext } from "../context/commandHandlerContext.js";
import type { executeActions } from "../execute/actionHandlers.js";
import type { getActionContext } from "../execute/actionContext.js";
import { getAppAgentName } from "../translation/agentTranslators.js";
import type { StructuredActionDiscovery } from "./discovery.js";
import {
    installStructuredInteractionRouting,
    registerStructuredActionCleanup,
    runStructuredExecution,
    type StructuredExecutionHooks,
} from "./executionHooks.js";
import {
    immutable,
    keys,
    nonempty,
    object,
    validateJson,
    validateResponse,
} from "./validation.js";

const OPERATION_TTL = 10 * 60_000;
const MAX_OPERATIONS = 100;

// The facade supplies its existing engine entry points. Keeping the state
// machine independent of engine imports avoids a dispatcher/barrel cycle.
type ExecutionRuntime = {
    executeActions: typeof executeActions;
    getActionContext: typeof getActionContext;
};

type FailureStatus =
    | "failed"
    | "contract_stale"
    | "unavailable"
    | "cancelled"
    | "execution_uncertain";

class ExecutionFailure extends Error {
    constructor(
        readonly code: StructuredActionError["code"],
        message: string,
        readonly status: FailureStatus = "failed",
    ) {
        super(message);
    }
}

function binding(discovery: StructuredActionDiscovery) {
    let current: ReturnType<StructuredActionDiscovery["bindScope"]>;
    try {
        current = discovery.bindScope();
    } catch {
        throw new ExecutionFailure(
            "invalid_scope",
            "Structured action access is no longer active",
        );
    }
    if (current.policy?.canExecute === false) {
        throw new ExecutionFailure(
            "unavailable",
            "Structured action execution is not enabled for this connection",
            "unavailable",
        );
    }
    return current;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

type PendingPrompt = {
    id: string;
    prompt: StructuredActionPrompt;
    answer: ReturnType<typeof deferred<StructuredActionResponse>>;
};

type Registry = {
    closed: boolean;
    disposed: ReturnType<typeof deferred<void>>;
    live: Map<string, Operation>;
    terminal: Map<
        string,
        { operation: Operation; timer: ReturnType<typeof setTimeout> }
    >;
};
const registries = new WeakMap<CommandHandlerContext, Registry>();

function registryFor(context: CommandHandlerContext): Registry {
    let registry = registries.get(context);
    if (registry === undefined) {
        registry = {
            closed: false,
            disposed: deferred(),
            live: new Map(),
            terminal: new Map(),
        };
        registries.set(context, registry);
        const current = registry;
        registerStructuredActionCleanup(context, () => {
            current.closed = true;
            for (const operation of current.live.values())
                operation.cancel("Dispatcher closed");
            for (const record of current.terminal.values())
                clearTimeout(record.timer);
            current.terminal.clear();
            current.disposed.resolve();
        });
    }
    return registry;
}

function requestEnvelope(
    value: unknown,
    allowed: string[],
): asserts value is Record<string, unknown> {
    validateJson(value);
    object(value);
    keys(value, ["protocolVersion", "scopeId", ...allowed]);
    if (value.protocolVersion !== 1)
        throw new Error("Unsupported structured action protocol version");
    nonempty(value.scopeId, "scopeId");
}

function failure(
    scopeId: string,
    operationId: string,
    error: unknown,
): StructuredActionExecutionResult {
    const cause =
        error instanceof ExecutionFailure
            ? error
            : new ExecutionFailure(
                  "invalid_request",
                  error instanceof Error ? error.message : String(error),
              );
    return {
        protocolVersion: 1,
        scopeId,
        operationId,
        status: cause.status,
        error: { code: cause.code, message: cause.message },
        output: [],
        results: [],
    };
}

class Operation implements StructuredExecutionHooks {
    readonly id = randomUUID();
    readonly expiresAt = Date.now() + OPERATION_TTL;
    readonly session: object;
    readonly scope: object;
    readonly request: ExecuteActionRequest;
    readonly results: StructuredActionExecutionResult["results"] = [];
    readonly output: string[] = [];
    pending: PendingPrompt | undefined;
    terminal: StructuredActionExecutionResult | undefined;
    discovery: StructuredActionDiscovery;
    private delivery = deferred<StructuredActionExecutionResult>();
    private readonly contracts = new Map<string, ActionContract>();
    private readonly approved = new WeakSet<FullAction>();
    private possibleEffects = false;
    private promptTail: Promise<void> = Promise.resolve();
    private queuedPrompts = 0;
    private timer: ReturnType<typeof setTimeout>;

    constructor(
        readonly context: CommandHandlerContext,
        discovery: StructuredActionDiscovery,
        request: ExecuteActionRequest,
        private readonly registry: Registry,
        private readonly runtime: ExecutionRuntime,
    ) {
        this.discovery = discovery;
        this.request = immutable(request);
        this.session = context.session;
        this.scope = binding(discovery).policy?.scope ?? discovery;
        this.timer = setTimeout(
            () => this.cancel("Operation expired", "interaction_expired"),
            OPERATION_TTL,
        );
        this.timer.unref();
    }

    authorize(discovery = this.discovery): void {
        const current = binding(discovery);
        if (
            this.context.session !== this.session ||
            current.envelope.scopeId !== this.request.scopeId ||
            (current.policy?.scope ?? discovery) !== this.scope
        ) {
            throw new ExecutionFailure(
                "invalid_scope",
                "Operation belongs to a different scope or Session",
            );
        }
    }

    private checkLive(): void {
        if (this.terminal !== undefined)
            throw new DOMException("Operation ended", "AbortError");
        this.context.currentAbortSignal?.throwIfAborted();
        this.authorize();
        if (Date.now() >= this.expiresAt) {
            this.cancel("Operation expired", "interaction_expired");
            throw new DOMException("Operation expired", "AbortError");
        }
    }

    private contract(action: FullAction): ActionContract {
        this.checkLive();
        // Meta actions invoke translation, reasoning, or implicit context binding.
        if (getAppAgentName(action.schemaName) === "dispatcher") {
            throw new ExecutionFailure(
                "unavailable",
                "Dispatcher meta actions are not structured executable actions",
                "unavailable",
            );
        }
        const result = this.discovery.getActionContractSnapshot(action);
        this.checkLive();
        if (result.status !== "found")
            throw new ExecutionFailure(
                "unavailable",
                "Action is unavailable",
                "unavailable",
            );
        const contract = result.contract;
        const key = `${action.schemaName}\0${action.actionName}`;
        const expected =
            this.contracts.get(key)?.fingerprint ??
            (action.schemaName === this.request.schemaName &&
            action.actionName === this.request.actionName
                ? this.request.fingerprint
                : contract.fingerprint);
        if (
            result.scopeId !== this.request.scopeId ||
            contract.fingerprint !== expected
        ) {
            throw new ExecutionFailure(
                "contract_stale",
                "Action contract changed; discover and submit a new action",
                "contract_stale",
            );
        }
        const availability = contract.availability;
        if (availability.state !== "available") {
            throw new ExecutionFailure(
                "unavailable",
                availability.message ??
                    `Action is ${availability.state}. Configure or refresh '${getAppAgentName(action.schemaName)}' before retrying.`,
                "unavailable",
            );
        }
        if (
            this.context.agents
                .getFlow(action.schemaName, action.actionName)
                ?.steps.some((step) => step.type === "script")
        ) {
            throw new ExecutionFailure(
                "unavailable",
                "Flow contains a script step without a discoverable action contract",
                "unavailable",
            );
        }
        const config = this.context.agents.tryGetActionConfig(
            action.schemaName,
        );
        const definition =
            config === undefined
                ? undefined
                : this.context.agents
                      .getActionSchemaFileForConfig(config)
                      .parsedActionSchema.actionSchemas.get(action.actionName);
        if (definition === undefined)
            throw new ExecutionFailure(
                "unavailable",
                "Action schema is unavailable",
                "unavailable",
            );
        const { entities: _entities, ...input } = action as FullAction & {
            entities?: unknown;
        };
        validateAction(definition, input);
        this.contracts.set(key, immutable(contract));
        return contract;
    }

    async guard(
        action: FullAction,
        _phase: "prepare" | "enter",
    ): Promise<void> {
        const contract = this.contract(action);
        if (!this.approved.has(action)) {
            if (
                contract.policy.effects !== "read-only" ||
                contract.policy.confirmation === "required"
            ) {
                const response = await this.prompt({
                    type: "confirmation",
                    action: {
                        protocolVersion: 1,
                        scopeId: this.request.scopeId,
                        schemaName: action.schemaName,
                        actionName: action.actionName,
                        fingerprint: contract.fingerprint,
                        ...(action.parameters === undefined
                            ? {}
                            : { parameters: action.parameters }),
                    },
                    contract,
                });
                if (response.type !== "confirmation" || !response.approved) {
                    this.cancel("Action was not approved");
                    throw new DOMException(
                        "Action was not approved",
                        "AbortError",
                    );
                }
                this.contract(action);
            }
            this.approved.add(action);
        }
        this.checkLive();
    }

    effect(action?: FullAction, possibleEffects = true): void {
        this.checkLive();
        this.revalidate();
        // Internal result references may survive preparation, but never entry.
        if (action?.parameters !== undefined)
            validateJson(action.parameters, true);
        this.possibleEffects ||= possibleEffects;
    }

    result(action: FullAction, result: ActionResult): void {
        if (this.terminal !== undefined) return;
        this.results.push({
            action: structuredClone(action),
            result: structuredClone(result),
        });
        if (result.error !== undefined) this.display(result.error);
        else if (result.historyText !== undefined)
            this.display(result.historyText);
        else if (result.displayContent !== undefined)
            this.display(result.displayContent);
    }

    display(content: DisplayContent): void {
        if (this.terminal !== undefined) return;
        let text: string;
        if (typeof content === "string") text = content;
        else if (Array.isArray(content))
            text = content
                .map((item) => (Array.isArray(item) ? item.join(" ") : item))
                .join("\n");
        else if (content.type === "structured") {
            this.display(getStructuredFallback(content, "text"));
            return;
        } else {
            const alternate = content.alternates?.find(
                (item) => item.type === "text" || item.type === "markdown",
            );
            const value = alternate?.content ?? content.content;
            text =
                typeof value === "string"
                    ? value
                    : value
                          .map((item) =>
                              Array.isArray(item) ? item.join(" ") : item,
                          )
                          .join("\n");
            if (alternate === undefined && content.type === "html")
                text = htmlToText(text);
        }
        if (text.length > 0 && this.output[this.output.length - 1] !== text)
            this.output.push(text);
    }

    async choice(
        action: FullAction,
        initial: ActionResult,
        actionContext: ActionContext<unknown>,
    ): Promise<ActionResult> {
        let result = initial;
        const agentName = getAppAgentName(action.schemaName);
        const agent = this.context.agents.getAppAgent(agentName);
        const additionalActions =
            initial.error === undefined
                ? [...(initial.additionalActions ?? [])]
                : [];
        while (
            result.error === undefined &&
            result.pendingChoice !== undefined
        ) {
            const { choiceId, ...prompt } = result.pendingChoice;
            try {
                const response = await this.prompt(prompt);
                await this.guard(action, "enter");
                if (agent.handleChoice === undefined)
                    throw new Error(
                        "Agent does not support choice continuation",
                    );
                const answer = choiceAnswer(response);
                this.effect(action);
                result = structuredClone(
                    (await agent.handleChoice(
                        choiceId,
                        answer,
                        actionContext,
                    )) ?? createActionResultNoDisplay("Choice completed."),
                );
                if (
                    this.terminal !== undefined &&
                    result.error === undefined &&
                    result.pendingChoice !== undefined
                ) {
                    await agent.cancelChoice?.(
                        result.pendingChoice.choiceId,
                        actionContext.sessionContext,
                    );
                }
                this.checkLive();
                this.result(action, result);
                if (result.error === undefined)
                    additionalActions.push(...(result.additionalActions ?? []));
            } finally {
                await agent.cancelChoice?.(
                    choiceId,
                    actionContext.sessionContext,
                );
            }
        }
        return result.error === undefined && additionalActions.length > 0
            ? { ...result, additionalActions }
            : result;
    }

    async prompt(
        prompt: StructuredActionPrompt,
    ): Promise<StructuredActionResponse> {
        this.checkLive();
        if (this.queuedPrompts >= MAX_OPERATIONS)
            throw new ExecutionFailure(
                "queue_full",
                "Too many pending interactions",
                "unavailable",
            );
        const snapshot = immutable(prompt);
        this.queuedPrompts++;
        const answer = this.promptTail.then(() => this.showPrompt(snapshot));
        this.promptTail = answer.then(
            () => undefined,
            () => undefined,
        );
        try {
            return await answer;
        } finally {
            this.queuedPrompts--;
        }
    }

    private async showPrompt(
        prompt: StructuredActionPrompt,
    ): Promise<StructuredActionResponse> {
        this.checkLive();
        if (this.pending !== undefined)
            throw new Error("An operation already has a pending interaction");
        const pending: PendingPrompt = {
            id: randomUUID(),
            prompt: immutable(prompt),
            answer: deferred(),
        };
        this.pending = pending;
        this.context.requestQueue.markBlocked(this.id, "interaction");
        this.publish({
            ...this.envelope(),
            status: "requires_interaction",
            interactionId: pending.id,
            expiresAt: this.expiresAt,
            prompt: pending.prompt,
        });
        try {
            const response = await pending.answer.promise;
            this.checkLive();
            this.revalidate();
            return response;
        } finally {
            if (this.pending === pending) this.pending = undefined;
            this.context.requestQueue.markUnblocked(this.id);
        }
    }

    private revalidate(): void {
        for (const saved of this.contracts.values()) {
            this.checkLive();
            const current = this.discovery.getActionContractSnapshot(saved);
            this.checkLive();
            if (
                current.status !== "found" ||
                current.contract.fingerprint !== saved.fingerprint
            ) {
                throw new ExecutionFailure(
                    "contract_stale",
                    "Contract changed while awaiting an interaction",
                    "contract_stale",
                );
            }
            if (current.contract.availability.state !== "available") {
                throw new ExecutionFailure(
                    "unavailable",
                    "Action is no longer available",
                    "unavailable",
                );
            }
        }
    }

    continue(
        request: ContinueActionRequest,
        discovery: StructuredActionDiscovery,
    ): Promise<StructuredActionExecutionResult> {
        this.authorize(discovery);
        if (this.terminal !== undefined)
            return Promise.resolve(structuredClone(this.terminal));
        const pending = this.pending;
        if (pending === undefined || pending.id !== request.interactionId) {
            throw new ExecutionFailure(
                "interaction_consumed",
                "Interaction is missing or already consumed",
            );
        }
        if (Date.now() >= this.expiresAt) {
            this.cancel("Operation expired", "interaction_expired");
            return this.wait();
        }
        validateResponse(pending.prompt, request.response);
        const answer = immutable(request.response);
        // Claim synchronously, after validation and before any await.
        this.discovery = discovery;
        this.pending = undefined;
        const next = this.wait();
        pending.answer.resolve(answer);
        return next;
    }

    wait(): Promise<StructuredActionExecutionResult> {
        return this.terminal === undefined
            ? this.delivery.promise.then((result) => structuredClone(result))
            : Promise.resolve(structuredClone(this.terminal));
    }

    private envelope() {
        return {
            protocolVersion: 1 as const,
            scopeId: this.request.scopeId,
            operationId: this.id,
            output: structuredClone(this.output),
            results: structuredClone(this.results),
        };
    }

    private publish(result: StructuredActionExecutionResult): void {
        const delivery = this.delivery;
        this.delivery = deferred();
        delivery.resolve(result);
    }

    finish(error?: unknown): void {
        if (this.terminal !== undefined) return;
        if (
            error === undefined &&
            this.context.currentRequestId?.requestId === this.id &&
            this.context.commandResult?.disposition?.status === "failed"
        ) {
            error = new ExecutionFailure(
                "execution_failed",
                this.context.commandResult.lastError ??
                    "A nested command failed",
            );
        }
        const result =
            error === undefined
                ? { ...this.envelope(), status: "completed" as const }
                : {
                      ...failure(
                          this.request.scopeId,
                          this.id,
                          error instanceof ExecutionFailure
                              ? error
                              : new ExecutionFailure(
                                    "execution_failed",
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                                ),
                      ),
                      output: structuredClone(this.output),
                      results: structuredClone(this.results),
                  };
        this.terminal = result;
        if (this.context.currentRequestId?.requestId === this.id) {
            const command = (this.context.commandResult ??= {});
            command.disposition =
                result.status === "completed"
                    ? { status: "handled", path: "action" }
                    : {
                          status: "failed",
                          path: "action",
                          mayHaveSideEffects: this.possibleEffects,
                      };
            if (
                result.status === "cancelled" ||
                result.status === "execution_uncertain"
            )
                command.cancelled = true;
            if ("error" in result) command.lastError = result.error.message;
        }
        clearTimeout(this.timer);
        this.pending?.answer.reject(
            new DOMException("Operation ended", "AbortError"),
        );
        this.pending = undefined;
        this.publish(result);
    }

    cancel(
        message: string,
        code: StructuredActionError["code"] = "cancelled",
    ): void {
        if (this.terminal !== undefined) return;
        this.finish(
            new ExecutionFailure(
                code,
                message,
                this.possibleEffects ? "execution_uncertain" : "cancelled",
            ),
        );
        const queue = this.context.requestQueue;
        if (!queue.cancelQueued(this.id, "user")) {
            queue.cancelRunning(this.id, "user");
            this.context.activeRequests.get(this.id)?.abort();
        }
    }

    retire(): void {
        this.registry.live.delete(this.id);
        if (this.registry.closed) return;
        const timer = setTimeout(
            () => this.registry.terminal.delete(this.id),
            OPERATION_TTL,
        );
        timer.unref();
        this.registry.terminal.set(this.id, { operation: this, timer });
        while (this.registry.terminal.size > MAX_OPERATIONS) {
            const oldest = this.registry.terminal.entries().next().value!;
            clearTimeout(oldest[1].timer);
            this.registry.terminal.delete(oldest[0]);
        }
    }

    async run(): Promise<void> {
        if (this.terminal !== undefined) return;
        const signal = this.context.currentAbortSignal;
        const aborted = () => this.cancel("Execution cancelled");
        signal?.addEventListener("abort", aborted, { once: true });
        try {
            await runStructuredExecution(
                this.context,
                this.id,
                this,
                async () => {
                    const action = {
                        schemaName: this.request.schemaName,
                        actionName: this.request.actionName,
                        ...(this.request.parameters === undefined
                            ? {}
                            : {
                                  parameters: structuredClone(
                                      this.request.parameters,
                                  ),
                              }),
                    } as FullAction;
                    // Validate before even creating an ActionContext or resolving entities.
                    await this.guard(action, "prepare");
                    const { actionContext, closeActionContext } =
                        this.runtime.getActionContext(
                            "dispatcher",
                            this.context,
                            { requestId: this.id },
                            0,
                        );
                    try {
                        const error = await this.runtime.executeActions(
                            [{ action }],
                            undefined,
                            actionContext as ActionContext<CommandHandlerContext>,
                        );
                        this.checkLive();
                        if (error !== undefined)
                            throw new ExecutionFailure(
                                "execution_failed",
                                error.error,
                            );
                        if (this.results.length === 0)
                            throw new ExecutionFailure(
                                "execution_failed",
                                "Action handler was not entered",
                            );
                        this.finish();
                    } finally {
                        closeActionContext();
                    }
                },
            );
        } catch (error) {
            if (error instanceof RpcDisconnectedError) {
                this.finish(
                    new ExecutionFailure(
                        "execution_state_lost",
                        "Agent transport was lost; completion is unknown. Close this dispatcher before starting new work; do not replay.",
                        "execution_uncertain",
                    ),
                );
                // A disconnected worker may still be executing. Stop admission
                // and retain the shared lock until this context is destroyed.
                void this.context.requestQueue.drainAndStop();
                await this.registry.disposed.promise;
            } else if (signal?.aborted) this.cancel("Execution cancelled");
            else this.finish(error);
        } finally {
            signal?.removeEventListener("abort", aborted);
        }
    }
}

function choiceAnswer(response: StructuredActionResponse) {
    switch (response.type) {
        case "yesNo":
            return response.value;
        case "multiChoice":
            return response.selected;
        case "pickRemember":
            return { selected: response.selected, remember: response.remember };
        case "form":
            return response.value;
        default:
            throw new Error("Invalid SDK choice response");
    }
}

export class StructuredActionExecution {
    private readonly registry: Registry;
    constructor(
        private readonly context: CommandHandlerContext,
        private readonly discovery: StructuredActionDiscovery,
        private readonly runtime: ExecutionRuntime,
        private readonly connectionId?: string,
    ) {
        this.registry = registryFor(context);
    }

    async executeAction(
        input: ExecuteActionRequest,
    ): Promise<StructuredActionExecutionResult> {
        let operation: Operation | undefined;
        try {
            requestEnvelope(input, [
                "schemaName",
                "actionName",
                "fingerprint",
                "parameters",
            ]);
            nonempty(input.schemaName, "schemaName");
            nonempty(input.actionName, "actionName");
            nonempty(input.fingerprint, "fingerprint");
            if (input.parameters !== undefined) {
                object(input.parameters);
                validateJson(input.parameters, true);
            }
            const request = immutable(input);
            if (this.registry.closed) throw new ServerStoppingError();
            if (binding(this.discovery).envelope.scopeId !== request.scopeId)
                throw new ExecutionFailure(
                    "invalid_scope",
                    "Invalid structured action scope",
                );
            installStructuredInteractionRouting(this.context);
            if (this.registry.live.size >= MAX_OPERATIONS)
                throw new QueueFullError(MAX_OPERATIONS);
            operation = new Operation(
                this.context,
                this.discovery,
                request,
                this.registry,
                this.runtime,
            );
            this.registry.live.set(operation.id, operation);
            const response = operation.wait();
            const current = operation;
            const entry = this.context.requestQueue.submit({
                text: `Structured action: ${request.schemaName}.${request.actionName}`,
                requestId: operation.id,
                originatorConnectionId: this.connectionId ?? "",
                options: { noReasoning: true },
                ...(this.context.telemetryOptions.joinActiveTrace
                    ? { traceContext: otelContext.active() }
                    : {}),
                work: { kind: "structured-action", run: () => current.run() },
            });
            void entry.completion.then(
                (result) => {
                    if (result?.cancelled)
                        current.cancel("Execution cancelled");
                    else current.finish();
                    current.retire();
                },
                (error: unknown) => {
                    current.finish(error);
                    current.retire();
                },
            );
            return await response;
        } catch (error) {
            const cause =
                error instanceof QueueFullError
                    ? new ExecutionFailure(
                          "queue_full",
                          "Structured action queue is full",
                          "unavailable",
                      )
                    : error instanceof ServerStoppingError
                      ? new ExecutionFailure(
                            "server_stopping",
                            "Dispatcher is stopping",
                            "unavailable",
                        )
                      : error;
            if (operation !== undefined) {
                operation.finish(cause);
                operation.retire();
                return operation.wait();
            }
            return failure(
                typeof input?.scopeId === "string" ? input.scopeId : "",
                "",
                cause,
            );
        }
    }

    async continueAction(
        input: ContinueActionRequest,
    ): Promise<StructuredActionExecutionResult> {
        try {
            requestEnvelope(input, [
                "operationId",
                "interactionId",
                "response",
            ]);
            nonempty(input.operationId, "operationId");
            nonempty(input.interactionId, "interactionId");
            const request = immutable(input);
            return await this.find(request).continue(request, this.discovery);
        } catch (error) {
            return failure(
                typeof input?.scopeId === "string" ? input.scopeId : "",
                typeof input?.operationId === "string" ? input.operationId : "",
                error instanceof ExecutionFailure
                    ? error
                    : new ExecutionFailure(
                          "invalid_response",
                          error instanceof Error
                              ? error.message
                              : String(error),
                      ),
            );
        }
    }

    async cancelAction(
        input: CancelActionRequest,
    ): Promise<StructuredActionExecutionResult> {
        try {
            requestEnvelope(input, ["operationId", "interactionId"]);
            nonempty(input.operationId, "operationId");
            if (input.interactionId !== undefined)
                nonempty(input.interactionId, "interactionId");
            const operation = this.find(input);
            if (
                input.interactionId !== undefined &&
                operation.pending?.id !== input.interactionId
            ) {
                throw new ExecutionFailure(
                    "interaction_consumed",
                    "Interaction is missing or already consumed",
                );
            }
            operation.cancel("Execution cancelled");
            return await operation.wait();
        } catch (error) {
            return failure(
                typeof input?.scopeId === "string" ? input.scopeId : "",
                typeof input?.operationId === "string" ? input.operationId : "",
                error,
            );
        }
    }

    private find(input: { scopeId: string; operationId: string }): Operation {
        if (binding(this.discovery).envelope.scopeId !== input.scopeId)
            throw new ExecutionFailure(
                "invalid_scope",
                "Invalid structured action scope",
            );
        const operation =
            this.registry.live.get(input.operationId) ??
            this.registry.terminal.get(input.operationId)?.operation;
        if (operation === undefined)
            throw new ExecutionFailure(
                "execution_state_lost",
                "Execution state is unavailable; do not replay the action",
                "execution_uncertain",
            );
        operation.authorize(this.discovery);
        return operation;
    }
}
