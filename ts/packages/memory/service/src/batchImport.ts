// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
    DocumentIngestRequest,
    DocumentIngestResult,
    IngestionJobStatus,
} from "./types.js";
import { assetDigest } from "./revisionAssetStore.js";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { redactRunbookText } from "./runbookRedaction.js";

export interface MemoryBatchImportRequest {
    corpusId: string;
    idempotencyKey: string;
    acquisitionFingerprint?: string;
    acquisitionIssues?: MemoryBatchAcquisitionIssue[];
    warnings?: string[];
    documents: Array<Omit<DocumentIngestRequest, "corpusId">>;
    documentKeys?: string[];
    documentWarnings?: string[][];
    rejectedMembers?: MemoryBatchRejectedMember[];
}

export type MemoryBatchImportLookup = Pick<
    MemoryBatchImportRequest,
    "corpusId" | "idempotencyKey"
>;

export interface MemoryBatchRejectedMember {
    memberKey: string;
    displayName?: string;
    reason: string;
}

export interface MemoryBatchAcquisitionIssue {
    member: string;
    state: "rejected" | "warning";
    reason: string;
}

export interface MemoryBatchMember {
    memberId: string;
    contentIdentity: string;
    state:
        | "pending"
        | "ingesting"
        | "complete"
        | "failed"
        | "cancelled"
        | "duplicate"
        | "interrupted";
    sourceId?: string;
    revisionId?: string;
    jobId?: string;
    duplicateOf?: string;
    clientKey?: string;
    title?: string;
    displayName?: string;
    stage?: "acquisition" | "ingestion";
    reason?: string;
    warnings: string[];
}

export interface MemoryBatchImport {
    batchId: string;
    corpusId: string;
    acquisitionFingerprint?: string;
    acquisitionIssues?: MemoryBatchAcquisitionIssue[];
    warnings?: string[];
    state:
        | "running"
        | "complete"
        | "partial"
        | "failed"
        | "cancelling"
        | "cancelled"
        | "interrupted";
    createdAt: string;
    updatedAt: string;
    members: MemoryBatchMember[];
}

interface StoredBatch extends MemoryBatchImport {
    request: MemoryBatchImportRequest;
    requestHash: string;
}

interface BatchHost {
    ingestDocument(
        request: DocumentIngestRequest,
        signal?: AbortSignal,
    ): Promise<DocumentIngestResult>;
    getJob(jobId: string): Promise<IngestionJobStatus | undefined>;
    cancelJob(jobId: string): Promise<IngestionJobStatus | undefined>;
}

function encoded(value: unknown): string {
    return JSON.stringify(
        value,
        function (this: Record<string, unknown>, key: string, child: unknown) {
            // Buffer.toJSON runs before the replacer; inspect the original bytes.
            const original = this[key];
            return original instanceof Uint8Array
                ? { batchAssetBytes: Buffer.from(original).toString("base64") }
                : child;
        },
    );
}

export const batchImportRequestByteLimit = 8 * 1024 * 1024;

export function measureBatchImportBytes(
    request: MemoryBatchImportRequest,
): number {
    return Buffer.byteLength(encoded(request));
}

function decoded(value: string): StoredBatch {
    return JSON.parse(value, (_key, child: unknown) => {
        if (
            child !== null &&
            typeof child === "object" &&
            "batchAssetBytes" in child &&
            typeof child.batchAssetBytes === "string"
        )
            return new Uint8Array(Buffer.from(child.batchAssetBytes, "base64"));
        return child;
    }) as StoredBatch;
}

function contentIdentity(
    document: Omit<DocumentIngestRequest, "corpusId">,
): string {
    const source = document.source;
    return assetDigest(
        Buffer.from(
            encoded([
                source.sourceType,
                source.markdown ?? source.text ?? source.html ?? "",
                (source.assets ?? []).map((asset) => [
                    asset.name,
                    asset.mimeType,
                    assetDigest(asset.bytes),
                ]),
            ]),
        ),
    );
}

