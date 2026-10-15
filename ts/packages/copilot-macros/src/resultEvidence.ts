// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import type {
    PrivateResultReference,
    RecordedToolCall,
    RecordedInteractionTrace,
} from "./contracts.js";
import { redactTraceValue } from "./redaction.js";
import { recordedWorkiqReadObservations } from "./recordedReadEvidence.js";

const maxEvidenceBytes = 16 * 1024 * 1024;
const inlineBytes = 32 * 1024;
const omittedValue = "[Private result body retained in lossless evidence]";
const verifiedLearningTraces = new WeakMap<
    RecordedInteractionTrace,
    {
        traceId: string;
        digest: string;
        evidence: {
            schemaVersion: 1;
            traceId: string;
            sessionId: string;
            sourceTraceSha256: string;
            workiqRead?: ReturnType<typeof recordedWorkiqReadObservations>;
        };
    }
>();

function assertLearningTraceIdentity(trace: RecordedInteractionTrace): void {
    const hasReferences = trace.toolCalls.some(
        (call) => call.resultArtifact || call.modelResultArtifact,
    );
    if (
        (trace.schemaVersion === 1 &&
            (hasReferences || trace.capabilities !== undefined)) ||
        (trace.schemaVersion === 2 &&
            (!hasReferences ||
                trace.capabilities?.length !== 1 ||
                trace.capabilities[0] !== "private-result-evidence-v1")) ||
        (trace.schemaVersion !== 1 && trace.schemaVersion !== 2) ||
        !trace.sessionId ||
        !trace.cwd ||
        trace.toolCalls.length === 0 ||
        new Set(trace.toolCalls.map((call) => call.toolCallId)).size !==
            trace.toolCalls.length
    )
        throw new ResultEvidenceError(
            "invalidReference",
            "Unsupported learning trace identity or capabilities.",
        );
}

export function verifiedLearningEvidence(
    trace: RecordedInteractionTrace,
    traceId: string,
) {
    const verified = verifiedLearningTraces.get(trace);
    if (!verified) return undefined;
    if (
        verified.traceId !== traceId ||
        verified.digest !== digest(JSON.stringify(trace))
    )
        throw new ResultEvidenceError(
            "evidenceIntegrity",
            "Verified learning trace identity or contents changed.",
        );
    return structuredClone(verified.evidence);
}

export function cloneVerifiedLearningTrace(
    trace: RecordedInteractionTrace,
    traceId: string,
): RecordedInteractionTrace {
    verifiedLearningEvidence(trace, traceId);
    const clone = structuredClone(trace);
    const verified = verifiedLearningTraces.get(trace);
    if (verified) verifiedLearningTraces.set(clone, verified);
    return clone;
}

export class ResultEvidenceError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "ResultEvidenceError";
    }
}

