// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    assertBatchImportRequest,
    measureBatchImportBytes,
} from "@typeagent/memory-service";
import type {
    MemoryService,
    MemoryBatchImportRequest,
    RunbookJobResult,
    RunbookSynthesisRequest,
} from "@typeagent/memory-service";
import {
    runbookImportLimits,
    type MemoryHubRunbookImportFunctions,
    type RunbookBatchRequest,
    type RunbookImportRequest,
    type RunbookImportResponse,
    type RunbookImportBatch,
    type RunbookAcquisitionIssue,
} from "@typeagent/browser-control-rpc/runbookImportViewTypes";
import {
    acquireSelectedRunbooks,
    runbookTitle,
    type RunbookAcquisition,
} from "./runbookImportFiles.mjs";
import {
    acquireRunbookUrl,
    type AcquiredRunbookUrl,
} from "./runbookImportRemote.mjs";

export interface RunbookImportService {
    getCorpus: MemoryService["getCorpus"];
    startBatchImport(
        request: MemoryBatchImportRequest,
    ): Promise<RunbookImportBatch>;
    getBatchImport(batchId: string): Promise<RunbookImportBatch>;
    findBatchImport(request: {
        corpusId: string;
        idempotencyKey: string;
    }): Promise<RunbookImportBatch | undefined>;
    listBatchImports(corpusId: string): Promise<RunbookImportBatch[]>;
    retryBatchImport(batchId: string): Promise<RunbookImportBatch>;
    cancelBatchImport(batchId: string): Promise<RunbookImportBatch>;
    listRunbookJobs(corpusId: string): Promise<RunbookJobResult[]>;
    requestRunbookSynthesis?(
        request: RunbookSynthesisRequest,
    ): Promise<RunbookJobResult>;
}
type ServiceProvider = () => Pick<MemoryService, "getCorpus"> &
    Partial<RunbookImportService>;
type AcquiredBatchRequest = MemoryBatchImportRequest &
    Required<
        Pick<
            MemoryBatchImportRequest,
            | "acquisitionFingerprint"
            | "documentKeys"
            | "rejectedMembers"
            | "acquisitionIssues"
            | "warnings"
        >
    >;

function serviceMethods(
    value: ReturnType<ServiceProvider>,
): value is RunbookImportService {
    return [
        "startBatchImport",
        "getBatchImport",
        "findBatchImport",
        "listBatchImports",
        "retryBatchImport",
        "cancelBatchImport",
        "listRunbookJobs",
    ].every((method) => typeof Reflect.get(value, method) === "function");
}

export function runbookImportFingerprint(
    request: RunbookImportRequest,
): string {
    return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}
export function runbookImportBatchId(request: {
    corpusId: string;
    idempotencyKey: string;
}): string {
    return createHash("sha256")
        .update(`${request.corpusId}\0${request.idempotencyKey}`)
        .digest("hex");
}
export function runbookImportMemberKeys(
    request: RunbookImportRequest,
): string[] {
    const fingerprint = runbookImportFingerprint(request);
    const references =
        request.kind === "urls"
            ? request.urls
            : request.files.map((file) => file.relativePath);
    return references.map((reference, index) =>
        createHash("sha256")
            .update(`${fingerprint}\0${request.kind}\0${reference}\0${index}`)
            .digest("hex"),
    );
}