function validateBatchKey(key: string): void {
    if (typeof key !== "string" || !key.trim() || key.length > 200)
        throw new Error("Batch requires a bounded idempotency key");
}

function batchIdentity(corpusId: string, key: string): string {
    validateBatchKey(key);
    return assetDigest(Buffer.from(`${corpusId}\0${key}`));
}

function acquisitionRejections(
    request: MemoryBatchImportRequest,
): MemoryBatchRejectedMember[] {
    const rejections = [...(request.rejectedMembers ?? [])];
    for (const issue of request.acquisitionIssues ?? []) {
        if (issue.state !== "rejected") continue;
        const existing = rejections.find(
            (member) => member.memberKey === issue.member,
        );
        if (existing !== undefined) {
            if (existing.reason !== issue.reason)
                throw new Error("Conflicting acquisition rejection reasons");
        } else {
            rejections.push({ memberKey: issue.member, reason: issue.reason });
        }
    }
    return rejections;
}

function validateAcquisitionIssues(
    request: MemoryBatchImportRequest,
    rejections: readonly MemoryBatchRejectedMember[],
): void {
    const issues = request.acquisitionIssues ?? [];
    if (issues.length > 50)
        throw new Error("At most 50 acquisition issues may be retained");
    const keys = new Set([
        ...(request.documentKeys ??
            request.documents.map((_document, index) => String(index))),
        ...rejections.map((member) => member.memberKey),
    ]);
    for (const issue of issues) {
        if (
            !["rejected", "warning"].includes(issue.state) ||
            typeof issue.member !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(issue.member) ||
            !keys.has(issue.member) ||
            typeof issue.reason !== "string" ||
            !issue.reason.trim() ||
            issue.reason.length > 2000
        )
            throw new Error(
                "Acquisition issues require a known opaque member key, valid state and bounded reason",
            );
    }
}

function validateBatchWarnings(warnings: readonly string[] = []): void {
    if (
        warnings.length > 20 ||
        warnings.some(
            (warning) =>
                typeof warning !== "string" ||
                !warning.trim() ||
                warning.length > 1000,
        )
    )
        throw new Error(
            "Batch warnings require at most 20 nonempty messages within 1000 characters each",
        );
}

export function assertBatchImportRequest(
    request: MemoryBatchImportRequest,
): void {
    validateBatchKey(request.idempotencyKey);
    validateBatchWarnings(request.warnings);
    if (request.documentWarnings !== undefined) {
        if (request.documentWarnings.length !== request.documents.length)
            throw new Error(
                "Document warnings must correspond to acquired documents",
            );
        for (const warnings of request.documentWarnings)
            validateBatchWarnings(warnings);
    }
    if (
        request.acquisitionFingerprint !== undefined &&
        (typeof request.acquisitionFingerprint !== "string" ||
            !/^[a-f0-9]{64}$/.test(request.acquisitionFingerprint))
    )
        throw new Error("Acquisition fingerprint must be a SHA-256 hex digest");
    const rejections = acquisitionRejections(request);
    validateAcquisitionIssues(request, rejections);
    const count = request.documents.length + rejections.length;
    if (
        count === 0 ||
        count > 50 ||
        measureBatchImportBytes(request) > batchImportRequestByteLimit
    )
        throw new Error(
            "Batch requires 1-50 acquired or rejected members within 8 MB",
        );
    if (
        request.documentKeys !== undefined &&
        request.documentKeys.length !== request.documents.length
    )
        throw new Error("Document keys must correspond to acquired documents");
    const keys = [
        ...(request.documentKeys ?? []),
        ...rejections.map((member) => member.memberKey),
    ];
    if (
        keys.some((key) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)) ||
        new Set(keys).size !== keys.length
    )
        throw new Error(
            "Client member keys must be unique opaque identifiers, not paths",
        );
    for (const member of rejections) {
        if (
            typeof member.reason !== "string" ||
            !member.reason.trim() ||
            member.reason.length > 2000
        )
            throw new Error("Acquisition rejection requires a bounded reason");
        if (
            member.displayName !== undefined &&
            (!member.displayName ||
                member.displayName.length > 200 ||
                /[\\/\0]/.test(member.displayName) ||
                member.displayName === "." ||
                member.displayName === "..")
        )
            throw new Error(
                "Rejected member display name must be a basename, not a path",
            );
    }
}

