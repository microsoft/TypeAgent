// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentInitSettings,
    CompletionDirection,
    CompletionGroups,
    ParameterDefinitions,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
    Storage,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import {
    type CommandHandler,
    type CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import type {
    IngestionMode,
    IngestionJobStatus,
    JobState,
    MemoryEvidence,
    MemoryService,
    SourceReplaceRequest,
} from "@typeagent/memory-service";
import { waitForMemoryJob } from "@typeagent/memory-service/rpc";
import { type ImportBatchManifest, importMarkdownPath } from "./importer.js";
import type { MemoryAction } from "./memorySchema.js";

interface ClearPreview {
    corpusId: string;
    confirmationToken: string;
    expiresAt: number;
}

interface ImportBatchState {
    corpusId: string;
    profile: ImportPipelineProfile | null;
    pipeline: ImportPipelineOptions;
    controller?: AbortController;
    jobIds: Set<string>;
    promise?: Promise<ImportBatchManifest>;
    manifest?: ImportBatchManifest;
    error?: string;
    cancellationRequested?: boolean;
}

interface PersistedImportBatch {
    batchId: string;
    corpusId: string;
    profile: ImportPipelineProfile | null;
    pipeline: ImportPipelineOptions;
    jobIds: string[];
    manifest?: ImportBatchManifest;
    error?: string;
    cancellationRequested?: boolean;
}

interface ReplacePreview {
    corpusId: string;
    sourceId: string;
    expectedActiveRevisionId: string;
    absolutePath: string;
    contentHash: string;
    confirmationToken: string;
    expiresAt: number;
}

export interface MemoryAgentContext {
    service: MemoryService;
    activeCorpusId?: string;
    clearPreview?: ClearPreview;
    replacePreview?: ReplacePreview;
    sessionStorage?: Storage;
    imports: Map<string, ImportBatchState>;
    importPersistence?: Promise<void>;
    lastAnswerEvidence?: {
        question: string;
        answer: string;
        citations: MemoryEvidence[];
        indexVersion: string;
    };
}

type Params = ParsedCommandParams<ParameterDefinitions>;
type PartialParams = PartialParsedCommandParams<ParameterDefinitions>;
type CompletionProvider = (
    context: MemoryAgentContext,
    params: PartialParams,
    names: string[],
    direction?: CompletionDirection,
) => Promise<CompletionGroups>;

const ACTIVE_CORPUS_STORAGE_PATH = "memory-agent-active-corpus.txt";
const IMPORT_BATCHES_STORAGE_PATH = "memory-agent-import-batches.json";

export type ImportPipelineProfile = "fast" | "balanced" | "deep";

interface ImportPipelineOptions {
    readonly mode: IngestionMode;
    readonly maxCharsPerChunk: number;
}

export const importPipelineProfiles: Readonly<
    Record<ImportPipelineProfile, ImportPipelineOptions>
> = {
    fast: { mode: "basic", maxCharsPerChunk: 8_000 },
    balanced: { mode: "content", maxCharsPerChunk: 4_000 },
    deep: { mode: "full", maxCharsPerChunk: 2_000 },
};

const defaultImportPipeline: ImportPipelineOptions = {
    mode: "content",
    maxCharsPerChunk: 8_000,
};

class ImportStorageStateError extends Error {
    public readonly cause: unknown;

    public constructor(message: string, cause?: unknown) {
        super(message);
        this.name = "ImportStorageStateError";
        this.cause = cause;
    }
}

function markdown(value: unknown): ActionResult {
    const text =
        typeof value === "string"
            ? value
            : `\`\`\`json\n${JSON.stringify(value, undefined, 2)}\n\`\`\``;
    return createActionResultFromMarkdownDisplay(text);
}

function memoryContext(
    context: ActionContext<unknown> | SessionContext<unknown>,
): MemoryAgentContext {
    return "sessionContext" in context
        ? (context.sessionContext.agentContext as MemoryAgentContext)
        : (context.agentContext as MemoryAgentContext);
}

function args(params: Params): Record<string, unknown> {
    return (params.args ?? {}) as Record<string, unknown>;
}

function flags(params: Params): Record<string, unknown> {
    return (params.flags ?? {}) as Record<string, unknown>;
}

function stringValue(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function optionalStringArray(
    value: unknown,
    name: string,
): readonly string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === "string")
    ) {
        throw new Error(`${name} must contain only strings`);
    }
    return value;
}

function booleanValue(value: unknown): boolean {
    return value === true;
}

function requireActiveCorpus(context: MemoryAgentContext): string {
    if (context.activeCorpusId === undefined) {
        throw new Error(
            "No active corpus. Use '@memory corpus use <corpusId>' first.",
        );
    }
    return context.activeCorpusId;
}

function isMemoryService(value: unknown): value is MemoryService {
    return (
        typeof value === "object" &&
        value !== null &&
        "createCorpus" in value &&
        typeof value.createCorpus === "function" &&
        "search" in value &&
        typeof value.search === "function"
    );
}

