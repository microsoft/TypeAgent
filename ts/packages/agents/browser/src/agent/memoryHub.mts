// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { z } from "zod";
import type {
    MemoryCenterCorpus,
    MemoryCenterInvokeFunctions,
    MemoryCenterJob,
    MemoryCenterPage,
} from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    MemoryHubError,
    MemoryHubFunctions,
    MemoryHubInboxItem,
    MemoryHubSnapshot,
} from "@typeagent/browser-control-rpc/viewRpc";

type MemoryHubSource = Pick<
    MemoryCenterInvokeFunctions,
    | "memoryListCorpora"
    | "memoryListProcedureCandidates"
    | "memoryListProcedures"
    | "memoryListJobs"
    | "memoryListSources"
>;

const cursorSchema = z.strictObject({
    version: z.literal(1),
    scope: z.string(),
    corpusIndex: z.number().int().nonnegative(),
    sourceToken: z.string().optional(),
});
type SourceCursor = z.infer<typeof cursorSchema>;

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function itemIdentity(
    kind: MemoryHubInboxItem["kind"],
    corpusId: string,
    objectId: string,
): string {
    return JSON.stringify([kind, corpusId, objectId]);
}

function sortInbox(items: MemoryHubInboxItem[]): void {
    items.sort(
        (left, right) =>
            Number(left.severity === "info") -
                Number(right.severity === "info") ||
            compareText(left.updatedAt, right.updatedAt) ||
            compareText(left.id, right.id),
    );
}

function jobItem(job: MemoryCenterJob, corpusName: string): MemoryHubInboxItem {
    return {
        id: itemIdentity("job", job.corpusId, job.jobId),
        fingerprint: JSON.stringify([job.state, job.revisionId, job.updatedAt]),
        kind: "job",
        corpusId: job.corpusId,
        corpusName,
        objectId: job.jobId,
        sourceId: job.sourceId,
        jobState: job.state === "failed" ? "failed" : "partial",
        title: `${job.state === "failed" ? "Failed" : "Partial"} ingestion`,
        reason:
            job.error ??
            (job.warnings.length
                ? job.warnings.join("; ")
                : "Open the job to review its result."),
        updatedAt: job.updatedAt,
        severity: "attention",
    };
}

async function loadJobs(
    source: MemoryHubSource,
    corpusId?: string,
): Promise<{ jobs: MemoryCenterJob[]; error?: string }> {
    const jobs: MemoryCenterJob[] = [];
    const visitedTokens = new Set<string>();
    let continuationToken: string | undefined;
    do {
        let page: Awaited<ReturnType<MemoryHubSource["memoryListJobs"]>>;
        try {
            page = await source.memoryListJobs({
                ...(corpusId === undefined ? {} : { corpusId }),
                pageSize: 1000,
                ...(continuationToken === undefined
                    ? {}
                    : { continuationToken }),
            });
        } catch (error) {
            return { jobs, error: errorMessage(error) };
        }
        jobs.push(...page.items);
        continuationToken = page.nextContinuationToken;
        if (continuationToken !== undefined) {
            if (visitedTokens.has(continuationToken)) {
                return {
                    jobs,
                    error: "Memory jobs returned a repeated page token",
                };
            }
            visitedTokens.add(continuationToken);
        }
    } while (continuationToken !== undefined);
    return { jobs };
}

export async function loadMemoryHubCorpora(
    source: Pick<MemoryHubSource, "memoryListCorpora">,
    corpusId?: string,
): Promise<MemoryCenterCorpus[]> {
    const all = await source.memoryListCorpora({});
    if (
        corpusId !== undefined &&
        !all.some((corpus) => corpus.corpusId === corpusId)
    ) {
        throw new Error(`Memory corpus '${corpusId}' was not found`);
    }
    return all
        .filter(
            (corpus) => corpusId === undefined || corpus.corpusId === corpusId,
        )
        .sort((left, right) => compareText(left.corpusId, right.corpusId));
}