function digest(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

async function readStableEvidenceFile(
    filename: string,
    info: Stats,
    sizeBytes: number,
): Promise<Buffer> {
    const handle = await open(filename, "r");
    try {
        const opened = await handle.stat();
        if (
            opened.ino !== info.ino ||
            opened.dev !== info.dev ||
            opened.size !== sizeBytes
        )
            throw new ResultEvidenceError(
                "evidenceIntegrity",
                "Private evidence file identity or size changed.",
            );
        const bytes = Buffer.alloc(sizeBytes);
        let offset = 0;
        while (offset < bytes.length) {
            const read = await handle.read(
                bytes,
                offset,
                bytes.length - offset,
                offset,
            );
            if (!read.bytesRead) break;
            offset += read.bytesRead;
        }
        if (offset !== bytes.length || (await handle.stat()).size !== sizeBytes)
            throw new ResultEvidenceError(
                "evidenceIntegrity",
                "Private evidence changed during read.",
            );
        return bytes;
    } finally {
        await handle.close();
    }
}

function project(value: unknown) {
    const omittedPaths: string[][] = [];
    const visit = (entry: unknown, segments: string[]): unknown => {
        if (typeof entry === "string") {
            if (segments.at(-1) === "base64Content" || entry.length > 4096) {
                omittedPaths.push(segments);
                return omittedValue;
            }
            return entry;
        }
        if (Array.isArray(entry))
            return entry.map((child, index) =>
                visit(child, [...segments, String(index)]),
            );
        if (entry && typeof entry === "object")
            return Object.fromEntries(
                Object.entries(entry).map(([key, child]) => [
                    key,
                    visit(child, [...segments, key]),
                ]),
            );
        return entry;
    };
    const view = redactTraceValue(visit(value, []));
    if (Buffer.byteLength(JSON.stringify(view)) > inlineBytes) {
        throw new ResultEvidenceError(
            "evidenceViewTooLarge",
            "Private evidence learning view exceeds its bound.",
        );
    }
    return { view, omittedPaths };
}

function validateBlobEncoding(
    value: unknown,
    segments: string[] = [],
    blobs: PrivateResultReference["blobs"] = [],
): PrivateResultReference["blobs"] {
    if (!value || typeof value !== "object") return blobs;
    for (const [key, child] of Object.entries(value)) {
        if (key === "base64Content") {
            if (
                typeof child !== "string" ||
                child.length % 4 !== 0 ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                    child,
                ) ||
                Buffer.from(child, "base64").toString("base64") !== child
            ) {
                throw new ResultEvidenceError(
                    "invalidEncoding",
                    "Invalid private blob base64 encoding.",
                );
            }
            const declared = (value as Record<string, unknown>).sizeBytes;
            if (
                declared !== undefined &&
                declared !== Buffer.from(child, "base64").byteLength
            )
                throw new ResultEvidenceError(
                    "evidenceIntegrity",
                    "Private blob declared size does not match its bytes.",
                );
            const decoded = Buffer.from(child, "base64");
            blobs.push({
                path: [...segments, key],
                encoding: "base64",
                sha256: digest(decoded),
                sizeBytes: decoded.byteLength,
            });
        } else validateBlobEncoding(child, [...segments, key], blobs);
    }
    return blobs;
}

function referenceId(
    ref: Pick<
        PrivateResultReference,
        "owner" | "ownerId" | "toolCallId" | "source" | "sha256"
    >,
): string {
    return digest(
        JSON.stringify([
            ref.owner,
            ref.ownerId,
            ref.toolCallId,
            ref.source,
            ref.sha256,
        ]),
    );
}

function validReference(ref: PrivateResultReference): void {
    if (
        ref.schemaVersion !== 1 ||
        ref.capability !== "private-result-evidence-v1" ||
        !["trace", "run"].includes(ref.owner) ||
        !/^[a-zA-Z0-9-]+(?![\s\S])/.test(ref.ownerId) ||
        typeof ref.toolCallId !== "string" ||
        !ref.toolCallId ||
        ref.toolCallId.length > 2000 ||
        !["result", "modelResult"].includes(ref.source) ||
        ref.encoding !== "json-utf8" ||
        ref.sensitive !== true ||
        !/^[a-f0-9]{64}$/.test(ref.sha256) ||
        !Number.isSafeInteger(ref.sizeBytes) ||
        ref.sizeBytes < 1 ||
        ref.sizeBytes > maxEvidenceBytes ||
        ref.id !== referenceId(ref)
    ) {
        throw new ResultEvidenceError(
            "invalidReference",
            "Invalid or unsupported private result reference.",
        );
    }
}

export function learningToolResult(call: RecordedToolCall): unknown {
    if (call.modelResultArtifact) return call.modelResultArtifact.view;
    if (call.modelResult !== undefined) return call.modelResult;
    return call.resultArtifact ? call.resultArtifact.view : call.result;
}

export function omittedResultPath(
    call: RecordedToolCall,
    segments: string[],
): boolean {
    const ref =
        call.modelResultArtifact ??
        (call.modelResult === undefined ? call.resultArtifact : undefined);
    return (
        ref?.omittedPaths.some((omitted) => {
            const count = Math.min(omitted.length, segments.length);
            return omitted
                .slice(0, count)
                .every((part, index) => part === segments[index]);
        }) ?? false
    );
}

export class PrivateResultStore {
    constructor(private readonly root: string) {}

    private async storageRoot(): Promise<string> {
        const root = path.resolve(this.root);
        return path.join(
            await realpath(path.dirname(root)),
            path.basename(root),
        );
    }