function boundedMessage(message: string, limit = 1800): string {
    return (
        redactRunbookText(message.slice(0, limit)) +
        (message.length > limit ? " [truncated]" : "")
    );
}

function documentNames(
    document: Omit<DocumentIngestRequest, "corpusId">,
): Pick<MemoryBatchMember, "title" | "displayName"> {
    if (typeof document.source.title !== "string") return {};
    const title = redactRunbookText(document.source.title);
    const name = path.win32.basename(path.posix.basename(title));
    return {
        title: boundedMessage(title, 1800),
        ...(name ? { displayName: boundedMessage(name, 170) } : {}),
    };
}

function mergedDocumentWarnings(
    request: MemoryBatchImportRequest,
    index: number,
    ingestionWarnings: readonly string[] = [],
): string[] {
    return [
        ...new Set([
            ...(request.documentWarnings?.[index] ?? []).map((warning) =>
                boundedMessage(redactRunbookText(warning), 900),
            ),
            ...ingestionWarnings,
        ]),
    ];
}

export class MemoryBatchStore {
    private admissions: Promise<void> = Promise.resolve();
    private readonly active = new Map<
        string,
        { controller: AbortController; task: Promise<void>; batch: StoredBatch }
    >();
    private readonly writes = new Map<string, Promise<void>>();
    private readonly forgettingSources = new Set<string>();
    public constructor(
        private readonly root: string,
        private readonly host: BatchHost,
    ) {}

    private file(batchId: string): string {
        if (!/^[a-f0-9]{64}$/.test(batchId))
            throw new Error("Invalid batch ID");
        return path.join(this.root, "batches", `${batchId}.json`);
    }

    private async persist(batch: StoredBatch): Promise<void> {
        const previous = this.writes.get(batch.batchId) ?? Promise.resolve();
        const task = previous
            .catch(() => undefined)
            .then(() => this.write(batch));
        this.writes.set(batch.batchId, task);
        try {
            await task;
        } finally {
            if (this.writes.get(batch.batchId) === task)
                this.writes.delete(batch.batchId);
        }
    }

    private async write(batch: StoredBatch): Promise<void> {
        const file = this.file(batch.batchId);
        batch.updatedAt = new Date().toISOString();
        await writeRunbookJson(file, encoded(batch));
    }

    private async load(batchId: string): Promise<StoredBatch> {
        const batch = decoded(await readFile(this.file(batchId), "utf8"));
        for (const member of batch.members) {
            const index = Number(member.memberId);
            const document = batch.request.documents[index];
            if (member.stage === "acquisition" || !document) continue;
            const names = documentNames(document);
            if (member.title === undefined && names.title !== undefined)
                member.title = names.title;
            if (
                member.displayName === undefined &&
                names.displayName !== undefined
            )
                member.displayName = names.displayName;
            member.warnings = mergedDocumentWarnings(
                batch.request,
                index,
                member.warnings,
            );
        }
        return batch;
    }

    public async recover(): Promise<void> {
        for await (const batch of this.stored()) {
            if (!["running", "cancelling"].includes(batch.state)) continue;
            batch.state = "interrupted";
            for (const member of batch.members) {
                if (["pending", "ingesting"].includes(member.state)) {
                    const job =
                        member.jobId === undefined
                            ? undefined
                            : (JSON.parse(
                                  await readFile(
                                      path.join(
                                          this.root,
                                          "jobs",
                                          `${member.jobId}.json`,
                                      ),
                                      "utf8",
                                  ).catch(() => "{}"),
                              ) as IngestionJobStatus);
                    member.state =
                        job?.state === "complete" ? "complete" : "interrupted";
                    if (member.state === "complete")
                        this.releaseAcquiredContent(batch, member);
                    member.reason =
                        "Batch interrupted by service restart; retry failed/interrupted members";
                }
            }
            this.linkDuplicates(batch);
            await this.persist(batch);
        }
    }