function getMemoryService(options: unknown): MemoryService | undefined {
    if (isMemoryService(options)) {
        return options;
    }
    if (
        typeof options === "object" &&
        options !== null &&
        "memoryServiceClient" in options &&
        isMemoryService(options.memoryServiceClient)
    ) {
        return options.memoryServiceClient;
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function isImportPipelineProfile(
    value: unknown,
): value is ImportPipelineProfile {
    return value === "fast" || value === "balanced" || value === "deep";
}

function isImportPipelineOptions(
    value: unknown,
): value is ImportPipelineOptions {
    return (
        isRecord(value) &&
        (value.mode === "basic" ||
            value.mode === "summary" ||
            value.mode === "content" ||
            value.mode === "full") &&
        typeof value.maxCharsPerChunk === "number" &&
        Number.isSafeInteger(value.maxCharsPerChunk) &&
        value.maxCharsPerChunk > 0
    );
}

function isImportBatchManifest(value: unknown): value is ImportBatchManifest {
    if (!isRecord(value) || !Array.isArray(value.files)) {
        return false;
    }
    return (
        typeof value.batchId === "string" &&
        typeof value.corpusId === "string" &&
        typeof value.root === "string" &&
        typeof value.startedAt === "string" &&
        typeof value.completedAt === "string" &&
        typeof value.discovered === "number" &&
        typeof value.accepted === "number" &&
        typeof value.failed === "number" &&
        typeof value.totalBytes === "number" &&
        typeof value.cancelled === "boolean" &&
        value.files.every(
            (file) =>
                isRecord(file) &&
                typeof file.relativePath === "string" &&
                isOptionalString(file.sourceId) &&
                isOptionalString(file.jobId) &&
                isOptionalString(file.state) &&
                (file.unchanged === undefined ||
                    typeof file.unchanged === "boolean") &&
                isOptionalString(file.error),
        )
    );
}

function parsePersistedImportBatch(
    value: unknown,
    index: number,
): PersistedImportBatch {
    if (
        !isRecord(value) ||
        typeof value.batchId !== "string" ||
        typeof value.corpusId !== "string" ||
        (value.profile !== null && !isImportPipelineProfile(value.profile)) ||
        !isImportPipelineOptions(value.pipeline) ||
        !Array.isArray(value.jobIds) ||
        !value.jobIds.every((jobId) => typeof jobId === "string") ||
        (value.manifest !== undefined &&
            !isImportBatchManifest(value.manifest)) ||
        !isOptionalString(value.error) ||
        (value.cancellationRequested !== undefined &&
            typeof value.cancellationRequested !== "boolean")
    ) {
        throw new ImportStorageStateError(
            `Invalid memory import storage: batch entry ${index} is invalid.`,
        );
    }
    if (
        value.manifest !== undefined &&
        (value.manifest.batchId !== value.batchId ||
            value.manifest.corpusId !== value.corpusId)
    ) {
        throw new ImportStorageStateError(
            `Invalid memory import storage: batch entry ${index} does not match its manifest.`,
        );
    }
    return {
        batchId: value.batchId,
        corpusId: value.corpusId,
        profile: value.profile,
        pipeline: value.pipeline,
        jobIds: value.jobIds,
        ...(value.manifest === undefined ? {} : { manifest: value.manifest }),
        ...(value.error === undefined ? {} : { error: value.error }),
        ...(value.cancellationRequested === undefined
            ? {}
            : { cancellationRequested: value.cancellationRequested }),
    };
}

async function persistImportBatches(
    context: MemoryAgentContext,
): Promise<void> {
    if (context.sessionStorage === undefined) {
        return;
    }
    const batches: PersistedImportBatch[] = [...context.imports.entries()].map(
        ([batchId, batch]) => ({
            batchId,
            corpusId: batch.corpusId,
            profile: batch.profile,
            pipeline: batch.pipeline,
            jobIds: [...batch.jobIds],
            ...(batch.manifest === undefined
                ? {}
                : { manifest: batch.manifest }),
            ...(batch.error === undefined ? {} : { error: batch.error }),
            ...(batch.cancellationRequested === undefined
                ? {}
                : { cancellationRequested: batch.cancellationRequested }),
        }),
    );
    await context.sessionStorage.write(
        IMPORT_BATCHES_STORAGE_PATH,
        JSON.stringify({ version: 1, batches }),
        "utf8",
    );
}

function queueImportPersistence(context: MemoryAgentContext): Promise<void> {
    const persist = () => persistImportBatches(context);
    context.importPersistence = (
        context.importPersistence ?? Promise.resolve()
    ).then(persist, persist);
    return context.importPersistence;
}

async function restoreImportBatches(
    context: MemoryAgentContext,
): Promise<void> {
    const storage = context.sessionStorage;
    if (
        storage === undefined ||
        !(await storage.exists(IMPORT_BATCHES_STORAGE_PATH))
    ) {
        return;
    }
    const serialized = await storage.read(IMPORT_BATCHES_STORAGE_PATH, "utf8");
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch (error: unknown) {
        throw new ImportStorageStateError(
            "Invalid memory import storage: malformed JSON.",
            error,
        );
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.batches)) {
        throw new ImportStorageStateError(
            "Invalid memory import storage: expected a versioned batch list.",
        );
    }
    if (parsed.version !== 1) {
        throw new ImportStorageStateError(
            `Unsupported memory import storage version '${String(parsed.version)}'.`,
        );
    }
    const persistedBatches = parsed.batches.map((value, index) =>
        parsePersistedImportBatch(value, index),
    );
    const batchIds = new Set<string>();
    for (const persisted of persistedBatches) {
        if (batchIds.has(persisted.batchId)) {
            throw new ImportStorageStateError(
                `Invalid memory import storage: duplicate batch '${persisted.batchId}'.`,
            );
        }
        batchIds.add(persisted.batchId);
    }
    for (const persisted of persistedBatches) {
        const existing = context.imports.get(persisted.batchId);
        if (existing !== undefined) {
            for (const jobId of persisted.jobIds) {
                existing.jobIds.add(jobId);
            }
            if (
                existing.manifest === undefined &&
                persisted.manifest !== undefined
            ) {
                existing.manifest = persisted.manifest;
            }
            if (existing.error === undefined && persisted.error !== undefined) {
                existing.error = persisted.error;
            }
            existing.profile = persisted.profile;
            if (existing.controller === undefined) {
                existing.pipeline = persisted.pipeline;
            }
            existing.cancellationRequested =
                existing.cancellationRequested === true ||
                persisted.cancellationRequested === true;
            continue;
        }
        context.imports.set(persisted.batchId, {
            corpusId: persisted.corpusId,
            profile: persisted.profile,
            pipeline: persisted.pipeline,
            jobIds: new Set(persisted.jobIds),
            ...(persisted.manifest === undefined
                ? {}
                : { manifest: persisted.manifest }),
            ...(persisted.error === undefined
                ? {}
                : { error: persisted.error }),
            ...(persisted.cancellationRequested === undefined
                ? {}
                : {
                      cancellationRequested: persisted.cancellationRequested,
                  }),
        });
    }
}

async function initializeMemoryContext(
    settings?: AppAgentInitSettings,
): Promise<MemoryAgentContext> {
    const service = getMemoryService(settings?.options);
    if (service === undefined) {
        throw new Error(
            "The memory agent requires a MemoryService or { memoryServiceClient } in AppAgentInitSettings.options.",
        );
    }
    await service.initialize?.();
    return {
        service,
        imports: new Map(),
    };
}

async function updateMemoryContext(
    enable: boolean,
    context: SessionContext<MemoryAgentContext>,
): Promise<void> {
    if (!enable) {
        delete context.agentContext.sessionStorage;
        delete context.agentContext.clearPreview;
        delete context.agentContext.replacePreview;
        return;
    }
    if (context.sessionStorage === undefined) {
        delete context.agentContext.sessionStorage;
    } else {
        context.agentContext.sessionStorage = context.sessionStorage;
    }
    if (
        context.sessionStorage !== undefined &&
        (await context.sessionStorage.exists(ACTIVE_CORPUS_STORAGE_PATH))
    ) {
        const corpusId = (
            await context.sessionStorage.read(
                ACTIVE_CORPUS_STORAGE_PATH,
                "utf8",
            )
        ).trim();
        if (corpusId.length === 0) {
            delete context.agentContext.activeCorpusId;
        } else {
            context.agentContext.activeCorpusId = corpusId;
        }
    }
    await restoreImportBatches(context.agentContext);
    if (context.agentContext.imports.size > 0) {
        await queueImportPersistence(context.agentContext);
    }
}

async function setActiveCorpus(
    context: MemoryAgentContext,
    corpusId: string,
): Promise<void> {
    context.activeCorpusId = corpusId;
    await context.sessionStorage?.write(
        ACTIVE_CORPUS_STORAGE_PATH,
        corpusId,
        "utf8",
    );
}

async function closeMemoryContext(
    context: SessionContext<unknown>,
): Promise<void> {
    const state = memoryContext(context);
    for (const batch of state.imports.values()) {
        batch.controller?.abort(new Error("Memory agent session closed"));
    }
    await Promise.allSettled(
        [...state.imports.values()].flatMap((batch) =>
            batch.promise === undefined ? [] : [batch.promise],
        ),
    );
    await state.importPersistence;
}

function parameters(
    definition: ParameterDefinitions,
    run: (
        context: MemoryAgentContext,
        params: Params,
    ) => Promise<ActionResult | undefined>,
    getCompletion?: CompletionProvider,
): CommandHandler {
    return {
        description: "Run a memory operation",
        parameters: definition,
        run: (context, params) => run(memoryContext(context), params),
        ...(getCompletion === undefined
            ? {}
            : {
                  getCompletion: (
                      context: SessionContext<unknown>,
                      params: PartialParams,
                      names: string[],
                      direction?: CompletionDirection,
                  ) =>
                      getCompletion(
                          memoryContext(context),
                          params,
                          names,
                          direction,
                      ),
              }),
    };
}

function noParameters(
    description: string,
    run: (context: MemoryAgentContext) => Promise<ActionResult | undefined>,
) {
    return {
        description,
        run: (context: ActionContext<unknown>) => run(memoryContext(context)),
    };
}

function completionGroups(
    names: string[],
    argumentName: string,
    completions: string[],
): CompletionGroups {
    return {
        groups: names
            .filter((name) => name === argumentName)
            .map((name) => ({
                name,
                completions: [...new Set(completions)],
                kind: "entity",
                needQuotes: true,
            })),
    };
}

async function corpusCompletions(
    context: MemoryAgentContext,
    _params: PartialParams,
    names: string[],
): Promise<CompletionGroups> {
    const corpora = await context.service.listCorpora();
    return completionGroups(
        names,
        "corpusId",
        corpora.flatMap((corpus) => [corpus.corpusId, corpus.name]),
    );
}

async function sourceCompletions(
    context: MemoryAgentContext,
    _params: PartialParams,
    names: string[],
): Promise<CompletionGroups> {
    const sources =
        context.activeCorpusId === undefined
            ? []
            : await context.service.listSources(context.activeCorpusId);
    return completionGroups(
        names,
        "sourceId",
        sources.map((source) => source.sourceId),
    );
}

async function jobCompletions(
    context: MemoryAgentContext,
    _params: PartialParams,
    names: string[],
): Promise<CompletionGroups> {
    const jobs = await context.service.listJobs(
        context.activeCorpusId === undefined
            ? {}
            : { corpusId: context.activeCorpusId },
    );
    return completionGroups(
        names,
        "jobId",
        jobs.items.map((job) => job.jobId),
    );
}

async function importBatchCompletions(
    context: MemoryAgentContext,
    _params: PartialParams,
    names: string[],
): Promise<CompletionGroups> {
    await restoreImportBatches(context);
    return completionGroups(names, "batchId", [...context.imports.keys()]);
}

async function importProfileCompletions(
    _context: MemoryAgentContext,
    _params: PartialParams,
    names: string[],
): Promise<CompletionGroups> {
    return completionGroups(
        names,
        "profile",
        Object.keys(importPipelineProfiles),
    );
}

async function resolveCorpus(context: MemoryAgentContext, idOrName: string) {
    const direct = await context.service.getCorpus(idOrName);
    if (direct !== undefined) {
        return direct;
    }
    const matches = (await context.service.listCorpora()).filter(
        (corpus) => corpus.name === idOrName,
    );
    if (matches.length > 1) {
        throw new Error(
            `Corpus name '${idOrName}' is ambiguous; use a corpus ID.`,
        );
    }
    return matches[0];
}

const corpusCommands: CommandHandlerTable = {
    description: "Create, select, inspect, and clear memory corpora",
    commands: {
        create: parameters(
            {
                args: {
                    name: { description: "Corpus name" },
                    description: {
                        description: "Corpus description",
                        optional: true,
                        implicitQuotes: true,
                    },
                },
            },
            async (context, params) => {
                const corpus = await context.service.createCorpus(
                    stringValue(args(params).name, "corpus name"),
                    optionalString(args(params).description),
                );
                await setActiveCorpus(context, corpus.corpusId);
                return markdown(corpus);
            },
        ),
        list: noParameters("List corpora", async (context) =>
            markdown(await context.service.listCorpora()),
        ),
        use: parameters(
            {
                args: {
                    corpusId: { description: "Corpus ID or name" },
                },
            },
            async (context, params) => {
                const idOrName = stringValue(
                    args(params).corpusId,
                    "corpus ID or name",
                );
                const corpus = await resolveCorpus(context, idOrName);
                if (corpus === undefined) {
                    throw new Error(`Unknown corpus '${idOrName}'`);
                }
                await setActiveCorpus(context, corpus.corpusId);
                return markdown(`Active memory corpus: \`${corpus.corpusId}\``);
            },
            corpusCompletions,
        ),
        info: parameters(
            {
                args: {
                    corpusId: {
                        description:
                            "Corpus ID or name (defaults to active corpus)",
                        optional: true,
                    },
                },
            },
            async (context, params) => {
                const idOrName =
                    optionalString(args(params).corpusId) ??
                    requireActiveCorpus(context);
                const corpus = await resolveCorpus(context, idOrName);
                if (corpus === undefined) {
                    throw new Error(`Unknown corpus '${idOrName}'`);
                }
                return markdown(corpus);
            },
            corpusCompletions,
        ),
        clear: parameters(
            {
                flags: {
                    confirm: {
                        description: "Confirmation token from the preview",
                        type: "string",
                    },
                },
            },
            async (context, params) => {
                const corpusId = requireActiveCorpus(context);
                const confirmation = optionalString(flags(params).confirm);
                if (confirmation === undefined) {
                    const corpus = await context.service.getCorpus(corpusId);
                    if (corpus === undefined) {
                        throw new Error(`Unknown corpus '${corpusId}'`);
                    }
                    context.clearPreview = {
                        corpusId,
                        confirmationToken: randomUUID(),
                        expiresAt: Date.now() + 5 * 60_000,
                    };
                    return markdown({
                        operation: "clear corpus",
                        corpusId,
                        sourceCount: corpus.sourceCount,
                        revisionCount: corpus.revisionCount,
                        confirmationToken:
                            context.clearPreview.confirmationToken,
                        expiresAt: new Date(
                            context.clearPreview.expiresAt,
                        ).toISOString(),
                    });
                }
                const preview = context.clearPreview;
                if (
                    preview === undefined ||
                    preview.corpusId !== corpusId ||
                    preview.confirmationToken !== confirmation ||
                    preview.expiresAt < Date.now()
                ) {
                    throw new Error(
                        "Invalid or expired confirmation token. Run the clear preview again.",
                    );
                }
                const deleted = await context.service.clearCorpus(corpusId);
                delete context.clearPreview;
                return markdown(
                    `Cleared ${deleted} source(s) from \`${corpusId}\`.`,
                );
            },
        ),
    },
};

const importParameters = {
    args: {
        path: {
            description: "Markdown file or folder path",
            implicitQuotes: true,
        },
    },
    flags: {
        recursive: { description: "Traverse subfolders", default: false },
        include: {
            description: "Include glob (repeatable)",
            multiple: true,
            type: "string",
        },
        exclude: {
            description: "Exclude glob (repeatable)",
            multiple: true,
            type: "string",
        },
        maxFiles: { description: "Maximum file count", type: "number" },
        maxBytes: { description: "Maximum total bytes", type: "number" },
        concurrency: {
            description: "Maximum concurrent ingestions",
            type: "number",
        },
        profile: {
            description: "Ingestion profile: fast, balanced, or deep",
            type: "string",
        },
        wait: { description: "Wait for ingestion jobs", default: false },
    },
} as const;

function getImportPipelineProfile(value: unknown): {
    profile: ImportPipelineProfile | null;
    pipeline: ImportPipelineOptions;
} {
    if (value === undefined) {
        return { profile: null, pipeline: defaultImportPipeline };
    }
    switch (value) {
        case "fast":
            return {
                profile: "fast",
                pipeline: importPipelineProfiles.fast,
            };
        case "balanced":
            return {
                profile: "balanced",
                pipeline: importPipelineProfiles.balanced,
            };
        case "deep":
            return {
                profile: "deep",
                pipeline: importPipelineProfiles.deep,
            };
        default:
            throw new Error(
                `Unknown import profile '${String(value)}'. Choose fast, balanced, or deep.`,
            );
    }
}

async function beginImport(
    context: MemoryAgentContext,
    params: Params,
    expectedKind: "file" | "folder",
): Promise<ActionResult> {
    const batchId = randomUUID();
    const controller = new AbortController();
    const path = stringValue(args(params).path, "path");
    const importFlags = flags(params);
    const { profile, pipeline } = getImportPipelineProfile(importFlags.profile);
    const include = optionalStringArray(importFlags.include, "include");
    const exclude = optionalStringArray(importFlags.exclude, "exclude");
    const maxFiles = optionalNumber(importFlags.maxFiles);
    const maxTotalBytes = optionalNumber(importFlags.maxBytes);
    const concurrency = optionalNumber(importFlags.concurrency);
    const corpusId = requireActiveCorpus(context);
    const jobIds = new Set<string>();
    const batch: ImportBatchState = {
        corpusId,
        profile,
        pipeline,
        controller,
        jobIds,
    };
    context.imports.set(batchId, batch);
    await queueImportPersistence(context);
    const promise = importMarkdownPath(context.service, {
        batchId,
        corpusId,
        path,
        expectedKind,
        recursive: booleanValue(importFlags.recursive),
        wait: booleanValue(importFlags.wait),
        ...(include === undefined ? {} : { include }),
        ...(exclude === undefined ? {} : { exclude }),
        ...(maxFiles === undefined ? {} : { maxFiles }),
        ...(maxTotalBytes === undefined ? {} : { maxTotalBytes }),
        ...(concurrency === undefined ? {} : { concurrency }),
        pipeline,
        signal: controller.signal,
        onJobAccepted: async (jobId) => {
            jobIds.add(jobId);
            try {
                await queueImportPersistence(context);
            } catch (error: unknown) {
                try {
                    await context.service.cancelJob(jobId);
                } catch (cancellationError: unknown) {
                    throw new ImportStorageStateError(
                        `Failed to persist accepted memory job '${jobId}' and failed to cancel it.`,
                        { persistenceError: error, cancellationError },
                    );
                }
                throw error;
            }
            if (controller.signal.aborted) {
                await context.service.cancelJob(jobId);
            }
        },
    });
    const completed = promise
        .then(async (manifest) => {
            batch.manifest = manifest;
            await queueImportPersistence(context);
            return manifest;
        })
        .catch(async (error: unknown) => {
            batch.error =
                error instanceof Error ? error.message : String(error);
            await queueImportPersistence(context);
            throw error;
        });
    batch.promise = completed;
    void completed.catch(() => undefined);
    if (booleanValue(importFlags.wait)) {
        return markdown(await completed);
    }
    return markdown({
        batchId,
        state: "running",
        profile,
        pipeline,
        status: `@memory import status ${batchId}`,
    });
}

const terminalJobStates = new Set<JobState>([
    "complete",
    "partial",
    "failed",
    "cancelled",
]);

interface ImportJobSummary {
    activeJobIds: string[];
    jobStates: Record<string, number>;
    missingJobs: number;
    unchangedJobs: number;
}

function summarizeImportJobs(
    jobEntries: { jobId: string; job: IngestionJobStatus | undefined }[],
): ImportJobSummary {
    const summary: ImportJobSummary = {
        activeJobIds: [],
        jobStates: {},
        missingJobs: 0,
        unchangedJobs: 0,
    };
    for (const { jobId, job } of jobEntries) {
        if (job === undefined) {
            summary.missingJobs++;
            continue;
        }
        summary.jobStates[job.state] = (summary.jobStates[job.state] ?? 0) + 1;
        if (!terminalJobStates.has(job.state)) {
            summary.activeJobIds.push(jobId);
        }
        if (job.progress.message === "Source is unchanged") {
            summary.unchangedJobs++;
        }
    }
    return summary;
}

function importBatchState(
    batch: ImportBatchState,
    summary: ImportJobSummary,
): string {
    if (batch.error !== undefined) {
        return "failed";
    }
    if (summary.activeJobIds.length > 0) {
        return batch.cancellationRequested ? "cancelling" : "running";
    }
    if (
        (batch.manifest?.failed ?? 0) > 0 ||
        (summary.jobStates.failed ?? 0) > 0 ||
        (summary.jobStates.partial ?? 0) > 0 ||
        summary.missingJobs > 0
    ) {
        return "partial";
    }
    if (
        (summary.jobStates.cancelled ?? 0) > 0 ||
        batch.manifest?.cancelled === true
    ) {
        return batch.cancellationRequested ? "cancelled" : "partial";
    }
    return "complete";
}

async function inspectImportBatch(
    context: MemoryAgentContext,
    batchId: string,
    batch: ImportBatchState,
): Promise<{
    status: unknown;
    activeJobIds: string[];
    terminal: boolean;
}> {
    if (batch.manifest === undefined && batch.jobIds.size === 0) {
        return {
            status: {
                batchId,
                state: batch.error === undefined ? "submitting" : "failed",
                acceptedJobs: 0,
                profile: batch.profile,
                pipeline: batch.pipeline,
                ...(batch.error === undefined ? {} : { error: batch.error }),
            },
            activeJobIds: [],
            terminal: batch.error !== undefined,
        };
    }
    const jobEntries = await Promise.all(
        [...batch.jobIds].map(async (jobId) => ({
            jobId,
            job: await context.service.getJob(jobId),
        })),
    );
    const summary = summarizeImportJobs(jobEntries);
    const failedJobs = summary.jobStates.failed ?? 0;
    const partialJobs = summary.jobStates.partial ?? 0;
    const cancelledJobs = summary.jobStates.cancelled ?? 0;
    return {
        status: {
            batchId,
            state: importBatchState(batch, summary),
            profile: batch.profile,
            pipeline: batch.pipeline,
            jobStates: summary.jobStates,
            failedJobs,
            partialJobs,
            cancelledJobs,
            unchangedJobs: summary.unchangedJobs,
            missingJobs: summary.missingJobs,
            ...(batch.error === undefined ? {} : { error: batch.error }),
            manifest: batch.manifest,
        },
        activeJobIds: summary.activeJobIds,
        terminal:
            summary.activeJobIds.length === 0 &&
            (batch.manifest !== undefined ||
                batch.error !== undefined ||
                (batch.controller === undefined &&
                    batch.promise === undefined &&
                    batch.jobIds.size > 0)),
    };
}

async function getImportBatchStatus(
    context: MemoryAgentContext,
    batchId: string,
    batch: ImportBatchState,
): Promise<unknown> {
    return (await inspectImportBatch(context, batchId, batch)).status;
}

const importCommands: CommandHandlerTable = {
    description: "Import Markdown files and manage import batches",
    commands: {
        file: parameters(
            importParameters,
            (context, params) => beginImport(context, params, "file"),
            importProfileCompletions,
        ),
        folder: parameters(
            importParameters,
            (context, params) => beginImport(context, params, "folder"),
            importProfileCompletions,
        ),
        status: parameters(
            {
                args: {
                    batchId: {
                        description: "Batch ID (omit to list batches)",
                        optional: true,
                    },
                },
            },
            async (context, params) => {
                await restoreImportBatches(context);
                const batchId = optionalString(args(params).batchId);
                if (batchId === undefined) {
                    return markdown(
                        await Promise.all(
                            [...context.imports.entries()].map(([id, batch]) =>
                                getImportBatchStatus(context, id, batch),
                            ),
                        ),
                    );
                }
                const batch = context.imports.get(batchId);
                if (batch === undefined) {
                    throw new Error(`Unknown import batch '${batchId}'`);
                }
                return markdown(
                    await getImportBatchStatus(context, batchId, batch),
                );
            },
            importBatchCompletions,
        ),
        cancel: parameters(
            {
                args: { batchId: { description: "Batch ID" } },
            },
            async (context, params) => {
                await restoreImportBatches(context);
                const batchId = stringValue(args(params).batchId, "batch ID");
                const batch = context.imports.get(batchId);
                if (batch === undefined) {
                    throw new Error(`Unknown import batch '${batchId}'`);
                }
                const inspection = await inspectImportBatch(
                    context,
                    batchId,
                    batch,
                );
                if (inspection.terminal) {
                    throw new Error(
                        `Import batch '${batchId}' is already terminal and cannot be cancelled.`,
                    );
                }
                batch.cancellationRequested = true;
                batch.controller?.abort(new Error("Import cancelled by user"));
                await Promise.all(
                    inspection.activeJobIds.map((jobId) =>
                        context.service.cancelJob(jobId),
                    ),
                );
                await queueImportPersistence(context);
                return markdown(
                    `Cancellation requested for import \`${batchId}\`.`,
                );
            },
            importBatchCompletions,
        ),
    },
};

async function replaceSource(
    context: MemoryAgentContext,
    sourceId: string,
    path: string,
    wait: boolean,
    confirmationToken?: string,
): Promise<ActionResult> {
    const corpusId = requireActiveCorpus(context);
    const source = await context.service.getSource(corpusId, sourceId);
    if (source === undefined) {
        throw new Error(`Unknown source '${sourceId}'`);
    }
    const absolutePath = await realpath(resolve(path));
    const pathInfo = await stat(absolutePath);
    if (!pathInfo.isFile() || !absolutePath.toLowerCase().endsWith(".md")) {
        throw new Error("Replacement must be a Markdown file");
    }
    const markdownContent = await readFile(absolutePath, "utf8");
    const contentHash = createHash("sha256")
        .update(markdownContent)
        .digest("hex");
    if (confirmationToken === undefined) {
        context.replacePreview = {
            corpusId,
            sourceId,
            expectedActiveRevisionId: source.activeRevisionId,
            absolutePath,
            contentHash,
            confirmationToken: randomUUID(),
            expiresAt: Date.now() + 5 * 60_000,
        };
        return markdown({
            operation: "replace source",
            corpusId,
            sourceId,
            currentRevisionId: source.activeRevisionId,
            replacementPath: absolutePath,
            replacementBytes: pathInfo.size,
            contentHash,
            confirmationToken: context.replacePreview.confirmationToken,
            expiresAt: new Date(context.replacePreview.expiresAt).toISOString(),
        });
    }
    const preview = context.replacePreview;
    if (
        preview === undefined ||
        preview.corpusId !== corpusId ||
        preview.sourceId !== sourceId ||
        preview.absolutePath !== absolutePath ||
        preview.contentHash !== contentHash ||
        preview.expectedActiveRevisionId !== source.activeRevisionId ||
        preview.confirmationToken !== confirmationToken ||
        preview.expiresAt < Date.now()
    ) {
        throw new Error(
            "Invalid, expired, or stale confirmation. Preview the replacement again.",
        );
    }
    const request: SourceReplaceRequest = {
        corpusId,
        sourceId,
        expectedActiveRevisionId: source.activeRevisionId,
        source: {
            sourceType: "markdown",
            title: basename(absolutePath),
            canonicalUri: pathToFileURL(absolutePath).href,
            markdown: markdownContent,
        },
    };
    const result = await context.service.replaceSource(request);
    delete context.replacePreview;
    return markdown(
        wait ? await waitForMemoryJob(context.service, result.jobId) : result,
    );
}

const sourceCommands: CommandHandlerTable = {
    description: "Inspect, replace, and forget sources",
    commands: {
        list: noParameters(
            "List sources in the active corpus",
            async (context) =>
                markdown(
                    await context.service.listSources(
                        requireActiveCorpus(context),
                    ),
                ),
        ),
        show: parameters(
            {
                args: { sourceId: { description: "Source ID" } },
                flags: {
                    offset: { description: "Content offset", type: "number" },
                    maxChars: {
                        description: "Maximum characters",
                        type: "number",
                    },
                },
            },
            async (context, params) => {
                const offset = optionalNumber(flags(params).offset);
                const maxChars = optionalNumber(flags(params).maxChars);
                return markdown(
                    await context.service.getSourceContent({
                        corpusId: requireActiveCorpus(context),
                        sourceId: stringValue(
                            args(params).sourceId,
                            "source ID",
                        ),
                        ...(offset === undefined ? {} : { offset }),
                        ...(maxChars === undefined ? {} : { maxChars }),
                    }),
                );
            },
            sourceCompletions,
        ),
        knowledge: parameters(
            {
                args: { sourceId: { description: "Source ID" } },
            },
            async (context, params) =>
                markdown(
                    await context.service.getSourceKnowledge(
                        requireActiveCorpus(context),
                        stringValue(args(params).sourceId, "source ID"),
                    ),
                ),
            sourceCompletions,
        ),
        replace: parameters(
            {
                args: {
                    sourceId: { description: "Source ID" },
                    path: {
                        description: "Replacement Markdown path",
                        implicitQuotes: true,
                    },
                },
                flags: {
                    wait: { description: "Wait for the job", default: false },
                    confirm: {
                        description: "Confirmation token from the preview",
                        type: "string",
                    },
                },
            },
            (context, params) =>
                replaceSource(
                    context,
                    stringValue(args(params).sourceId, "source ID"),
                    stringValue(args(params).path, "path"),
                    booleanValue(flags(params).wait),
                    optionalString(flags(params).confirm),
                ),
            sourceCompletions,
        ),
        forget: parameters(
            {
                args: { sourceId: { description: "Source ID" } },
                flags: {
                    confirm: {
                        description: "Confirmation token from the preview",
                        type: "string",
                    },
                },
            },
            async (context, params) => {
                const corpusId = requireActiveCorpus(context);
                const sourceId = stringValue(
                    args(params).sourceId,
                    "source ID",
                );
                const token = optionalString(flags(params).confirm);
                return markdown(
                    token === undefined
                        ? await context.service.previewForgetSource(
                              corpusId,
                              sourceId,
                          )
                        : await context.service.forgetSource({
                              corpusId,
                              sourceId,
                              confirmationToken: token,
                          }),
                );
            },
            sourceCompletions,
        ),
    },
};

function renderEvidence(evidence: MemoryEvidence[]): string {
    if (evidence.length === 0) {
        return "No grounded evidence was found.";
    }
    return evidence
        .map(
            (item, index) =>
                `${index + 1}. ${item.snippet.trim()} [${index + 1}]\n   - ${item.title} (\`${item.sourceId}\`${item.locator ? `, ${item.locator}` : ""}${item.canonicalUri ? `, ${item.canonicalUri}` : ""})`,
        )
        .join("\n");
}

function renderCitationMetadata(citations: MemoryEvidence[]): string {
    if (citations.length === 0) {
        return "No citations were returned.";
    }
    return citations
        .map((citation, index) => {
            const metadata = [
                `evidence: \`${citation.evidenceId}\``,
                `source: \`${citation.sourceId}\``,
                `revision: \`${citation.revisionId}\``,
                `score: ${citation.score}`,
                citation.locator === undefined
                    ? undefined
                    : `locator: ${citation.locator}`,
                citation.canonicalUri === undefined
                    ? undefined
                    : `URI: ${citation.canonicalUri}`,
            ].filter((item): item is string => item !== undefined);
            return `### [${index + 1}] ${citation.title}\n\n${citation.snippet.trim()}\n\n- ${metadata.join("\n- ")}`;
        })
        .join("\n\n");
}

async function search(
    context: MemoryAgentContext,
    query: string,
    limit?: number,
): Promise<ActionResult> {
    const result = await context.service.search({
        corpusId: requireActiveCorpus(context),
        query,
        ...(limit === undefined ? {} : { limit }),
    });
    return markdown(
        `## Search results\n\n${renderEvidence(result.matches)}\n\nIndex: \`${result.indexVersion}\``,
    );
}

async function ask(
    context: MemoryAgentContext,
    question: string,
    limit?: number,
): Promise<ActionResult> {
    const result = await context.service.answer({
        corpusId: requireActiveCorpus(context),
        question,
        limit: limit ?? 5,
    });
    context.lastAnswerEvidence = {
        question,
        answer: result.answer,
        citations: result.citations,
        indexVersion: result.indexVersion,
    };
    return markdown(
        `## Grounded extractive answer\n\n${result.answer}\n\n## Citations\n\n${renderCitationMetadata(result.citations)}\n\nIndex: \`${result.indexVersion}\``,
    );
}

const jobCommands: CommandHandlerTable = {
    description: "Inspect and cancel memory jobs",
    commands: {
        list: noParameters("List jobs", async (context) =>
            markdown(
                await context.service.listJobs(
                    context.activeCorpusId === undefined
                        ? {}
                        : { corpusId: context.activeCorpusId },
                ),
            ),
        ),
        show: parameters(
            { args: { jobId: { description: "Job ID" } } },
            async (context, params) =>
                markdown(
                    (await context.service.getJob(
                        stringValue(args(params).jobId, "job ID"),
                    )) ?? "Job not found.",
                ),
            jobCompletions,
        ),
        cancel: parameters(
            { args: { jobId: { description: "Job ID" } } },
            async (context, params) =>
                markdown(
                    (await context.service.cancelJob(
                        stringValue(args(params).jobId, "job ID"),
                    )) ?? "Job not found.",
                ),
            jobCompletions,
        ),
    },
};

const handlers: CommandHandlerTable = {
    description: "Durable memory management and grounded retrieval",
    commands: {
        corpus: corpusCommands,
        import: importCommands,
        sources: sourceCommands,
        search: parameters(
            {
                args: {
                    query: {
                        description: "Search query",
                        implicitQuotes: true,
                    },
                },
                flags: {
                    limit: { description: "Result limit", type: "number" },
                },
            },
            (context, params) =>
                search(
                    context,
                    stringValue(args(params).query, "query"),
                    optionalNumber(flags(params).limit),
                ),
        ),
        ask: parameters(
            {
                args: {
                    question: {
                        description: "Question",
                        implicitQuotes: true,
                    },
                },
                flags: {
                    limit: { description: "Evidence limit", type: "number" },
                },
            },
            (context, params) =>
                ask(
                    context,
                    stringValue(args(params).question, "question"),
                    optionalNumber(flags(params).limit),
                ),
        ),
        explain: noParameters(
            "Show the retained evidence for the last answer",
            async (context) =>
                markdown(
                    context.lastAnswerEvidence ??
                        "No answer evidence is retained.",
                ),
        ),
        jobs: jobCommands,
        reindex: parameters(
            {
                args: {
                    sourceId: {
                        description: "Source ID (omit for the corpus)",
                        optional: true,
                    },
                },
            },
            async (context, params) => {
                const corpusId = requireActiveCorpus(context);
                const sourceId = optionalString(args(params).sourceId);
                return markdown(
                    sourceId === undefined
                        ? await context.service.reindexCorpus(corpusId)
                        : await context.service.reindexSource(
                              corpusId,
                              sourceId,
                          ),
                );
            },
            sourceCompletions,
        ),
        status: noParameters("Show memory service status", async (context) => {
            await restoreImportBatches(context);
            const corpus =
                context.activeCorpusId === undefined
                    ? undefined
                    : await context.service.getCorpus(context.activeCorpusId);
            return markdown({
                activeCorpusId: context.activeCorpusId,
                corpus,
                capabilities: await context.service.getCapabilities(),
                imports: [...context.imports.keys()],
            });
        }),
    },
};

async function executeMemoryAction(
    action: TypeAgentAction<MemoryAction>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const state = memoryContext(context);
    switch (action.actionName) {
        case "useMemoryCorpus": {
            const corpus = await state.service.getCorpus(
                action.parameters.corpusId,
            );
            if (corpus === undefined) {
                throw new Error(
                    `Unknown corpus '${action.parameters.corpusId}'`,
                );
            }
            await setActiveCorpus(state, action.parameters.corpusId);
            return markdown(
                `Active memory corpus: \`${action.parameters.corpusId}\``,
            );
        }
        case "importMemoryFile":
            return beginImport(
                state,
                {
                    args: { path: action.parameters.path },
                    flags: { wait: action.parameters.wait ?? false },
                } as Params,
                "file",
            );
        case "searchMemory":
            return search(
                state,
                action.parameters.query,
                action.parameters.limit,
            );
        case "askMemory":
            return ask(
                state,
                action.parameters.question,
                action.parameters.limit,
            );
    }
}

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeMemoryContext,
        updateAgentContext: updateMemoryContext,
        closeAgentContext: closeMemoryContext,
        executeAction: executeMemoryAction,
        ...getCommandInterface(handlers),
    };
}
