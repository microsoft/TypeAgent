// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    MacroManager,
    type CopilotToolMacro,
    type MacroLearningRuntime,
    type MacroProgramRuntime,
    type ReplayToolHost,
    type RunMacroResponse,
} from "@typeagent/copilot-macros";
import { matchMacroGrammarInputs } from "@typeagent/copilot-macros/macroAuthoringRuntime";
import { z } from "zod";
import type { MacroOwnerConnection } from "../shared/macro-owner.js";
import { getRecipeOwner } from "../shared/plugin-config.js";
import {
    localRecipeDirectory,
    localRecipeScope,
} from "../shared/recipe-local-paths.js";
import { startLocalRecipeBroker } from "../shared/recipe-transport.js";

const id = z.string().min(1).max(4096);
const ref = z
    .object({
        macroId: id,
        version: z.number().int().positive().optional(),
        requireRunnable: z.boolean().optional(),
    })
    .strict();
const mode = z.enum(["off", "prepare", "read-only", "all"]);
const recordedTrace = z
    .object({
        schemaVersion: z.union([z.literal(1), z.literal(2)]),
        capabilities: z
            .tuple([z.literal("private-result-evidence-v1")])
            .optional(),
        sessionId: id,
        cwd: id,
        prompt: z.string(),
        response: z.string(),
        startedAt: id,
        completedAt: id,
        toolCalls: z.array(
            z
                .object({
                    toolCallId: id,
                    name: id,
                    mcpServerName: id.optional(),
                    arguments: z.unknown().optional(),
                    result: z.unknown().optional(),
                    modelResult: z.unknown().optional(),
                    permission: z.unknown().optional(),
                    status: z.enum(["completed", "failed", "denied"]),
                })
                .strict(),
        ),
    })
    .strict();
const finalize = z
    .object({
        tokenId: id,
        trace: recordedTrace,
        childAuthoring: z
            .object({
                taskId: id,
                firstEventId: id,
                successEventId: id,
                outputEventId: id,
                recordingTokenId: id,
            })
            .strict()
            .optional(),
    })
    .strict();

export type LocalRecipeMatch =
    | { status: "miss" }
    | { status: "ambiguous"; message: string }
    | { status: "handled"; result: RunMacroResponse };

function operation<S extends z.ZodTypeAny>(
    schema: S,
    handler: (args: z.output<S>) => unknown,
): (args: unknown[]) => Promise<unknown> {
    return async (args) => handler(schema.parse(args));
}

function defined<T extends Record<string, unknown>>(
    value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as { [K in keyof T]: Exclude<T[K], undefined> };
}

export interface LocalRecipeServiceOptions {
    cwd: string;
    sessionId: string;
    replayHost: ReplayToolHost;
    learning: (
        loadApproved: () => Promise<CopilotToolMacro[]>,
    ) => MacroLearningRuntime;
    program: MacroProgramRuntime;
    report(message: string): void;
}