    private async *stored(): AsyncGenerator<StoredBatch> {
        let files: string[];
        try {
            files = await readdir(path.join(this.root, "batches"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
            throw error;
        }
        for (const file of files.filter((file) =>
            /^[a-f0-9]{64}\.json$/.test(file),
        ))
            yield await this.load(file.slice(0, -5));
    }

    public async get(batchId: string): Promise<MemoryBatchImport> {
        const {
            request: _request,
            requestHash: _hash,
            ...batch
        } = await this.load(batchId);
        if (Buffer.byteLength(encoded(batch)) > 8 * 1024 * 1024)
            throw new Error("Batch metadata exceeds the 8 MiB transport limit");
        return batch;
    }

    public async find(
        corpusId: string,
        idempotencyKey: string,
    ): Promise<MemoryBatchImport | undefined> {
        try {
            return await this.get(batchIdentity(corpusId, idempotencyKey));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return undefined;
            throw error;
        }
    }

    public async list(corpusId: string): Promise<MemoryBatchImport[]> {
        const results: MemoryBatchImport[] = [];
        for await (const {
            request: _request,
            requestHash: _hash,
            ...batch
        } of this.stored()) {
            if (batch.corpusId !== corpusId) continue;
            results.push(batch);
            results.sort((left, right) =>
                right.createdAt.localeCompare(left.createdAt),
            );
            if (results.length > 100) results.pop();
        }
        if (Buffer.byteLength(encoded(results)) > 8 * 1024 * 1024)
            throw new Error(
                "Batch listing exceeds the 8 MiB transport limit; read individual batches",
            );
        return results;
    }

    public async start(
        request: MemoryBatchImportRequest,
    ): Promise<MemoryBatchImport> {
        const task = this.admissions.then(() => this.startAdmitted(request));
        this.admissions = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    }

    private async startAdmitted(
        request: MemoryBatchImportRequest,
    ): Promise<MemoryBatchImport> {
        assertBatchImportRequest(request);
        const batchId = batchIdentity(request.corpusId, request.idempotencyKey);
        const requestHash = assetDigest(Buffer.from(encoded(request)));
        try {
            const existing = await this.load(batchId);
            if (existing.requestHash !== requestHash)
                throw new Error(
                    "Batch idempotency key reused with different documents",
                );
            return this.get(batchId);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (this.active.size >= 4)
            throw new Error(
                "At most four acquired batches may run concurrently",
            );
        const identities = new Set<string>();
        const members = request.documents.map(
            (document, index): MemoryBatchMember => {
                const identity = contentIdentity(document);
                const duplicate = identities.has(identity);
                const clientKey = request.documentKeys?.[index];
                identities.add(identity);
                return {
                    memberId: String(index),
                    contentIdentity: identity,
                    state: duplicate ? "duplicate" : "pending",
                    stage: "ingestion",
                    ...(clientKey === undefined ? {} : { clientKey }),
                    ...documentNames(document),
                    ...(duplicate
                        ? { reason: "Duplicate acquired document in batch" }
                        : {}),
                    warnings: mergedDocumentWarnings(request, index),
                };
            },
        );
        members.push(
            ...acquisitionRejections(request).map(
                (member, index): MemoryBatchMember => ({
                    memberId: `rejected-${index}`,
                    clientKey: member.memberKey,
                    title: boundedMessage(
                        redactRunbookText(
                            member.displayName ?? member.memberKey,
                        ),
                        1800,
                    ),
                    stage: "acquisition",
                    contentIdentity: assetDigest(
                        Buffer.from(
                            `rejected\0${member.memberKey}\0${member.reason}`,
                        ),
                    ),
                    state: "failed",
                    reason: `Acquisition rejected: ${redactRunbookText(member.reason)}`,
                    ...(member.displayName === undefined
                        ? {}
                        : {
                              displayName: redactRunbookText(
                                  member.displayName,
                              ),
                          }),
                    warnings: [
                        "Acquisition must be retried by the host with newly acquired content",
                    ],
                }),
            ),
        );
        for (const member of members.filter(
            (member) => member.state === "duplicate",
        )) {
            const original = members.find(
                (other) =>
                    other.contentIdentity === member.contentIdentity &&
                    other.state !== "duplicate",
            );
            if (original) member.duplicateOf = original.memberId;
        }
        const timestamp = new Date().toISOString();
        const acquisitionIssues = request.acquisitionIssues?.map((issue) => ({
            ...issue,
            reason: redactRunbookText(issue.reason),
        }));
        const warnings = request.warnings?.map((warning) =>
            boundedMessage(redactRunbookText(warning), 900),
        );
        const batch: StoredBatch = {
            batchId,
            corpusId: request.corpusId,
            ...(request.acquisitionFingerprint === undefined
                ? {}
                : { acquisitionFingerprint: request.acquisitionFingerprint }),
            ...(acquisitionIssues === undefined ? {} : { acquisitionIssues }),
            ...(warnings === undefined ? {} : { warnings }),
            request: {
                ...request,
                ...(warnings === undefined ? {} : { warnings }),
                ...(acquisitionIssues === undefined
                    ? {}
                    : { acquisitionIssues }),
                ...(request.documentWarnings === undefined
                    ? {}
                    : {
                          documentWarnings: request.documentWarnings.map(
                              (_warnings, index) =>
                                  mergedDocumentWarnings(request, index),
                          ),
                      }),
                documents: request.documents.map((document) =>
                    structuredClone(document),
                ),
            },
            requestHash,
            state: "running",
            createdAt: timestamp,
            updatedAt: timestamp,
            members,
        };
        for (const member of members.filter(
            (member) => member.state === "duplicate",
        ))
            this.releaseAcquiredContent(batch, member);
        await this.persist(batch);
        this.launch(batch);
        return this.get(batchId);
    }

    private launch(batch: StoredBatch): void {
        const controller = new AbortController();
        const task = this.run(batch, controller.signal)
            .catch(async (error: unknown) => {
                batch.state = "failed";
                for (const member of batch.members) {
                    if (!["pending", "ingesting"].includes(member.state))
                        continue;
                    member.state = "failed";
                    member.reason = boundedMessage(
                        error instanceof Error
                            ? error.message
                            : "Batch processing failed",
                    );
                }
                await this.persist(batch);
            })
            .finally(() => this.active.delete(batch.batchId));
        this.active.set(batch.batchId, { controller, task, batch });
        void task.catch(() => undefined);
    }

    private async run(batch: StoredBatch, signal: AbortSignal): Promise<void> {
        // Two acquired documents at a time; ordinary ingestion keeps corpus commit serialization.
        const pending = batch.members.filter(
            (member) => member.state === "pending",
        );
        for (let index = 0; index < pending.length; index += 2) {
            await Promise.all(
                pending.slice(index, index + 2).map(async (member) => {
                    if (signal.aborted || member.state === "cancelled") {
                        member.state = "cancelled";
                        return;
                    }
                    await this.ingestMember(batch, member, signal);
                }),
            );
            await this.persist(batch);
        }
        this.linkDuplicates(batch);
        const successes = batch.members.filter(
            (member) => member.state === "complete",
        ).length;
        const complete = batch.members.every(
            (member) =>
                member.state === "complete" ||
                (member.state === "duplicate" && member.jobId !== undefined),
        );
        batch.state = signal.aborted
            ? "cancelled"
            : complete
              ? "complete"
              : successes
                ? "partial"
                : "failed";
        await this.persist(batch);
    }

    private linkDuplicates(batch: StoredBatch): void {
        for (const member of batch.members.filter(
            (member) => member.state === "duplicate",
        )) {
            const original = batch.members.find(
                (other) => other.memberId === member.duplicateOf,
            );
            if (original?.state !== "complete") {
                member.reason = `Duplicate of member ${member.duplicateOf ?? "unknown"}; original capture did not complete`;
                continue;
            }
            if (original.sourceId !== undefined)
                member.sourceId = original.sourceId;
            if (original.revisionId !== undefined)
                member.revisionId = original.revisionId;
            if (original.jobId !== undefined) member.jobId = original.jobId;
            member.warnings = mergedDocumentWarnings(
                batch.request,
                Number(member.memberId),
                original.warnings,
            );
        }
    }

    private async ingestMember(
        batch: StoredBatch,
        member: MemoryBatchMember,
        signal: AbortSignal,
    ): Promise<void> {
        try {
            member.state = "ingesting";
            const document = batch.request.documents[Number(member.memberId)];
            const sourceId =
                document.source.sourceId ?? `batch-${member.contentIdentity}`;
            const sourceKey = `${batch.corpusId}\0${sourceId}`;
            if (this.forgettingSources.has(sourceKey)) {
                member.state = "cancelled";
                member.sourceId = sourceId;
                member.reason =
                    "Ingestion cancelled because source is being forgotten";
                return;
            }
            const result = await this.host.ingestDocument(
                {
                    ...document,
                    corpusId: batch.corpusId,
                    source: { ...document.source, sourceId },
                },
                signal,
            );
            Object.assign(member, {
                jobId: result.jobId,
                sourceId: result.sourceId,
                revisionId: result.revisionId,
            });
            if (this.forgettingSources.has(sourceKey))
                await this.host.cancelJob(result.jobId);
            await this.persist(batch);
            while (true) {
                const job = await this.host.getJob(result.jobId);
                if (
                    job &&
                    ["complete", "partial", "failed", "cancelled"].includes(
                        job.state,
                    )
                ) {
                    member.state =
                        job.state === "complete" || job.state === "partial"
                            ? "complete"
                            : job.state === "cancelled"
                              ? "cancelled"
                              : "failed";
                    const reason = job.error ?? job.progress.message;
                    if (reason !== undefined)
                        member.reason = boundedMessage(reason);
                    member.warnings = mergedDocumentWarnings(
                        batch.request,
                        Number(member.memberId),
                        job.warnings
                            .slice(0, 10)
                            .map((warning) => boundedMessage(warning, 500)),
                    );
                    if (job.warnings.length > 10)
                        member.warnings.push(
                            "Additional ingestion warnings omitted; inspect the canonical ingestion job",
                        );
                    if (member.state === "complete")
                        this.releaseAcquiredContent(batch, member);
                    return;
                }

                if (signal.aborted) await this.host.cancelJob(result.jobId);
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }
        } catch (error) {
            member.state = signal.aborted ? "cancelled" : "failed";
            member.reason = boundedMessage(
                error instanceof Error
                    ? error.message
                    : "Acquired document ingestion failed",
            );
        }
    }

    private releaseAcquiredContent(
        batch: StoredBatch,
        member: MemoryBatchMember,
    ): void {
        const source = batch.request.documents[Number(member.memberId)].source;
        delete source.markdown;
        delete source.text;
        delete source.html;
        delete source.assets;
    }

    public async retry(batchId: string): Promise<MemoryBatchImport> {
        if (this.active.has(batchId)) throw new Error("Batch is still running");
        if (this.active.size >= 4)
            throw new Error(
                "At most four acquired batches may run concurrently",
            );
        const batch = await this.load(batchId);
        const retryable = batch.members.filter(
            (member) =>
                member.stage !== "acquisition" &&
                member.reason !==
                    "Source forgotten; acquired content removed" &&
                ["failed", "interrupted", "cancelled"].includes(member.state),
        );
        if (
            !retryable.length &&
            batch.members.some(
                (member) =>
                    member.stage === "acquisition" && member.state === "failed",
            )
        )
            throw new Error(
                "Acquisition-rejected members require newly acquired content; core cannot retry acquisition",
            );
        if (
            !retryable.length &&
            batch.members.some(
                (member) =>
                    member.reason ===
                    "Source forgotten; acquired content removed",
            )
        )
            throw new Error(
                "Forgotten-source members require newly acquired content before retry",
            );
        for (const member of retryable) member.state = "pending";
        batch.state = "running";
        await this.persist(batch);
        this.launch(batch);
        return this.get(batchId);
    }

    public async cancel(batchId: string): Promise<MemoryBatchImport> {
        const running = this.active.get(batchId);
        if (running) {
            running.controller.abort(new Error("Batch cancellation requested"));
            await running.task;
        }
        return this.get(batchId);
    }

    public async purge(corpusId: string, sourceId?: string): Promise<void> {
        for await (const batch of this.stored()) {
            if (
                batch.corpusId !== corpusId ||
                (sourceId !== undefined &&
                    !batch.members.some(
                        (member) => member.sourceId === sourceId,
                    ))
            )
                continue;
            if (sourceId === undefined) await this.cancel(batch.batchId);
            else await this.cancelSource(corpusId, sourceId);
            if (sourceId === undefined) {
                await rm(this.file(batch.batchId), { force: true });
            } else {
                const current = await this.load(batch.batchId);
                const forgotten = current.members.filter(
                    (member) => member.sourceId === sourceId,
                );
                const keys = new Set(
                    forgotten.map(
                        (member) => member.clientKey ?? member.memberId,
                    ),
                );
                if (current.acquisitionIssues !== undefined)
                    current.acquisitionIssues =
                        current.acquisitionIssues.filter(
                            (issue) => !keys.has(issue.member),
                        );
                if (current.request.acquisitionIssues !== undefined)
                    current.request.acquisitionIssues =
                        current.request.acquisitionIssues.filter(
                            (issue) => !keys.has(issue.member),
                        );
                for (const member of forgotten) {
                    if (current.request.documentWarnings !== undefined)
                        current.request.documentWarnings[
                            Number(member.memberId)
                        ] = [];
                    current.request.documents[Number(member.memberId)] = {
                        source: {
                            sourceType: "text",
                            title: "Forgotten source",
                        },
                    };
                    delete member.sourceId;
                    delete member.revisionId;
                    delete member.jobId;
                    member.reason =
                        "Source forgotten; acquired content removed";
                    member.title = "Forgotten source";
                    member.displayName = "Forgotten source";
                    member.warnings = [];
                }

                await this.persist(current);
            }
        }
    }

    public async cancelSource(
        corpusId: string,
        sourceId: string,
    ): Promise<void> {
        const sourceKey = `${corpusId}\0${sourceId}`;
        this.forgettingSources.add(sourceKey);
        const tasks: Promise<void>[] = [];
        try {
            for (const active of this.active.values()) {
                if (active.batch.corpusId !== corpusId) continue;
                const members = active.batch.members.filter(
                    (member) =>
                        member.stage !== "acquisition" &&
                        (member.sourceId === sourceId ||
                            (active.batch.request.documents[
                                Number(member.memberId)
                            ]?.source.sourceId ??
                                `batch-${member.contentIdentity}`) ===
                                sourceId),
                );
                if (!members.length) continue;
                for (const member of members) {
                    if (member.state === "pending") {
                        member.state = "cancelled";
                        member.sourceId = sourceId;
                        member.reason =
                            "Ingestion cancelled because source is being forgotten";
                    }
                    if (
                        member.jobId !== undefined &&
                        member.state === "ingesting"
                    )
                        await this.host.cancelJob(member.jobId);
                }
                tasks.push(active.task);
            }
            // Do not abort the batch: unrelated captures remain successful.
            await Promise.all(tasks);
        } finally {
            this.forgettingSources.delete(sourceKey);
        }
    }

    public async close(): Promise<void> {
        await this.admissions;
        for (const active of this.active.values())
            active.controller.abort(new Error("Service closing"));
        await Promise.allSettled(
            [...this.active.values()].map((active) => active.task),
        );
    }
}
