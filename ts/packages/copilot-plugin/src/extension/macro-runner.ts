// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import type { PreToolUseOutput } from "@typeagent/agent-harness-hooks/copilot-cli";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { InspectMacroRequest } from "@typeagent/copilot-macros";
import {
    markMacroRunnerSession,
    clearMacroRunnerSession,
} from "../shared/macro-runner-bridge.js";

export const macroRunnerName = "typeagent-macro-runner";
export const hostMacroRunnerName = "typeagent-macro-runner-host";
const launchSchema = z
    .object({
        agent: z.literal("typeagent-macro-runner"),
        macro: z
            .object({
                macroId: z.string().min(1),
                version: z.number().int().positive(),
                state: z.literal("approved"),
            })
            .passthrough(),
        inputs: z.record(z.unknown()),
        budgets: z.object({
            maxToolCalls: z.number().int().positive(),
            maxRetries: z.number().int().min(0),
            timeoutMs: z.number().finite().positive(),
            maxTokens: z.number().int().positive(),
        }),
        candidate: z.object({
            sourceMacroId: z.string().min(1),
            sourceVersion: z.number().int().positive(),
            handoffRunId: z.string().min(1),
        }),
    })
    .passthrough();

export interface MacroRunnerDependencies {
    inspect: (request: InspectMacroRequest) => Promise<unknown>;
    execute: CopilotSession["rpc"]["tools"]["execute"];
    cancel: CopilotSession["rpc"]["tasks"]["cancel"];
    subscribe: (handler: (event: SessionEvent) => void) => () => void;
}

export async function executeNativeMacro(
    payload: unknown,
    submittedAt: number,
    signal: AbortSignal,
    observer: MacroRunnerObserver,
    dependencies: MacroRunnerDependencies,
): Promise<string> {
    const launch = launchSchema.parse(payload);
    if (
        launch.candidate.sourceMacroId !== launch.macro.macroId ||
        launch.candidate.sourceVersion !== launch.macro.version
    ) {
        throw new Error(
            "Macro launch provenance does not match its immutable version.",
        );
    }

    const toolCallId = `typeagent-macro-${launch.candidate.handoffRunId}`;
    observer.begin(submittedAt, toolCallId);
    let childId: string | undefined;
    let cancelPromise: Promise<unknown> | undefined;
    const abort = new AbortController();
    const timeout = setTimeout(
        () => abort.abort(new Error("Macro execution timed out.")),
        Math.min(launch.budgets.timeoutMs, 270000),
    );
    const executionSignal = AbortSignal.any([signal, abort.signal]);
    const cancel = () => {
        if (childId) {
            cancelPromise ??= dependencies.cancel({ id: childId });
            void cancelPromise.catch((error: unknown) =>
                console.error(
                    `[macro-host] Cancellation failed: ${String(error)}`,
                ),
            );
        }
    };
    const unsubscribe = dependencies.subscribe((event) => {
        if (
            event.type === "subagent.started" &&
            event.data.toolCallId === toolCallId
        ) {
            childId = event.agentId;
            if (executionSignal.aborted) cancel();
        }
    });
    executionSignal.addEventListener("abort", cancel, { once: true });
    try {
        executionSignal.throwIfAborted();
        const macro = launchSchema.shape.macro.parse(
            await dependencies.inspect({
                macroId: launch.macro.macroId,
                version: launch.macro.version,
                requireRunnable: true,
            }),
        );
        executionSignal.throwIfAborted();
        if (!isDeepStrictEqual(macro, launch.macro)) {
            throw new Error(
                "Macro launch does not match the approved catalog version.",
            );
        }
        const hostValidation = {
            source: "native-host-catalog",
            macroId: macro.macroId,
            version: macro.version,
        };
        observer.catalogValidated(macro.macroId, macro.version);
        const result = await dependencies.execute({
            name: "task",
            toolCallId,
            arguments: {
                agent_type: `typeagent:${hostMacroRunnerName}`,
                name: "macro-runner",
                description: "Execute approved macro",
                prompt:
                    "The native TypeAgent host has already inspected and validated the exact approved catalog macro below. Do not call inspect_macro or perform another catalog lookup. Execute strictly one recorded step at a time under live permissions. Resolve bindings from current inputs and completed actual step results; a binding overrides any captured example argument. Never start a dependent step speculatively or in parallel. Keep all tool discovery, budgets, guards, and postconditions.\n\n" +
                    JSON.stringify({
                        status: "agentRequired",
                        launch,
                        hostValidation,
                    }),
                mode: "sync",
            },
        });
        executionSignal.throwIfAborted();
        if (typeof result !== "string" && result.resultType !== "success") {
            throw new Error(result.error ?? result.textResultForLlm);
        }
        return await observer.waitForAnswer(executionSignal);
    } finally {
        clearTimeout(timeout);
        executionSignal.removeEventListener("abort", cancel);
        unsubscribe();
        await cancelPromise;
    }
}