export async function createLocalRecipeService(
    options: LocalRecipeServiceOptions,
) {
    const scope = localRecipeScope(options.cwd);
    const manager = new MacroManager(
        localRecipeDirectory(options.cwd),
        options.replayHost,
        scope.profileId,
    );
    let closed = false;
    function active() {
        if (closed || getRecipeOwner() !== "plugin")
            throw new Error(
                "The local recipe owner is inactive; reload after changing ownership.",
            );
    }
    function workspace(cwd: string) {
        active();
        if (localRecipeScope(cwd).workspaceId !== scope.workspaceId)
            throw new Error("The recipe request belongs to another workspace.");
    }
    function session(sessionId: string) {
        active();
        if (sessionId !== options.sessionId)
            throw new Error(
                "The recipe request belongs to another native session.",
            );
    }
    const connection: MacroOwnerConnection = {
        getMacroLearningPreference: async (cwd) => {
            workspace(cwd);
            return manager.getMacroLearningPreference(cwd);
        },
        setMacroLearningPreference: async (request) => {
            workspace(request.cwd);
            return manager.setMacroLearningPreference(request);
        },
        getMacroLearningJob: (id) => manager.getMacroLearningJob(id),
        cancelMacroLearningJob: (id) => manager.cancelMacroLearningJob(id),
        armMacroRecording: async (request) => {
            session(request.sessionId);
            workspace(request.cwd ?? options.cwd);
            return manager.armRecording(request);
        },
        getMacroRecordingState: async (id) => {
            session(id);
            return manager.getRecordingState(id);
        },
        claimMacroRecording: async (request) => {
            session(request.sessionId);
            workspace(request.cwd);
            return manager.claimRecording(request);
        },
        cancelMacroRecording: async (id) => {
            session(id);
            manager.cancelRecording(id);
        },
        failMacroRecording: async (id, token, error) => {
            session(id);
            manager.failRecording(id, token, error);
        },
        finalizeMacroRecording: async (request) => {
            session(request.trace.sessionId);
            workspace(request.trace.cwd);
            return manager.finalizeRecording(request);
        },
        listMacros: (request) => manager.listMacros(request),
        searchMacros: (request) => manager.searchMacros(request),
        inspectMacro: (request) => manager.inspectMacro(request),
        getMacroRequirements: (request) =>
            manager.getMacroRequirements(request),
        validateMacro: (request) => manager.validateMacro(request),
        approveMacro: (request) => manager.approveMacro(request),
        reviseMacro: (request) => manager.reviseMacro(request),
        disableMacro: (request) => manager.disableMacro(request),
        deleteMacro: (request) => manager.deleteMacro(request),
        runMacro: (request) => {
            active();
            return manager.runMacro(request);
        },
        cancelMacroRun: async (id) => manager.cancelMacroRun(id),
        getMacroRun: (id) => manager.getMacroRun(id),
        close: async () => {},
    };
    async function matchAndRun(
        prompt: string,
        runId: string,
    ): Promise<LocalRecipeMatch> {
        active();
        const candidates = [];
        for (const macro of await manager.getApprovedMacros()) {
            if (!macro.learning?.grammarRules.length || !macro.program)
                continue;
            for (const inputs of matchMacroGrammarInputs(macro, prompt)) {
                candidates.push({ macro, inputs });
            }
        }
        if (!candidates.length) return { status: "miss" };
        if (candidates.length !== 1)
            return {
                status: "ambiguous",
                message:
                    "Several saved recipes match. Select one explicitly; no task tools were called.",
            };
        const { macro, inputs } = candidates[0];
        return {
            status: "handled",
            result: await connection.runMacro({
                macroId: macro.macroId,
                version: macro.version,
                runId,
                inputs,
            }),
        };
    }
    const methods: Record<string, (args: unknown[]) => Promise<unknown>> = {
        getMacroLearningPreference: operation(z.tuple([id]), ([cwd]) =>
            connection.getMacroLearningPreference(cwd),
        ),
        setMacroLearningPreference: operation(
            z.tuple([z.object({ cwd: id, mode }).strict()]),
            ([request]) => connection.setMacroLearningPreference(request),
        ),
        getMacroLearningJob: operation(z.tuple([id]), ([id]) =>
            connection.getMacroLearningJob(id),
        ),
        cancelMacroLearningJob: operation(z.tuple([id]), ([id]) =>
            connection.cancelMacroLearningJob(id),
        ),
        armMacroRecording: operation(
            z.tuple([
                z
                    .object({
                        sessionId: id,
                        cwd: id.optional(),
                        ttlMs: z.number().positive().max(600_000).optional(),
                        learning: z.boolean().optional(),
                    })
                    .strict(),
            ]),
            ([request]) => connection.armMacroRecording(defined(request)),
        ),
        getMacroRecordingState: operation(z.tuple([id]), ([id]) =>
            connection.getMacroRecordingState(id),
        ),
        claimMacroRecording: operation(
            z.tuple([
                z
                    .object({
                        sessionId: id,
                        cwd: id,
                        promptHash: z.string().regex(/^[a-f0-9]{64}$/),
                    })
                    .strict(),
            ]),
            ([request]) => connection.claimMacroRecording(request),
        ),
        cancelMacroRecording: operation(z.tuple([id]), ([id]) =>
            connection.cancelMacroRecording(id),
        ),
        failMacroRecording: operation(
            z.tuple([id, id, z.string().max(4096)]),
            ([id, token, error]) =>
                connection.failMacroRecording(id, token, error),
        ),
        finalizeMacroRecording: operation(z.tuple([finalize]), ([request]) =>
            connection.finalizeMacroRecording(
                defined({
                    ...request,
                    trace: defined({
                        ...request.trace,
                        toolCalls: request.trace.toolCalls.map(defined),
                    }),
                }),
            ),
        ),
        listMacros: operation(
            z.tuple([
                z
                    .object({
                        state: z
                            .enum(["draft", "approved", "disabled"])
                            .optional(),
                        limit: z.number().int().positive().max(500).optional(),
                    })
                    .strict()
                    .nullish(),
            ]),
            ([request]) =>
                connection.listMacros(request ? defined(request) : undefined),
        ),
        searchMacros: operation(
            z.tuple([
                z
                    .object({
                        query: z.string().max(16_384),
                        limit: z.number().int().positive().max(500).optional(),
                    })
                    .strict(),
            ]),
            ([request]) => connection.searchMacros(defined(request)),
        ),
        inspectMacro: operation(z.tuple([ref]), ([request]) =>
            connection.inspectMacro(defined(request)),
        ),
        getMacroRequirements: operation(z.tuple([ref]), ([request]) =>
            connection.getMacroRequirements(defined(request)),
        ),
        validateMacro: operation(z.tuple([ref]), ([request]) =>
            connection.validateMacro(defined(request)),
        ),
        approveMacro: operation(z.tuple([ref]), ([request]) =>
            connection.approveMacro(defined(request)),
        ),
        reviseMacro: operation(
            z.tuple([
                z
                    .object({
                        macroId: id,
                        version: z.number().int().positive(),
                        feedback: z.string().trim().min(1).max(16_384),
                    })
                    .strict(),
            ]),
            ([request]) => connection.reviseMacro(request),
        ),
        disableMacro: operation(
            z.tuple([z.object({ macroId: id }).strict()]),
            ([request]) => connection.disableMacro(request),
        ),
        deleteMacro: operation(
            z.tuple([z.object({ macroId: id }).strict()]),
            ([request]) => connection.deleteMacro(request),
        ),
        runMacro: operation(
            z.tuple([
                ref
                    .extend({
                        runId: id,
                        inputs: z.record(z.unknown()).optional(),
                        timeoutMs: z.number().positive().max(60_000).optional(),
                        dryRun: z.boolean().optional(),
                    })
                    .strict(),
            ]),
            ([request]) => connection.runMacro(defined(request)),
        ),
        cancelMacroRun: operation(z.tuple([id]), ([id]) =>
            connection.cancelMacroRun(id),
        ),
        getMacroRun: operation(z.tuple([id]), ([id]) =>
            connection.getMacroRun(id),
        ),
        matchAndRun: operation(
            z.tuple([z.string().max(1_048_576), id]),
            ([prompt, id]) => matchAndRun(prompt, id),
        ),
    };
    const dispatch = async (method: string, args: unknown[]) => {
        active();
        if (!Object.prototype.hasOwnProperty.call(methods, method))
            throw new Error("Unsupported local recipe operation.");
        return methods[method](args);
    };
    const broker = await startLocalRecipeBroker(
        options.cwd,
        options.sessionId,
        dispatch,
        options.report,
    );
    try {
        manager.configureProgramRuntime(options.program);
        await manager.configureLearning(
            options.learning(() => manager.getApprovedMacros()),
        );
    } catch (error) {
        try {
            await manager.close();
        } finally {
            await broker.close();
        }
        throw error;
    }
    return {
        connection,
        authoringConnection: {
            ...connection,
            claimMacroAuthoringRequest: (
                claim: Parameters<
                    MacroManager["claimMacroAuthoringRequest"]
                >[0],
            ) => {
                session(claim.sessionId);
                workspace(claim.cwd);
                return manager.claimMacroAuthoringRequest(claim);
            },
            submitMacroAuthoringResponse: (
                submission: Parameters<
                    MacroManager["submitMacroAuthoringResponse"]
                >[0],
            ) => {
                session(submission.sessionId);
                workspace(submission.cwd);
                return manager.submitMacroAuthoringResponse(submission);
            },
        },
        matchAndRun,
        dispatch,
        async close() {
            closed = true;
            try {
                await manager.close();
            } finally {
                await broker.close();
            }
        },
    };
}