function acquisitionIndex(value: unknown, count: number): number {
    if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value >= count
    )
        throw new Error(
            "Acquired member is missing its stable original input index.",
        );
    return value;
}
function documentInputIndex(
    document: RunbookAcquisition["documents"][number],
    count: number,
): number {
    const value = document.source.metadata?.runbookImport;
    if (
        value === null ||
        typeof value !== "object" ||
        !("originalInputIndex" in value)
    )
        throw new Error("Acquired document lacks original member identity.");
    return acquisitionIndex(value.originalInputIndex, count);
}
function abbreviatedLabel(name: string): string {
    const suffix = "... [name abbreviated]";
    return name.length <= 200
        ? name
        : name.slice(0, 200 - suffix.length) + suffix;
}
function rejectionReason(reason: string): string {
    const suffix = "... [error details abbreviated]";
    return reason.length <= 2000
        ? reason
        : reason.slice(0, 2000 - suffix.length) + suffix;
}
function memberName(request: RunbookImportRequest, index: number): string {
    if (request.kind !== "urls")
        return abbreviatedLabel(
            request.files[index].relativePath.split("/").pop()!,
        );
    try {
        return abbreviatedLabel(
            new URL(request.urls[index]).pathname
                .split("/")
                .filter(Boolean)
                .pop() || "URL document",
        );
    } catch {
        return "Invalid URL";
    }
}
function coreWarningIssues(
    acquisition: RunbookAcquisition,
    indices: number[],
    keys: string[],
): AcquiredBatchRequest["acquisitionIssues"] {
    return indices.flatMap((index) => {
        const warnings = acquisition.issues.filter(
            (issue) => issue.inputIndex === index && issue.state === "warning",
        );
        return warnings.length
            ? [
                  {
                      member: keys[index],
                      state: "warning" as const,
                      reason: rejectionReason(
                          `${warnings.length} acquisition warning(s):\n${warnings.map((warning) => warning.reason).join("\n")}`,
                      ),
                  },
              ]
            : [];
    });
}
function unassociatedWarnings(
    acquisition: RunbookAcquisition,
    acquiredIndices: number[],
): string[] {
    const notices = acquisition.issues.filter(
        (issue) =>
            issue.state === "warning" &&
            !acquiredIndices.includes(issue.inputIndex ?? -1),
    );
    if (!notices.length) return [];
    const message = `${notices.length} unassociated acquisition notice(s):\n${notices.map((issue) => `${issue.member.split("/").pop()}: ${issue.reason}`).join("\n")}`;
    const suffix = "... [notice details abbreviated]";
    return [
        message.length <= 1000
            ? message
            : message.slice(0, 1000 - suffix.length) + suffix,
    ];
}
function acquiredBatchRequest(
    request: RunbookImportRequest,
    acquisition: RunbookAcquisition,
): AcquiredBatchRequest {
    const keys = runbookImportMemberKeys(request);
    const indices = acquisition.documents.map((document) =>
        documentInputIndex(document, keys.length),
    );
    const rejectedMembers = acquisition.issues
        .filter((issue) => issue.state === "rejected")
        .map((issue) => {
            const index = acquisitionIndex(issue.inputIndex, keys.length);
            return {
                memberKey: keys[index],
                displayName: memberName(request, index),
                reason: rejectionReason(issue.reason),
            };
        });
    return {
        corpusId: request.corpusId,
        idempotencyKey: request.idempotencyKey,
        acquisitionFingerprint: runbookImportFingerprint(request),
        documents: acquisition.documents,
        documentKeys: indices.map((index) => keys[index]),
        warnings: unassociatedWarnings(acquisition, indices),
        acquisitionIssues: [
            ...coreWarningIssues(acquisition, indices, keys),
            ...rejectedMembers.map((member) => ({
                member: member.memberKey,
                state: "rejected" as const,
                reason: member.reason,
            })),
        ],
        rejectedMembers,
    };
}
function recoveredIssues(
    batch: RunbookImportBatch,
    request: RunbookImportRequest,
): RunbookAcquisitionIssue[] {
    const keys = runbookImportMemberKeys(request);
    const references =
        request.kind === "urls"
            ? request.urls
            : request.files.map((file) => file.relativePath);
    if (batch.acquisitionIssues)
        return batch.acquisitionIssues.map((issue) => {
            const index = keys.indexOf(issue.member);
            return {
                ...issue,
                inputIndex: index,
                member: index >= 0 ? references[index] : issue.member,
            };
        });
    return batch.members.flatMap((member) => {
        const index = member.clientKey ? keys.indexOf(member.clientKey) : -1;
        const name =
            index >= 0
                ? references[index]
                : (member.displayName ?? member.memberId);
        const rejected: RunbookAcquisitionIssue[] =
            member.stage === "acquisition" && member.reason
                ? [
                      {
                          member: name,
                          inputIndex: index,
                          state: "rejected",
                          reason: member.reason,
                      },
                  ]
                : [];
        return [
            ...rejected,
            ...member.warnings.map(
                (reason): RunbookAcquisitionIssue => ({
                    member: name,
                    inputIndex: index,
                    state: "warning",
                    reason,
                }),
            ),
        ];
    });
}

export function assertRunbookGatewaySize(request: RunbookImportRequest): void {
    const bytes = Buffer.byteLength(
        JSON.stringify({
            method: "memoryHubStartRunbookImport",
            params: request,
        }),
    );
    if (bytes > runbookImportLimits.gatewayBytes)
        throw new Error(
            "Runbook import exceeds the 10 MB gateway body limit; split the selected batch.",
        );
    if (
        !request.corpusId.trim() ||
        !request.idempotencyKey.trim() ||
        request.idempotencyKey.length > 200
    )
        throw new Error(
            "A named target corpus and bounded idempotency key are required.",
        );
    if (request.kind === "urls") {
        if (
            !request.urls.length ||
            request.urls.length > runbookImportLimits.documents
        )
            throw new Error("Select 1-50 URLs; nothing is silently truncated.");
    } else if (
        !request.files.length ||
        request.files.length > runbookImportLimits.selectedFiles
    ) {
        throw new Error(
            "Select 1-200 files including referenced images; nothing is silently truncated.",
        );
    }
}