function isRunner(name: string): boolean {
    return [macroRunnerName, hostMacroRunnerName].some(
        (runner) => name === runner || name === `typeagent:${runner}`,
    );
}

function isHostRunner(name: string): boolean {
    return (
        name === hostMacroRunnerName ||
        name === `typeagent:${hostMacroRunnerName}`
    );
}

const phaseNames: Partial<Record<SessionEvent["type"], string>> = {
    "tool.execution_start": "started",
    "tool.execution_complete": "completed",
    "assistant.turn_start": "runner.turn.started",
    "assistant.turn_end": "runner.turn.completed",
    "permission.requested": "permission.requested",
    "permission.completed": "permission.completed",
    "subagent.started": "subagent.started",
    "subagent.completed": "subagent.completed",
    "subagent.failed": "subagent.failed",
};

export class MacroRunnerObserver {
    private readonly runners = new Set<string>();
    private readonly deniedRunners = new Map<string, string>();
    private readonly verifiedRunners = new Set<string>();
    private readonly hostRunners = new Set<string>();
    private readonly phases: Array<{ phase: string; elapsedMs: number }> = [];
    private readonly calls = new Map<string, string>();
    private startedAt: number | undefined;
    private delegationDenied = false;
    private toolCallId: string | undefined;
    private childId: string | undefined;
    private response: string | undefined;
    private completed = false;
    private settled = false;
    private childCount = 0;
    private notifyCompletion: (() => void) | undefined;
    private catalogValidation: { macroId: string; version: number } | undefined;

    public begin(submittedAt = Date.now(), toolCallId?: string): void {
        this.startedAt = submittedAt;
        this.phases.length = 0;
        this.calls.clear();
        this.delegationDenied = false;
        this.toolCallId = toolCallId;
        this.childId = undefined;
        this.response = undefined;
        this.completed = false;
        this.settled = false;
        this.childCount = 0;
        this.catalogValidation = undefined;
        this.phases.push({
            phase: "host.dispatch",
            elapsedMs: Date.now() - submittedAt,
        });
    }

    public catalogValidated(macroId: string, version: number): void {
        if (this.startedAt === undefined) {
            throw new Error("Macro host measurement has not started.");
        }
        this.catalogValidation = { macroId, version };
        this.phases.push({
            phase: "host.catalog-validated",
            elapsedMs: Date.now() - this.startedAt,
        });
    }