async function addCorpusItems(
    source: MemoryHubSource,
    corpus: MemoryCenterCorpus,
    snapshot: MemoryHubSnapshot,
): Promise<void> {
    await Promise.all([
        source
            .memoryListProcedureCandidates({
                corpusId: corpus.corpusId,
                states: ["detected", "draft"],
            })
            .then(
                (candidates) => {
                    for (const candidate of candidates) {
                        snapshot.inbox.push({
                            id: itemIdentity(
                                "candidate",
                                corpus.corpusId,
                                candidate.candidateId,
                            ),
                            fingerprint: JSON.stringify([
                                candidate.state,
                                candidate.updatedAt,
                            ]),
                            kind: "candidate",
                            corpusId: corpus.corpusId,
                            corpusName: corpus.name,
                            objectId: candidate.candidateId,
                            title: candidate.title,
                            reason: `${candidate.steps.length} steps found in source evidence; review before saving.`,
                            updatedAt: candidate.updatedAt,
                            severity: "info",
                            ...(candidate.citations[0] === undefined
                                ? {}
                                : {
                                      sourceId: candidate.citations[0].sourceId,
                                  }),
                        });
                    }
                },
                (error: unknown) => {
                    snapshot.errors.push({
                        corpusId: corpus.corpusId,
                        operation: "candidates",
                        message: errorMessage(error),
                    });
                },
            ),
        source
            .memoryListProcedures({
                corpusId: corpus.corpusId,
                states: ["saved", "stale"],
            })
            .then(
                (procedures) => {
                    for (const procedure of procedures) {
                        snapshot.procedures.push({
                            ...procedure,
                            corpusName: corpus.name,
                        });
                        if (procedure.state !== "stale") continue;
                        snapshot.inbox.push({
                            id: itemIdentity(
                                "staleProcedure",
                                corpus.corpusId,
                                procedure.procedureId,
                            ),
                            fingerprint: JSON.stringify([
                                procedure.state,
                                procedure.latestVersion,
                                procedure.updatedAt,
                            ]),
                            kind: "staleProcedure",
                            corpusId: corpus.corpusId,
                            corpusName: corpus.name,
                            objectId: procedure.procedureId,
                            title: procedure.title,
                            reason: "Cited source evidence changed or was forgotten. Review this how-to.",
                            updatedAt: procedure.updatedAt,
                            severity: "attention",
                        });
                    }
                },
                (error: unknown) => {
                    snapshot.errors.push({
                        corpusId: corpus.corpusId,
                        operation: "procedures",
                        message: errorMessage(error),
                    });
                },
            ),
    ]);
}

function scopeHash(
    corpora: MemoryCenterCorpus[],
    query: string | undefined,
    sourceTypes: string[] | undefined,
): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                corpora: corpora.map((corpus) => corpus.corpusId),
                query: query ?? "",
                sourceTypes: sourceTypes
                    ? [...sourceTypes].sort(compareText)
                    : [],
            }),
        )
        .digest("hex");
}

function decodeCursor(
    token: string | undefined,
    scope: string,
    corpusCount: number,
    label = "source",
): SourceCursor {
    if (token === undefined) {
        return { version: 1, scope, corpusIndex: 0 };
    }
    let parsed: SourceCursor;
    try {
        parsed = cursorSchema.parse(
            JSON.parse(Buffer.from(token, "base64url").toString("utf8")),
        );
    } catch {
        throw new Error(`Invalid Memory Hub ${label} page token`);
    }
    if (parsed.scope !== scope || parsed.corpusIndex >= corpusCount) {
        throw new Error(
            `Memory Hub ${label} scope changed. Refresh the ${label} list.`,
        );
    }
    return parsed;
}

function encodeCursor(cursor: SourceCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export async function mapMemoryHubCorpora<T>(
    corpora: MemoryCenterCorpus[],
    work: (corpus: MemoryCenterCorpus) => Promise<T>,
): Promise<T[]> {
    const results: T[] = [];
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, corpora.length) }, async () => {
            while (next < corpora.length) {
                const index = next++;
                results[index] = await work(corpora[index]);
            }
        }),
    );
    return results;
}