function checkedBatch(
    request: RunbookBatchRequest,
    batch: RunbookImportBatch,
): RunbookImportBatch {
    if (
        batch.corpusId !== request.corpusId ||
        batch.batchId !== request.batchId
    )
        throw new Error(
            "Batch response does not belong to the selected target corpus and batch.",
        );
    return batch;
}

function acquiredMemberNames(
    batch: RunbookImportBatch,
    acquisition: RunbookAcquisition,
): RunbookImportBatch {
    return {
        ...batch,
        members: batch.members.map((member) => {
            const source =
                acquisition.documents[Number(member.memberId)]?.source;
            return source
                ? {
                      ...member,
                      title: source.title,
                      displayName: member.displayName ?? source.title,
                      ...(source.canonicalUri
                          ? { canonicalUri: source.canonicalUri }
                          : {}),
                  }
                : member;
        }),
    };
}

async function acquireUrls(
    urls: string[],
    acquire: (url: string) => Promise<AcquiredRunbookUrl>,
): Promise<RunbookAcquisition> {
    const acquisition: RunbookAcquisition = { documents: [], issues: [] };
    for (const [inputIndex, url] of urls.entries()) {
        try {
            const result = await acquire(url);
            const html = result.mimeType === "text/html";
            const sourceType = html
                ? "html"
                : result.mimeType === "text/markdown"
                  ? "markdown"
                  : "text";
            acquisition.documents.push({
                source: {
                    sourceType,
                    title: runbookTitle(result.text, result.url, html),
                    canonicalUri: result.url,
                    ...(html
                        ? { html: result.text }
                        : sourceType === "markdown"
                          ? { markdown: result.text }
                          : { text: result.text }),
                    metadata: {
                        runbookImport: {
                            kind: "urls",
                            requestedUrl: url,
                            originalInputIndex: inputIndex,
                        },
                    },
                },
            });
            if (/(?:<img\b|!\[)/i.test(result.text))
                acquisition.issues.push({
                    member: url,
                    inputIndex,
                    state: "warning",
                    reason: "Remote images are not fetched. Select local exported files and images to attach original evidence.",
                });
        } catch (error) {
            acquisition.issues.push({
                member: url,
                inputIndex,
                state: "rejected",
                reason: error instanceof Error ? error.message : String(error),
            });
        }
        if (
            measureBatchImportBytes({
                corpusId: "",
                idempotencyKey: "",
                documents: acquisition.documents,
            }) > runbookImportLimits.coreBytes
        )
            throw new Error(
                "Acquired URL originals exceed the 8 MB core budget. Split the list; no import was started and nothing was truncated.",
            );
    }
    return acquisition;
}

export function createMemoryHubRunbookImportFunctions(
    getService: ServiceProvider,
    acquireUrl: (
        url: string,
    ) => Promise<AcquiredRunbookUrl> = acquireRunbookUrl,
): MemoryHubRunbookImportFunctions {
    const inFlight = new Map<
        string,
        { fingerprint: string; operation: Promise<RunbookImportResponse> }
    >();

    async function corpusService(
        corpusId: string,
    ): Promise<RunbookImportService> {
        if (!corpusId.trim())
            throw new Error(
                "Select a named target corpus; all-corpora imports are unavailable.",
            );
        const service = getService();
        if (!serviceMethods(service))
            throw new Error(
                "Durable batch Runbook import is unavailable in this Memory service.",
            );
        const corpus = await service.getCorpus(corpusId);
        if (!corpus || corpus.corpusId !== corpusId)
            throw new Error("The selected target corpus is unavailable.");
        return service;
    }

    async function scopedBatch(request: RunbookBatchRequest) {
        const service = await corpusService(request.corpusId);
        if (!/^[a-f0-9]{64}$/.test(request.batchId))
            throw new Error("Invalid batch ID.");
        const batch = await service.getBatchImport(request.batchId);
        checkedBatch(request, batch);
        return { service, batch };
    }

    async function start(
        request: RunbookImportRequest,
    ): Promise<RunbookImportResponse> {
        const service = await corpusService(request.corpusId);
        const existing = await service.findBatchImport({
            corpusId: request.corpusId,
            idempotencyKey: request.idempotencyKey,
        });
        if (existing) {
            if (existing.corpusId !== request.corpusId)
                throw new Error(
                    "Existing batch belongs to another target corpus.",
                );
            if (
                existing.acquisitionFingerprint !==
                runbookImportFingerprint(request)
            )
                throw new Error(
                    "Idempotency key has different acquisition inputs or a legacy batch without a fingerprint; select the sources again with a new batch key.",
                );
            const keys = new Set(runbookImportMemberKeys(request));
            if (
                !existing.members.length ||
                existing.members.some(
                    (member) =>
                        !member.clientKey || !keys.has(member.clientKey),
                )
            )
                throw new Error(
                    "Idempotency key belongs to different acquisition inputs or a legacy batch without acquired member keys.",
                );
            return {
                batch: existing,
                acquisition: recoveredIssues(existing, request),
                warnings: [
                    "Recovered the existing durable batch without reacquiring or refetching sources.",
                    ...(existing.warnings ?? []),
                ],
            };
        }
        const acquisition =
            request.kind === "urls"
                ? await acquireUrls(request.urls, acquireUrl)
                : acquireSelectedRunbooks(request.kind, request.files);
        const core = acquiredBatchRequest(request, acquisition);
        if (
            core.documents.length + core.rejectedMembers.length >
            runbookImportLimits.documents
        )
            throw new Error(
                "More than 50 acquired/rejected document members; split the batch. No import was started.",
            );
        if (!core.documents.length && !core.rejectedMembers.length)
            return {
                acquisition: acquisition.issues,
                warnings: [
                    "No supported documents were acquired. No batch was started.",
                ],
            };
        if (measureBatchImportBytes(core) > runbookImportLimits.coreBytes)
            throw new Error(
                "Acquired documents exceed the 8 MB core request limit including encoded assets; split the batch. No import was started.",
            );
        assertBatchImportRequest(core);
        const batch = await service.startBatchImport(core);
        checkedBatch(
            {
                corpusId: request.corpusId,
                batchId: batch.batchId,
            },
            batch,
        );
        return {
            batch: acquiredMemberNames(batch, acquisition),
            acquisition: acquisition.issues,
            warnings: [
                "Classification and synthesis run as separate post-commit jobs. Imports never execute Runbooks, tools or automations.",
            ],
        };
    }

    return {
        memoryHubStartRunbookImport(request) {
            assertRunbookGatewaySize(request);
            const key = runbookImportBatchId(request);
            const fingerprint = runbookImportFingerprint(request);
            const pending = inFlight.get(key);
            if (pending) {
                if (pending.fingerprint !== fingerprint)
                    throw new Error(
                        "Idempotency key reused with different acquisition inputs.",
                    );
                return pending.operation;
            }
            const operation = start(request).finally(() =>
                inFlight.delete(key),
            );
            inFlight.set(key, { fingerprint, operation });
            return operation;
        },
        async memoryHubRunbookBatches({ corpusId }) {
            const batches = await (
                await corpusService(corpusId)
            ).listBatchImports(corpusId);
            if (batches.some((batch) => batch.corpusId !== corpusId))
                throw new Error("Batch listing returned an unexpected corpus.");
            return batches;
        },
        async memoryHubRunbookBatch(request) {
            return (await scopedBatch(request)).batch;
        },
        async memoryHubRetryRunbookBatch(request) {
            const { service } = await scopedBatch(request);
            return checkedBatch(
                request,
                await service.retryBatchImport(request.batchId),
            );
        },
        async memoryHubCancelRunbookBatch(request) {
            const { service } = await scopedBatch(request);
            return checkedBatch(
                request,
                await service.cancelBatchImport(request.batchId),
            );
        },
        async memoryHubRunbookJobs({ corpusId }) {
            const jobs = await (
                await corpusService(corpusId)
            ).listRunbookJobs(corpusId);
            if (jobs.some((job) => job.corpusId !== corpusId))
                throw new Error("Runbook jobs returned an unexpected corpus.");
            return jobs;
        },
        async memoryHubRetryRunbookSynthesis(request) {
            const service = await corpusService(request.corpusId);
            if (!service.requestRunbookSynthesis)
                throw new Error(
                    "Post-commit Runbook synthesis retry is unavailable in this Memory service.",
                );
            if (!request.sourceId.trim() || !request.revisionId.trim())
                throw new Error("Select an exact retained source revision.");
            const result = await service.requestRunbookSynthesis(request);
            if (
                result.corpusId !== request.corpusId ||
                result.sourceId !== request.sourceId ||
                result.revisionId !== request.revisionId
            )
                throw new Error(
                    "Synthesis retry returned another target or source revision.",
                );
            return result;
        },
    };
}