    public record(event: SessionEvent): void {
        if (
            event.type === "subagent.started" &&
            event.agentId &&
            isRunner(event.data.agentName)
        ) {
            this.runners.add(event.agentId);
            if (isHostRunner(event.data.agentName)) {
                this.hostRunners.add(event.agentId);
            }
            markMacroRunnerSession(event.agentId);
            if (event.data.toolCallId === this.toolCallId) {
                this.childId = event.agentId;
                this.childCount++;
                if (this.catalogValidation) {
                    this.verifiedRunners.add(event.agentId);
                }
            }
        }
        if (!event.agentId || !this.runners.has(event.agentId)) return;
        if (
            event.agentId === this.childId &&
            event.type === "assistant.message"
        ) {
            this.response = event.data.content;
        }
        if (
            event.agentId === this.childId &&
            event.type === "subagent.completed"
        ) {
            this.completed = event.data.cancelled !== true;
        }
        if (event.type === "tool.execution_start") {
            this.calls.set(event.data.toolCallId, event.data.toolName);
        }
        const toolName =
            event.type === "tool.execution_start" ||
            event.type === "tool.execution_complete"
                ? this.calls.get(event.data.toolCallId)
                : undefined;
        const label = toolName?.endsWith("inspect_macro")
            ? "inspection"
            : "procedure-tool";
        const phase = phaseNames[event.type];
        if (phase && this.startedAt !== undefined) {
            this.phases.push({
                phase: toolName ? `${label}.${phase}` : phase,
                elapsedMs: Math.max(
                    0,
                    Date.parse(event.timestamp) - this.startedAt,
                ),
            });
        }
        if (
            event.type === "subagent.completed" ||
            event.type === "subagent.failed"
        ) {
            if (event.agentId === this.childId) this.settled = true;
            this.runners.delete(event.agentId);
            this.deniedRunners.delete(event.agentId);
            this.verifiedRunners.delete(event.agentId);
            this.hostRunners.delete(event.agentId);
            clearMacroRunnerSession(event.agentId);
        }
        this.notifyCompletion?.();
    }

    public guard(
        sessionId: string,
        toolName: string,
    ): PreToolUseOutput | undefined {
        if (!this.runners.has(sessionId)) return undefined;
        if (
            ["task", "run_factory", "run_workflow", "write_agent"].includes(
                toolName,
            )
        ) {
            this.delegationDenied = true;
            this.deniedRunners.set(
                sessionId,
                "Macro runners must execute their own steps; nested delegation is not permitted. Stop and report this failure.",
            );
        }
        if (
            this.hostRunners.has(sessionId) &&
            !this.verifiedRunners.has(sessionId)
        ) {
            this.deniedRunners.set(
                sessionId,
                "Macro catalog verification is required before executing steps. A prompt's hostValidation marker is not authorization. Stop and report this failure.",
            );
        }
        const reason = this.deniedRunners.get(sessionId);
        if (reason !== undefined) {
            return {
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            };
        }
        return undefined;
    }

    public assertNoDelegation(): void {
        if (this.delegationDenied) {
            throw new Error(
                "Macro runner attempted nested delegation; execution is not accepted.",
            );
        }
    }

    public answer(): string {
        this.assertNoDelegation();
        if (
            this.childCount !== 1 ||
            !this.completed ||
            !this.response?.trim()
        ) {
            throw new Error(
                "Macro runner did not complete exactly once with a user-facing answer.",
            );
        }
        return this.response;
    }

    public waitForAnswer(signal: AbortSignal): Promise<string> {
        return new Promise((resolve, reject) => {
            const onAbort = () => finish(signal.reason);
            const finish = (error?: unknown) => {
                this.notifyCompletion = undefined;
                signal.removeEventListener("abort", onAbort);
                if (error) reject(error);
                else {
                    try {
                        resolve(this.answer());
                    } catch (failure) {
                        reject(failure);
                    }
                }
            };
            this.notifyCompletion = () => {
                if (this.settled) finish();
            };
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
            else this.notifyCompletion();
        });
    }

    public report(): string {
        return JSON.stringify({
            kind: "typeagent-macro-phases",
            elapsedMs:
                this.startedAt === undefined
                    ? undefined
                    : Date.now() - this.startedAt,
            phases: this.phases,
            catalogValidation: this.catalogValidation,
        });
    }

    public close(): void {
        for (const runner of this.runners) clearMacroRunnerSession(runner);
        this.runners.clear();
        this.deniedRunners.clear();
        this.verifiedRunners.clear();
        this.hostRunners.clear();
    }
}