    private async learningTraceBytes(traceId: string): Promise<Buffer> {
        const root = await this.storageRoot();
        const filename = path.join(root, "traces", `${traceId}.json`);
        await this.checkAncestors(path.dirname(filename), root);
        const info = await lstat(filename);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
            throw new ResultEvidenceError(
                "unsafeEvidencePath",
                "Unsafe recorded learning trace.",
            );
        if (info.size > 1024 * 1024)
            throw new ResultEvidenceError(
                "evidenceIntegrity",
                "Recorded learning trace exceeds its storage bound.",
            );
        const bytes = await readStableEvidenceFile(filename, info, info.size);
        await this.checkAncestors(path.dirname(filename), root);
        const after = await lstat(filename);
        if (
            after.isSymbolicLink() ||
            after.nlink !== 1 ||
            after.ino !== info.ino ||
            after.dev !== info.dev
        )
            throw new ResultEvidenceError(
                "unsafeEvidencePath",
                "Recorded learning trace identity changed.",
            );
        return bytes;
    }

    async verifyLearningTrace(
        traceId: string,
        trace: RecordedInteractionTrace,
    ): Promise<RecordedInteractionTrace> {
        verifiedLearningTraces.delete(trace);
        if (!/^[a-zA-Z0-9-]+$/.test(traceId))
            throw new ResultEvidenceError(
                "invalidReference",
                "Invalid learning trace owner.",
            );
        const bytes = await this.learningTraceBytes(traceId);
        const sourceTrace: RecordedInteractionTrace = JSON.parse(
            bytes.toString("utf8"),
        );
        if (JSON.stringify(sourceTrace) !== JSON.stringify(trace))
            throw new ResultEvidenceError(
                "evidenceIntegrity",
                "Learning trace does not match its physical source.",
            );
        assertLearningTraceIdentity(sourceTrace);
        const originals: unknown[] = [];
        for (const call of sourceTrace.toolCalls) {
            let original = call.result;
            for (const source of ["result", "modelResult"] as const) {
                const ref =
                    source === "result"
                        ? call.resultArtifact
                        : call.modelResultArtifact;
                if (!ref) continue;
                const value = await this.verify(
                    ref,
                    "trace",
                    traceId,
                    call.toolCallId,
                    source,
                );
                if (JSON.stringify(call[source]) !== JSON.stringify(ref.view))
                    throw new ResultEvidenceError(
                        "evidenceIntegrity",
                        "Private result view does not match its recorded source.",
                    );
                if (source === "result") original = value;
            }
            originals.push(original);
        }
        if (
            JSON.stringify(trace) !== JSON.stringify(sourceTrace) ||
            !bytes.equals(await this.learningTraceBytes(traceId))
        )
            throw new ResultEvidenceError(
                "evidenceIntegrity",
                "Learning trace changed during physical verification.",
            );
        verifiedLearningTraces.set(trace, {
            traceId,
            digest: digest(JSON.stringify(trace)),
            evidence: {
                schemaVersion: 1,
                traceId,
                sessionId: sourceTrace.sessionId,
                sourceTraceSha256: digest(bytes),
                workiqRead: recordedWorkiqReadObservations(
                    sourceTrace,
                    originals,
                ),
            },
        });
        return trace;
    }

    private async directory(
        owner: string,
        ownerId: string,
        create: boolean,
    ): Promise<string> {
        const root = await this.storageRoot();
        const directories = [
            root,
            path.join(root, "evidence"),
            path.join(root, "evidence", owner),
            path.join(root, "evidence", owner, ownerId),
        ];
        for (const directory of directories) {
            if (directory !== root)
                await this.checkAncestors(path.dirname(directory), root);
            if (create) {
                try {
                    await mkdir(directory, { mode: 0o700 });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                        throw error;
                }
            }
            const info = await lstat(directory);
            if (
                !info.isDirectory() ||
                info.isSymbolicLink() ||
                path.relative(await realpath(directory), directory) !== ""
            )
                throw new ResultEvidenceError(
                    "unsafeEvidencePath",
                    "Unsafe private evidence directory.",
                );
        }
        return directories.at(-1)!;
    }

    private async checkAncestors(
        directory: string,
        root: string,
    ): Promise<void> {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new ResultEvidenceError(
                "unsafeEvidencePath",
                "Unsafe private evidence ancestor.",
            );
        const parent = path.dirname(directory);
        if (directory !== root) await this.checkAncestors(parent, root);
    }