export async function pageMemoryHubCorpora<T>(
    corpora: MemoryCenterCorpus[],
    request: { pageSize?: number; continuationToken?: string },
    scope: string,
    operation: "sources" | "changes",
    getPage: (
        corpusId: string,
        pageSize: number,
        continuationToken?: string,
    ) => Promise<MemoryCenterPage<T>>,
): Promise<MemoryCenterPage<T> & { errors: MemoryHubError[] }> {
    const pageSize = request.pageSize ?? 25;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
        throw new Error("Memory Hub page size must be 1 to 1000");
    const label = operation === "sources" ? "source" : "change";
    const cursor = decodeCursor(
        request.continuationToken,
        scope,
        corpora.length,
        label,
    );
    const errors: MemoryHubError[] = [];
    const firstPages = await mapMemoryHubCorpora(corpora, async (corpus) => {
        try {
            return await getPage(corpus.corpusId, pageSize);
        } catch (error) {
            errors.push({
                corpusId: corpus.corpusId,
                operation,
                message: errorMessage(error),
            });
            return undefined;
        }
    });
    const items: T[] = [];
    let corpusIndex = cursor.corpusIndex;
    let sourceToken = cursor.sourceToken;
    while (corpusIndex < corpora.length && items.length < pageSize) {
        const firstPage = firstPages[corpusIndex];
        if (!firstPage) {
            corpusIndex++;
            sourceToken = undefined;
            continue;
        }
        const remaining = pageSize - items.length;
        const page =
            sourceToken !== undefined || firstPage.items.length > remaining
                ? await getPage(
                      corpora[corpusIndex].corpusId,
                      remaining,
                      sourceToken,
                  )
                : firstPage;
        items.push(...page.items);
        if (page.nextContinuationToken !== undefined) {
            if (page.nextContinuationToken === sourceToken)
                throw new Error(
                    `Memory ${operation} returned a repeated page token`,
                );
            sourceToken = page.nextContinuationToken;
        } else {
            corpusIndex++;
            sourceToken = undefined;
        }
    }
    return {
        items,
        total: firstPages.reduce(
            (total, page) => total + (page?.total ?? 0),
            0,
        ),
        errors: errors.sort((a, b) => compareText(a.corpusId, b.corpusId)),
        ...(corpusIndex < corpora.length
            ? {
                  nextContinuationToken: encodeCursor({
                      version: 1,
                      scope,
                      corpusIndex,
                      ...(sourceToken === undefined ? {} : { sourceToken }),
                  }),
              }
            : {}),
    };
}

export function createMemoryHubFunctions(
    source: MemoryHubSource,
): Pick<MemoryHubFunctions, "memoryHubSnapshot" | "memoryHubSources"> {
    return {
        async memoryHubSnapshot({ corpusId }) {
            const corpora = await loadMemoryHubCorpora(source, corpusId);
            const snapshot: MemoryHubSnapshot = {
                corpora,
                inbox: [],
                procedures: [],
                errors: [],
            };
            if (!corpora.length) return snapshot;
            await Promise.all([
                ...corpora.map((corpus) =>
                    addCorpusItems(source, corpus, snapshot),
                ),
                loadJobs(source, corpusId).then(({ jobs, error }) => {
                    if (error !== undefined) {
                        snapshot.errors.push({
                            corpusId: corpusId ?? "*",
                            operation: "jobs",
                            message: error,
                        });
                    }
                    const names = new Map(
                        corpora.map((corpus) => [corpus.corpusId, corpus.name]),
                    );
                    for (const job of jobs) {
                        const name = names.get(job.corpusId);
                        if (
                            name !== undefined &&
                            (job.state === "failed" || job.state === "partial")
                        ) {
                            snapshot.inbox.push(jobItem(job, name));
                        }
                    }
                }),
            ]);
            sortInbox(snapshot.inbox);
            snapshot.procedures.sort(
                (left, right) =>
                    compareText(left.title, right.title) ||
                    compareText(left.corpusId, right.corpusId) ||
                    compareText(left.procedureId, right.procedureId),
            );
            snapshot.errors.sort(
                (left, right) =>
                    compareText(left.corpusId, right.corpusId) ||
                    compareText(left.operation, right.operation),
            );
            return snapshot;
        },

        async memoryHubSources(request) {
            const corpora = await loadMemoryHubCorpora(
                source,
                request.corpusId,
            );
            const scope = scopeHash(
                corpora,
                request.query,
                request.sourceTypes,
            );
            const filters = {
                ...(request.query === undefined
                    ? {}
                    : { query: request.query }),
                ...(request.sourceTypes === undefined
                    ? {}
                    : { sourceTypes: request.sourceTypes }),
            };
            return pageMemoryHubCorpora(
                corpora,
                request,
                scope,
                "sources",
                (corpusId, pageSize, continuationToken) =>
                    source.memoryListSources({
                        corpusId,
                        pageSize,
                        ...filters,
                        ...(continuationToken === undefined
                            ? {}
                            : { continuationToken }),
                    }),
            );
        },
    };
}
