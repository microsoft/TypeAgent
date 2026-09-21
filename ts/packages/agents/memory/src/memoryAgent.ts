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
    controller: AbortController;
    jobIds: Set<string>;
    promise: Promise<ImportBatchManifest>;
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
        context.agentContext.sessionStorage = undefined;
        context.agentContext.clearPreview = undefined;
        context.agentContext.replacePreview = undefined;
        return;
    }
    context.agentContext.sessionStorage = context.sessionStorage;
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
        context.agentContext.activeCorpusId =
            corpusId.length === 0 ? undefined : corpusId;
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
    const cancellations: Promise<unknown>[] = [];
    for (const batch of state.imports.values()) {
        batch.controller.abort(new Error("Memory agent session closed"));
        cancellations.push(
            ...[...batch.jobIds].map((jobId) => state.service.cancelJob(jobId)),
        );
    }
    await Promise.all(cancellations);
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
    const jobs = await context.service.listJobs({
        corpusId: context.activeCorpusId,
    });
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
    return completionGroups(names, "batchId", [...context.imports.keys()]);
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
                context.clearPreview = undefined;
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
        wait: { description: "Wait for ingestion jobs", default: false },
    },
} as const;

async function beginImport(
    context: MemoryAgentContext,
    params: Params,
    expectedKind: "file" | "folder",
): Promise<ActionResult> {
    const batchId = randomUUID();
    const controller = new AbortController();
    const path = stringValue(args(params).path, "path");
    const importFlags = flags(params);
    const jobIds = new Set<string>();
    const promise = importMarkdownPath(context.service, {
        batchId,
        corpusId: requireActiveCorpus(context),
        path,
        expectedKind,
        recursive: booleanValue(importFlags.recursive),
        include: importFlags.include as string[] | undefined,
        exclude: importFlags.exclude as string[] | undefined,
        maxFiles: optionalNumber(importFlags.maxFiles),
        maxTotalBytes: optionalNumber(importFlags.maxBytes),
        concurrency: optionalNumber(importFlags.concurrency),
        wait: booleanValue(importFlags.wait),
        signal: controller.signal,
        onJobAccepted: async (jobId) => {
            jobIds.add(jobId);
            if (controller.signal.aborted) {
                await context.service.cancelJob(jobId);
            }
        },
    });
    const batch: ImportBatchState = { controller, jobIds, promise };
    context.imports.set(batchId, batch);
    void promise.then(
        (manifest) => {
            batch.manifest = manifest;
        },
        (error: unknown) => {
            batch.error =
                error instanceof Error ? error.message : String(error);
        },
    );
    if (booleanValue(importFlags.wait)) {
        return markdown(await promise);
    }
    return markdown({
        batchId,
        state: "running",
        status: `@memory import status ${batchId}`,
    });
}

const terminalJobStates = new Set<JobState>([
    "complete",
    "partial",
    "failed",
    "cancelled",
]);

async function getImportBatchStatus(
    context: MemoryAgentContext,
    batchId: string,
    batch: ImportBatchState,
): Promise<unknown> {
    if (batch.error !== undefined) {
        return { batchId, state: "failed", error: batch.error };
    }
    if (batch.manifest === undefined) {
        return {
            batchId,
            state: "submitting",
            acceptedJobs: batch.jobIds.size,
        };
    }
    const jobs = await Promise.all(
        [...batch.jobIds].map((jobId) => context.service.getJob(jobId)),
    );
    const jobStates: Record<string, number> = {};
    let missingJobs = 0;
    for (const job of jobs) {
        if (job === undefined) {
            missingJobs++;
            continue;
        }
        jobStates[job.state] = (jobStates[job.state] ?? 0) + 1;
    }
    const hasActiveJobs = jobs.some(
        (job) => job !== undefined && !terminalJobStates.has(job.state),
    );
    const hasFailedJobs = jobs.some(
        (job) =>
            job?.state === "failed" ||
            job?.state === "partial" ||
            job?.state === "cancelled",
    );
    const unchangedJobs = jobs.filter(
        (job) => job?.progress.message === "Source is unchanged",
    ).length;
    let state = "complete";
    if (batch.cancellationRequested && hasActiveJobs) {
        state = "cancelling";
    } else if (batch.cancellationRequested || batch.manifest.cancelled) {
        state = "cancelled";
    } else if (hasActiveJobs) {
        state = "running";
    } else if (batch.manifest.failed > 0 || hasFailedJobs || missingJobs > 0) {
        state = "partial";
    }
    return {
        batchId,
        state,
        jobStates,
        unchangedJobs,
        missingJobs,
        manifest: batch.manifest,
    };
}

const importCommands: CommandHandlerTable = {
    description: "Import Markdown files and manage import batches",
    commands: {
        file: parameters(importParameters, (context, params) =>
            beginImport(context, params, "file"),
        ),
        folder: parameters(importParameters, (context, params) =>
            beginImport(context, params, "folder"),
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
                const batchId = stringValue(args(params).batchId, "batch ID");
                const batch = context.imports.get(batchId);
                if (batch === undefined) {
                    throw new Error(`Unknown import batch '${batchId}'`);
                }
                batch.cancellationRequested = true;
                batch.controller.abort(new Error("Import cancelled by user"));
                await Promise.all(
                    [...batch.jobIds].map((jobId) =>
                        context.service.cancelJob(jobId),
                    ),
                );
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
    context.replacePreview = undefined;
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
            async (context, params) =>
                markdown(
                    await context.service.getSourceContent({
                        corpusId: requireActiveCorpus(context),
                        sourceId: stringValue(
                            args(params).sourceId,
                            "source ID",
                        ),
                        offset: optionalNumber(flags(params).offset),
                        maxChars: optionalNumber(flags(params).maxChars),
                    }),
                ),
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
        limit,
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
                await context.service.listJobs({
                    corpusId: context.activeCorpusId,
                }),
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