    async retain(
        owner: "trace" | "run",
        ownerId: string,
        toolCallId: string,
        source: "result" | "modelResult",
        value: unknown,
        options: { forceFull?: boolean } = {},
    ): Promise<PrivateResultReference | undefined> {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) return undefined;
        const bytes = Buffer.from(serialized, "utf8");
        if (bytes.byteLength > maxEvidenceBytes)
            throw new ResultEvidenceError(
                "evidenceTooLarge",
                "Private result exceeds its bounded evidence size.",
            );
        const projection = project(value);
        if (
            !options.forceFull &&
            bytes.byteLength <= inlineBytes &&
            projection.omittedPaths.length === 0
        )
            return undefined;
        const blobs = validateBlobEncoding(value);
        const ref: PrivateResultReference = {
            schemaVersion: 1,
            capability: "private-result-evidence-v1",
            owner,
            ownerId,
            toolCallId,
            source,
            id: "",
            encoding: "json-utf8",
            sha256: digest(bytes),
            sizeBytes: bytes.byteLength,
            sensitive: true,
            ...projection,
            blobs,
        };
        ref.id = referenceId(ref);
        validReference(ref);
        const directory = await this.directory(owner, ownerId, true);
        const destination = path.join(directory, `${ref.id}.json`);
        const handle = await open(destination, "wx", 0o600);
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await this.verify(ref, owner, ownerId, toolCallId, source);
        return ref;
    }

    async verify(
        ref: PrivateResultReference,
        owner: "trace" | "run",
        ownerId: string,
        toolCallId: string,
        source: "result" | "modelResult",
    ): Promise<unknown> {
        validReference(ref);
        if (
            ref.owner !== owner ||
            ref.ownerId !== ownerId ||
            ref.toolCallId !== toolCallId ||
            ref.source !== source
        )
            throw new ResultEvidenceError(
                "invalidReference",
                "Private evidence owner or source does not match.",
            );
        try {
            const directory = await this.directory(owner, ownerId, false);
            const filename = path.join(directory, `${ref.id}.json`);
            const info = await lstat(filename);
            if (
                !info.isFile() ||
                info.isSymbolicLink() ||
                info.nlink !== 1 ||
                path.relative(await realpath(filename), filename) !== ""
            )
                throw new ResultEvidenceError(
                    "unsafeEvidencePath",
                    "Unsafe private evidence file.",
                );
            const bytes = await readStableEvidenceFile(
                filename,
                info,
                ref.sizeBytes,
            );
            await this.directory(owner, ownerId, false);
            const after = await lstat(filename);
            if (
                after.isSymbolicLink() ||
                after.nlink !== 1 ||
                after.ino !== info.ino ||
                after.dev !== info.dev
            )
                throw new ResultEvidenceError(
                    "unsafeEvidencePath",
                    "Private evidence file identity changed.",
                );
            if (
                bytes.byteLength !== ref.sizeBytes ||
                digest(bytes) !== ref.sha256
            )
                throw new ResultEvidenceError(
                    "evidenceIntegrity",
                    "Private evidence digest or size does not match.",
                );
            const value: unknown = JSON.parse(bytes.toString("utf8"));
            if (!Buffer.from(JSON.stringify(value), "utf8").equals(bytes))
                throw new ResultEvidenceError(
                    "invalidEncoding",
                    "Private evidence is not canonical UTF-8 JSON.",
                );
            if (
                JSON.stringify(validateBlobEncoding(value)) !==
                JSON.stringify(ref.blobs)
            )
                throw new ResultEvidenceError(
                    "evidenceIntegrity",
                    "Private evidence blob receipts do not match.",
                );
            if (
                JSON.stringify(project(value)) !==
                JSON.stringify({
                    view: ref.view,
                    omittedPaths: ref.omittedPaths,
                })
            )
                throw new ResultEvidenceError(
                    "evidenceIntegrity",
                    "Private evidence learning view does not match its source.",
                );
            return value;
        } catch (error) {
            if (error instanceof ResultEvidenceError) throw error;
            if (error instanceof SyntaxError)
                throw new ResultEvidenceError(
                    "invalidEncoding",
                    "Private evidence is not valid JSON.",
                );
            throw new ResultEvidenceError(
                "missingEvidence",
                "Private result evidence is missing or unreadable.",
            );
        }
    }
}
