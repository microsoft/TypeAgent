// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
    canonicalizeProcedure as canonicalize,
    draftAgentEdition,
    getProcedureEvidenceReferences,
    normalizeAgentEditionDocument,
    prepareAgentEditionSave,
    type RunbookBindingValidator,
} from "./agentEdition.js";
import {
    procedureFromMarkdown,
    validateProcedureDocument as validateDocument,
} from "./procedureMarkdown.js";
import { ViewHistory } from "./viewHistory.js";
import { retryProcedurePublication } from "./procedurePublication.js";
import {
    inventoryCoverage,
    inventoryEvidence,
} from "./viewInventoryCoverage.js";
import {
    versionRelationships,
    authoredRelationships,
    materializeDefinition,
} from "./viewRelationships.js";
import {
    guideFromProcedure,
    procedureFromGuide,
    assertViewIdentifier,
    viewSourceKey,
} from "./viewContent.js";
import type {
    ViewVersion,
    ViewSaveRequest,
    ViewArchiveRequest,
    ViewReadRequest,
    ViewHistoryEntry,
    ViewSnapshot,
    ViewBuildJob,
    ViewBuildRequest,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewSynthesisOutput,
    ViewMergeConflict,
    ViewConflictResolution,
} from "./viewTypes.js";
import {
    recordViewEdits,
    rebaseViewEdits,
    reconcileResolutionEdits,
    viewHash,
} from "./viewMerge.js";
export * from "./procedureMarkdown.js";
import type {
    PersonalHowToSettings,
    PersonalHowToSettingsUpdate,
    ProcedureCandidate,
    ProcedureCandidateCreateRequest,
    ProcedureDocument,
    ProcedureListRequest,
    ProcedureSaveRequest,
    ProcedureSummary,
    ProcedureVersion,
} from "./types.js";

interface ProcedureIndex {
    candidates: ProcedureCandidate[];
    procedures: ProcedureSummary[];
    indexGeneration?: string;
}

interface ViewStoreState {
    index: ProcedureIndex;
    views: Record<string, ViewVersion[]>;
    builds?: Record<string, ViewBuildJob>;
    conflicts?: Record<string, ViewMergeConflict>;
}

function viewVersions(state: ViewStoreState, viewId: string): ViewVersion[] {
    return Object.prototype.hasOwnProperty.call(state.views, viewId)
        ? state.views[viewId]
        : [];
}

export type ProcedureIndexPublisher = (
    corpusId: string,
    procedures: ProcedureSummary[],
) => Promise<string>;

const emptyIndex: ProcedureIndex = { candidates: [], procedures: [] };

function timestamp(): string {
    return new Date().toISOString();
}

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            const prefix = `${path.basename(filePath)}.`;
            let entries: string[];
            try {
                entries = await readdir(path.dirname(filePath));
            } catch (directoryError) {
                if (
                    (directoryError as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                    return undefined;
                }
                throw directoryError;
            }
            const backup = entries
                .filter(
                    (entry) =>
                        entry.startsWith(prefix) && entry.endsWith(".bak"),
                )
                .sort()
                .at(-1);
            if (backup === undefined) {
                return undefined;
            }
            try {
                await rename(
                    path.join(path.dirname(filePath), backup),
                    filePath,
                );
            } catch (renameError) {
                if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw renameError;
                }
            }
            return readJson<T>(filePath);
        }
        throw error;
    }
}

async function writeAtomic(filePath: string, value: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const backupPath = `${filePath}.${randomUUID()}.bak`;
    await writeFile(temporaryPath, value, "utf8");
    let hasBackup = false;
    try {
        await rename(filePath, backupPath);
        hasBackup = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            await rm(temporaryPath, { force: true });
            throw error;
        }
    }
    try {
        await rename(temporaryPath, filePath);
        if (hasBackup) {
            await rm(backupPath, { force: true });
        }
    } catch (error) {
        await rm(temporaryPath, { force: true });
        if (hasBackup) {
            await rename(backupPath, filePath);
        }
        throw error;
    }
}

export { detectProcedureCandidates } from "./procedureDetector.js";

export class TypedViewStore {
    private readonly pending = new Map<string, ViewVersion[]>();
    public constructor(
        private readonly rootDirectory: string,
        private readonly publishIndex: ProcedureIndexPublisher,
        private readonly runbookBindingValidator?: RunbookBindingValidator,
        private readonly actor = "local-owner",
    ) {}

    private history(corpusId: string): ViewHistory<ViewStoreState> {
        validateIdentifier("corpus ID", corpusId);
        return new ViewHistory(this.howToDirectory(corpusId), () => ({
            index: structuredClone(emptyIndex),
            views: {},
        }));
    }

    private entries(state: ViewStoreState): Record<string, string> {
        return Object.fromEntries(
            Object.entries(state.views).map(([id, versions]) => [
                `view-${encodeURIComponent(id)}.json`,
                canonicalize(versions),
            ]),
        );
    }

    public async listViews(corpusId: string): Promise<ViewSnapshot> {
        const snapshot = await this.history(corpusId).read();
        return {
            head: snapshot.head,
            views: Object.values(snapshot.state.views).map(
                (versions) => versions[versions.length - 1],
            ),
        };
    }

    public async getView(
        request: ViewReadRequest,
    ): Promise<ViewVersion | undefined> {
        assertViewIdentifier("view ID", request.viewId);
        const state = (await this.history(request.corpusId).read()).state;
        const versions = viewVersions(state, request.viewId);
        return request.revisionId === undefined
            ? versions.at(-1)
            : versions.find(
                  (version) => version.revisionId === request.revisionId,
              );
    }

    public async saveViewDraft(
        request: ViewSaveRequest,
    ): Promise<ViewHistoryEntry> {
        const history = this.history(request.corpusId);
        const { head, state } = await history.read();
        if (head !== request.expectedHead)
            throw new Error("View history head conflict");
        const versions = viewVersions(state, request.viewId);
        const current = versions.at(-1);
        if ((current?.version ?? 0) !== request.expectedVersion)
            throw new Error("View version conflict");
        if (current?.compatibility)
            throw new Error(
                "Edit saved runbooks through the procedure compatibility API",
            );
        if (current?.state === "archived")
            throw new Error(`Cannot edit a ${current.state} view`);
        const version: ViewVersion = {
            corpusId: request.corpusId,
            viewId: request.viewId,
            revisionId: randomUUID(),
            version: request.expectedVersion + 1,
            state: "draft",
            createdAt: timestamp(),
            actor: this.actor,
            provenance: "human",
            ...(current?.generation
                ? { generation: structuredClone(current.generation) }
                : {}),
            edits: recordViewEdits(
                current,
                request.content,
                request.relationships,
                this.actor,
            ),
            ...(current ? { baseRevisionId: current.revisionId } : {}),
            definition: materializeDefinition(
                request.definition,
                current?.definition,
            ),
            content: structuredClone(request.content),
            relationships: [],
        };
        version.relationships = versionRelationships(
            version,
            request.relationships,
            current?.generation !== undefined,
        );
        if (version.generation?.inventory) {
            version.generation.coverage = inventoryCoverage({
                content: request.content,
                relationships: request.relationships,
                outcome: version.generation.outcome ?? "diagnosticOnly",
                missingEvidence: ["Human edits retain source inventory limits"],
                ...inventoryEvidence(version.generation),
            });
        }
        state.views[request.viewId] = [...versions, version];
        const commitId = await history.commit(
            head,
            state,
            this.entries(state),
            this.actor,
            `Draft ${request.viewId} revision ${version.revisionId}; base ${version.baseRevisionId ?? "none"}`,
        );
        return { commitId, version };
    }

    private async commitBuildState(
        corpusId: string,
        head: string | null,
        state: ViewStoreState,
        message: string,
    ): Promise<string> {
        return this.history(corpusId).commit(
            head,
            state,
            this.entries(state),
            this.actor,
            message,
        );
    }

    public async listViewBuilds(corpusId: string): Promise<ViewBuildJob[]> {
        const { state } = await this.history(corpusId).read();
        return Object.values(state.builds ?? {})
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 100);
    }

    public async getViewBuild(
        corpusId: string,
        jobId: string,
    ): Promise<ViewBuildJob | undefined> {
        assertViewIdentifier("build job ID", jobId);
        const { state } = await this.history(corpusId).read();
        return state.builds?.[jobId];
    }

    public async admitViewBuild(
        request: ViewBuildRequest,
        snapshots: ViewBuildSnapshot[],
    ): Promise<{ job: ViewBuildJob; admitted: boolean }> {
        const { head, state } = await this.history(request.corpusId).read();
        const fingerprint = viewHash({ request, snapshots });
        const existing = Object.values(state.builds ?? {}).find(
            (job) => job.fingerprint === fingerprint,
        );
        if (existing) return { job: existing, admitted: false };
        if (head !== request.expectedHead)
            throw new Error("View history head conflict at build admission");
        const timestamp = new Date().toISOString();
        const job: ViewBuildJob = {
            jobId: randomUUID(),
            corpusId: request.corpusId,
            fingerprint,
            request: structuredClone(request),
            actor: this.actor,
            createdAt: timestamp,
            updatedAt: timestamp,
            state: "running",
            publication: false,
            results: snapshots.map((snapshot) => ({
                viewId: snapshot.definition.viewId,
                snapshot,
                state: "pending",
                reason: "Queued for cross-source synthesis",
            })),
        };
        state.builds ??= {};
        state.builds[job.jobId] = job;
        await this.commitBuildState(
            request.corpusId,
            head,
            state,
            `Admit draft build ${job.jobId}`,
        );
        return { job, admitted: true };
    }

    public async updateViewBuild(
        corpusId: string,
        jobId: string,
        update: (job: ViewBuildJob) => void,
    ): Promise<ViewBuildJob> {
        const { head, state } = await this.history(corpusId).read();
        const job = state.builds?.[jobId];
        if (!job)
            throw new Error(
                "View build was removed or forgotten; cannot persist a result",
            );
        update(job);
        job.updatedAt = timestamp();
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Build receipt ${jobId}`,
        );
        return job;
    }

    public async recoverViewBuilds(corpusId: string): Promise<void> {
        const { head, state } = await this.history(corpusId).read();
        const running = Object.values(state.builds ?? {}).filter(
            (job) => job.state === "running",
        );
        if (!running.length) return;
        for (const job of running) {
            job.state = "interrupted";
            job.updatedAt = timestamp();
            for (const result of job.results) {
                if (
                    [
                        "pending",
                        "inventorying",
                        "checkingInventory",
                        "generating",
                        "validating",
                    ].includes(result.state)
                ) {
                    result.state = "interrupted";
                    result.reason =
                        "Service restarted before durable materialization; explicit retry required";
                }
            }
        }
        await this.commitBuildState(
            corpusId,
            head,
            state,
            "Reconcile interrupted draft builds",
        );
    }

    public async getViewConflict(
        corpusId: string,
        conflictId: string,
    ): Promise<ViewMergeConflict | undefined> {
        assertViewIdentifier("conflict ID", conflictId);
        return (await this.history(corpusId).read()).state.conflicts?.[
            conflictId
        ];
    }

    public async materializeViewBuild(
        corpusId: string,
        jobId: string,
        viewId: string,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
        conflicts: string[],
    ): Promise<ViewBuildTargetResult> {
        const { head, state } = await this.history(corpusId).read();
        const job = state.builds?.[jobId];
        const result = job?.results.find((entry) => entry.viewId === viewId);
        if (!job || !result || job.state !== "running")
            throw new Error("Build is no longer eligible for materialization");
        const current = viewVersions(state, viewId).at(-1);
        if (
            (current?.version ?? 0) !== result.snapshot.expectedVersion ||
            current?.revisionId !== result.snapshot.targetRevisionId ||
            current?.state === "archived"
        )
            throw new Error("View target changed during build");
        if (conflicts.length) {
            if (!current)
                throw new Error("A missing target cannot have edit conflicts");
            this.recordMergeConflict(
                state,
                job,
                result,
                current,
                candidate,
                conflicts,
            );
        } else {
            const version = this.generatedVersion(
                result.snapshot,
                current,
                candidate,
                merged,
            );
            state.views[viewId] = [...viewVersions(state, viewId), version];
            result.state = version.provenance === "merged" ? "merged" : "draft";
            result.reason =
                "Validated draft saved; no publication, review or execution authority";
            result.revisionId = version.revisionId;
            result.missingEvidence = candidate.missingEvidence;
            if (merged.coverage) result.coverage = merged.coverage;
        }
        job.updatedAt = timestamp();
        await this.commitBuildState(
            corpusId,
            head,
            state,
            `Materialize draft build ${jobId}: ${viewId} ${result.state}`,
        );
        return result;
    }

    private recordMergeConflict(
        state: ViewStoreState,
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        current: ViewVersion,
        candidate: ViewSynthesisOutput,
        targets: string[],
    ): void {
        const identity = viewHash({
            viewId: current.viewId,
            current: current.revisionId,
            input: result.snapshot.fingerprint,
            candidate,
            targets,
        });
        state.conflicts ??= {};
        let conflict = Object.values(state.conflicts).find(
            (entry) => entry.identity === identity,
        );
        if (!conflict) {
            conflict = {
                event: {
                    kind: "viewMergeConflict",
                    editIds: (current.edits ?? [])
                        .filter((edit) => edit.status !== "cleared")
                        .map((edit) => edit.id),
                    evidence: result.snapshot.inputs.map(
                        ({ sourceId, revisionId }) => ({
                            sourceId,
                            revisionId,
                        }),
                    ),
                },
                conflictId: randomUUID(),
                identity,
                corpusId: job.corpusId,
                viewId: current.viewId,
                jobId: job.jobId,
                createdAt: timestamp(),
                actor: "memory-view-generator",
                state: "pending",
                expectedRevisionId: current.revisionId,
                input: result.snapshot,
                base: current.generation,
                human: current,
                candidate,
                targets,
                reason: "Explicit edits cannot be preserved safely; authenticated resolution required",
            };
            state.conflicts[conflict.conflictId] = conflict;
        }
        result.state = "conflicted";
        result.conflictId = conflict.conflictId;
        result.reason = conflict.reason;
    }

    private generatedVersion(
        input: ViewBuildSnapshot,
        current: ViewVersion | undefined,
        candidate: ViewSynthesisOutput,
        merged: ViewSynthesisOutput,
    ): ViewVersion & {
        generation: NonNullable<ViewVersion["generation"]>;
        edits: NonNullable<ViewVersion["edits"]>;
    } {
        const candidateId = randomUUID();
        const edits = rebaseViewEdits(current, candidate, merged, candidateId);
        const version: ViewVersion & {
            generation: NonNullable<ViewVersion["generation"]>;
            edits: NonNullable<ViewVersion["edits"]>;
        } = {
            corpusId: input.corpusId,
            viewId: input.definition.viewId,
            revisionId: randomUUID(),
            version: (current?.version ?? 0) + 1,
            state: "draft",
            createdAt: timestamp(),
            actor: "memory-view-generator",
            ...(current ? { baseRevisionId: current.revisionId } : {}),
            provenance: edits.some((edit) => edit.status !== "cleared")
                ? "merged"
                : "generated",
            definition: materializeDefinition(
                input.definition,
                current?.definition,
            ),
            content: structuredClone(merged.content),
            generation: {
                candidateId,
                content: structuredClone(candidate.content),
                fingerprint: viewHash(candidate.content),
                relationships: structuredClone(candidate.relationships),
                input,
                outcome: candidate.outcome,
                ...inventoryEvidence(merged),
            },
            edits,
            relationships: [],
        };
        version.relationships = versionRelationships(
            version,
            merged.relationships,
            true,
        );
        return version;
    }

    public async resolveViewConflict(
        request: ViewConflictResolution,
        output: ViewSynthesisOutput,
    ): Promise<ViewHistoryEntry> {
        const { head, state } = await this.history(request.corpusId).read();
        const conflict = state.conflicts?.[request.conflictId];
        const current = conflict && viewVersions(state, conflict.viewId).at(-1);
        if (
            head !== request.expectedHead ||
            !conflict ||
            conflict.state !== "pending" ||
            !current ||
            current.version !== request.expectedVersion ||
            current.revisionId !== request.expectedRevisionId ||
            current.revisionId !== conflict.expectedRevisionId ||
            request.inputFingerprint !== conflict.input.fingerprint
        )
            throw new Error(
                "Conflict resolution head/target/input guard changed",
            );
        const version = this.generatedVersion(
            conflict.input,
            current,
            conflict.candidate,
            output,
        );
        version.actor = this.actor;
        version.provenance = "human";
        if (request.choice === "generated")
            version.edits = (current.edits ?? []).map((edit) => ({
                ...edit,
                status: "cleared",
            }));
        else {
            const baseline = {
                ...version,
                content: conflict.candidate.content,
                edits: [],
                relationships: versionRelationships(
                    version,
                    conflict.candidate.relationships,
                    true,
                ),
            };
            const fresh = recordViewEdits(
                baseline,
                output.content,
                output.relationships,
                this.actor,
            );
            version.edits = reconcileResolutionEdits(
                current,
                version.edits,
                fresh,
                output,
            );
        }
        version.relationships = versionRelationships(
            version,
            output.relationships,
            true,
        );
        state.views[version.viewId] = [
            ...viewVersions(state, version.viewId),
            version,
        ];
        conflict.state = "resolved";
        conflict.resolutionRevisionId = version.revisionId;
        const commitId = await this.commitBuildState(
            request.corpusId,
            head,
            state,
            `Resolve view conflict ${conflict.conflictId} by ${this.actor}`,
        );
        return { commitId, version };
    }

    public async archiveView(
        request: ViewArchiveRequest,
    ): Promise<ViewHistoryEntry> {
        const history = this.history(request.corpusId);
        const { head, state } = await history.read();
        if (head !== request.expectedHead)
            throw new Error("View history head conflict");
        const versions = viewVersions(state, request.viewId);
        const current = versions.at(-1);
        if (!current) throw new Error(`Unknown view '${request.viewId}'`);
        if (current.version !== request.expectedVersion)
            throw new Error("View version conflict");
        if (current.compatibility)
            throw new Error(
                "Archive saved runbooks through the procedure compatibility API",
            );
        if (current.state === "archived")
            throw new Error("View is already archived");
        const version: ViewVersion = {
            ...current,
            revisionId: randomUUID(),
            version: current.version + 1,
            baseRevisionId: current.revisionId,
            state: "archived",
            actor: this.actor,
            createdAt: timestamp(),
        };
        version.relationships = versionRelationships(
            version,
            authoredRelationships(current),
            current.generation?.input !== undefined,
        );
        state.views[request.viewId] = [...versions, version];
        const commitId = await history.commit(
            head,
            state,
            this.entries(state),
            this.actor,
            `Archive ${request.viewId}`,
        );
        return { commitId, version };
    }

    public async getViewHistory(
        request: ViewReadRequest,
    ): Promise<ViewHistoryEntry[]> {
        assertViewIdentifier("view ID", request.viewId);
        const commits = (
            await this.history(request.corpusId).history()
        ).reverse();
        const seen = new Set<string>();
        const entries = commits.flatMap(({ commitId, state }) => {
            const versions = viewVersions(state, request.viewId);
            return versions.flatMap((version) => {
                if (seen.has(version.revisionId)) return [];
                seen.add(version.revisionId);
                return [{ commitId, version }];
            });
        });
        return entries
            .reverse()
            .filter(
                (entry) =>
                    request.revisionId === undefined ||
                    entry.version.revisionId === request.revisionId,
            );
    }

    private sanitize(state: ViewStoreState, sourceId: string): ViewStoreState {
        const affected = new Set(
            Object.entries(state.views).flatMap(([id, versions]) =>
                versions.some((version) => {
                    const content = [
                        version.content,
                        ...(version.generation
                            ? [version.generation.content]
                            : []),
                    ];
                    const references = content.flatMap((item) => {
                        const evidence = getProcedureEvidenceReferences(item);
                        return [...evidence.citations, ...evidence.assets];
                    });
                    return (
                        version.definition.selector.sources.some(
                            (source) => source.sourceId === sourceId,
                        ) ||
                        references.some(
                            (citation) => citation.sourceId === sourceId,
                        )
                    );
                })
                    ? [id]
                    : [],
            ),
        );
        state.views = Object.fromEntries(
            Object.entries(state.views).filter(([id]) => !affected.has(id)),
        );
        state.builds = Object.fromEntries(
            Object.entries(state.builds ?? {}).filter(
                ([, job]) =>
                    !job.results.some(
                        (result) =>
                            result.snapshot.inputs.some(
                                (input) => input.sourceId === sourceId,
                            ) || affected.has(result.viewId),
                    ),
            ),
        );
        state.conflicts = Object.fromEntries(
            Object.entries(state.conflicts ?? {}).filter(
                ([, conflict]) =>
                    !affected.has(conflict.viewId) &&
                    !conflict.input.inputs.some(
                        (input) => input.sourceId === sourceId,
                    ),
            ),
        );
        state.index.procedures = state.index.procedures.filter(
            (item) => !affected.has(item.procedureId),
        );
        state.index.candidates = state.index.candidates.filter((candidate) => {
            const references = getProcedureEvidenceReferences(candidate);
            return ![...references.citations, ...references.assets].some(
                (citation) => citation.sourceId === sourceId,
            );
        });
        delete state.index.indexGeneration;
        return state;
    }

    public async forgetSource(
        corpusId: string,
        sourceId: string,
    ): Promise<void> {
        await this.history(corpusId).purge(
            sourceId,
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
        await this.rebuildIndex(corpusId);
    }

    public async recover(corpusId: string): Promise<void> {
        await this.history(corpusId).recoverPurge(
            (state, id) => this.sanitize(state, id),
            (state) => this.entries(state),
            () => this.removeSearchIndex(corpusId),
        );
    }

    private async removeSearchIndex(corpusId: string): Promise<void> {
        await retryProcedurePublication(() =>
            rm(path.join(this.howToDirectory(corpusId), "search-index"), {
                recursive: true,
                force: true,
            }),
        );
    }

    public async getIndexGeneration(
        corpusId: string,
    ): Promise<string | undefined> {
        return (await this.readIndex(corpusId)).indexGeneration;
    }

    public readIndexedVersion(
        corpusId: string,
        procedureId: string,
        version: number,
    ): Promise<ProcedureVersion> {
        return this.readVersion(corpusId, procedureId, version);
    }

    public async rebuildIndex(corpusId: string): Promise<void> {
        const index = await this.readIndex(corpusId);
        await this.writePublishedIndex(corpusId, index);
    }

    private async writePublishedIndex(
        corpusId: string,
        index: ProcedureIndex,
    ): Promise<void> {
        try {
            index.indexGeneration = await this.publishIndex(
                corpusId,
                index.procedures,
            );
            await this.writeIndex(corpusId, index);
        } finally {
            this.pending.delete(corpusId);
        }
    }

    public async getSettings(corpusId: string): Promise<PersonalHowToSettings> {
        const stored = await readJson<PersonalHowToSettings>(
            this.settingsPath(corpusId),
        );
        return structuredClone(stored ?? this.defaultSettings());
    }

    public async updateSettings(
        corpusId: string,
        update: PersonalHowToSettingsUpdate,
    ): Promise<PersonalHowToSettings> {
        const current = await this.getSettings(corpusId);
        if (current.revision !== update.expectedRevision) {
            throw new Error(
                `Personal how-to settings revision conflict: expected ${update.expectedRevision}, actual ${current.revision}`,
            );
        }
        const next: PersonalHowToSettings = {
            revision: current.revision + 1,
            updatedAt: timestamp(),
            enabled: update.enabled ?? current.enabled,
            detectCandidates:
                update.detectCandidates ?? current.detectCandidates,
            ...(update.preferences === undefined &&
            current.preferences === undefined
                ? {}
                : {
                      preferences:
                          update.preferences ?? current.preferences ?? {},
                  }),
        };
        await writeAtomic(this.settingsPath(corpusId), canonicalize(next));
        return structuredClone(next);
    }

    public async createCandidate(
        request: ProcedureCandidateCreateRequest,
    ): Promise<ProcedureCandidate> {
        request = normalizeAgentEditionDocument(
            request,
        ) as ProcedureCandidateCreateRequest;
        validateDocument(request);
        const index = await this.readIndex(request.corpusId);
        const candidateId = request.candidateId ?? randomUUID();
        validateIdentifier("candidate ID", candidateId);
        if (
            index.candidates.some(
                (candidate) => candidate.candidateId === candidateId,
            )
        ) {
            throw new Error(
                `Procedure candidate '${candidateId}' already exists`,
            );
        }
        const createdAt = timestamp();
        const candidate: ProcedureCandidate = {
            candidateId,
            corpusId: request.corpusId,
            state: request.state ?? "detected",
            title: request.title.trim(),
            ...(request.agentEdition === undefined
                ? {}
                : {
                      agentEdition: draftAgentEdition(
                          request.agentEdition,
                          "Synthesized edition requires review",
                      ),
                  }),
            ...(request.summary === undefined
                ? {}
                : { summary: request.summary }),
            steps: structuredClone(request.steps),
            citations: structuredClone(request.citations),
            ...(request.additionalSections === undefined
                ? {}
                : {
                      additionalSections: structuredClone(
                          request.additionalSections,
                      ),
                  }),
            createdAt,
            updatedAt: createdAt,
        };
        index.candidates.push(candidate);
        await this.writeIndex(request.corpusId, index);
        return structuredClone(candidate);
    }

    public async createDetectedCandidates(
        requests: ProcedureCandidateCreateRequest[],
    ): Promise<ProcedureCandidate[]> {
        if (requests.length === 0) {
            return [];
        }
        const corpusId = requests[0].corpusId;
        if (requests.some((request) => request.corpusId !== corpusId)) {
            throw new Error("Detected candidates must belong to one corpus");
        }
        const index = await this.readIndex(corpusId);
        const existingIds = new Set(
            index.candidates.map((candidate) => candidate.candidateId),
        );
        const created: ProcedureCandidate[] = [];
        for (const request of requests) {
            validateDocument(request);
            const candidateId = request.candidateId;
            if (candidateId === undefined) {
                throw new Error("Detected candidates require an identifier");
            }
            validateIdentifier("candidate ID", candidateId);
            if (existingIds.has(candidateId)) {
                continue;
            }
            const createdAt = timestamp();
            const candidate: ProcedureCandidate = {
                candidateId,
                corpusId,
                state: "detected",
                title: request.title.trim(),
                ...(request.summary === undefined
                    ? {}
                    : { summary: request.summary }),
                steps: structuredClone(request.steps),
                citations: structuredClone(request.citations),
                ...(request.agentEdition === undefined
                    ? {}
                    : {
                          agentEdition: draftAgentEdition(
                              normalizeAgentEditionDocument(request)
                                  .agentEdition!,
                              "Synthesized edition requires review",
                          ),
                      }),
                ...(request.additionalSections === undefined
                    ? {}
                    : {
                          additionalSections: structuredClone(
                              request.additionalSections,
                          ),
                      }),
                createdAt,
                updatedAt: createdAt,
            };
            existingIds.add(candidateId);
            index.candidates.push(candidate);
            created.push(candidate);
        }
        if (created.length > 0) {
            await this.writeIndex(corpusId, index);
        }
        return structuredClone(created);
    }

    public async getCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate | undefined> {
        const candidate = (await this.readIndex(corpusId)).candidates.find(
            (item) => item.candidateId === candidateId,
        );
        return candidate === undefined ? undefined : structuredClone(candidate);
    }

    public async listCandidates(
        corpusId: string,
        states?: ProcedureCandidate["state"][],
    ): Promise<ProcedureCandidate[]> {
        return (await this.readIndex(corpusId)).candidates
            .filter(
                (candidate) =>
                    states === undefined || states.includes(candidate.state),
            )
            .sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt),
            )
            .map((candidate) => structuredClone(candidate));
    }

    public async rejectCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate> {
        const index = await this.readIndex(corpusId);
        const candidate = index.candidates.find(
            (item) => item.candidateId === candidateId,
        );
        if (candidate === undefined) {
            throw new Error(`Unknown procedure candidate '${candidateId}'`);
        }
        if (candidate.state === "saved") {
            throw new Error("A saved procedure candidate cannot be rejected");
        }
        candidate.state = "rejected";
        candidate.updatedAt = timestamp();
        await this.writeIndex(corpusId, index);
        return structuredClone(candidate);
    }

    public async save(
        request: ProcedureSaveRequest,
    ): Promise<ProcedureVersion> {
        const index = await this.readIndex(request.corpusId);
        const candidate =
            request.candidateId === undefined
                ? undefined
                : index.candidates.find(
                      (item) => item.candidateId === request.candidateId,
                  );
        if (request.candidateId !== undefined && candidate === undefined) {
            throw new Error(
                `Unknown procedure candidate '${request.candidateId}'`,
            );
        }
        if (
            Number(request.document !== undefined) +
                Number(request.markdown !== undefined) >
            1
        ) {
            throw new Error(
                "Supply either procedure JSON or Markdown, not both",
            );
        }
        const candidateDocument =
            candidate === undefined
                ? undefined
                : {
                      title: candidate.title,
                      ...(candidate.summary === undefined
                          ? {}
                          : { summary: candidate.summary }),
                      steps: candidate.steps,
                      citations: candidate.citations,
                      ...(candidate.agentEdition === undefined
                          ? {}
                          : {
                                agentEdition: candidate.agentEdition,
                            }),
                      ...(candidate.additionalSections === undefined
                          ? {}
                          : {
                                additionalSections:
                                    candidate.additionalSections,
                            }),
                  };
        let document =
            request.markdown !== undefined
                ? procedureFromMarkdown(request.markdown)
                : structuredClone(request.document ?? candidateDocument);
        if (document === undefined) {
            throw new Error(
                "Procedure JSON, Markdown, or candidate is required",
            );
        }
        validateDocument(document);
        const procedureId =
            request.procedureId ?? request.candidateId ?? randomUUID();
        validateIdentifier("procedure ID", procedureId);
        const summary = index.procedures.find(
            (item) => item.procedureId === procedureId,
        );
        const currentVersion = summary?.latestVersion ?? 0;
        if (
            request.expectedVersion !== undefined &&
            request.expectedVersion !== currentVersion
        ) {
            throw new Error(
                `Procedure version conflict: expected ${request.expectedVersion}, actual ${currentVersion}`,
            );
        }
        const previous =
            currentVersion === 0
                ? undefined
                : await this.readVersion(
                      request.corpusId,
                      procedureId,
                      currentVersion,
                  );
        if (request.markdown !== undefined && previous !== undefined) {
            document = procedureFromMarkdown(
                request.markdown,
                previous.document,
            );
        }
        document = await prepareAgentEditionSave(
            document,
            request,
            currentVersion + 1,
            previous,
            this.runbookBindingValidator,
        );
        const version = await this.writeVersion(
            request.corpusId,
            procedureId,
            currentVersion + 1,
            "saved",
            document,
            request.candidateId,
            currentVersion === 0 ? undefined : currentVersion,
        );
        this.setSummary(index, version);
        if (candidate !== undefined) {
            candidate.state = "saved";
            candidate.updatedAt = timestamp();
        }
        await this.writePublishedIndex(request.corpusId, index);
        return version;
    }

    public async list(
        request: ProcedureListRequest,
    ): Promise<ProcedureSummary[]> {
        return (await this.readIndex(request.corpusId)).procedures
            .filter(
                (summary) =>
                    request.states === undefined ||
                    request.states.includes(summary.state),
            )
            .sort((left, right) => left.title.localeCompare(right.title))
            .map((summary) => structuredClone(summary));
    }

    public async get(
        corpusId: string,
        procedureId: string,
        version?: number,
    ): Promise<ProcedureVersion | undefined> {
        const summary = (await this.readIndex(corpusId)).procedures.find(
            (item) => item.procedureId === procedureId,
        );
        if (
            summary === undefined ||
            (version !== undefined && version > summary.latestVersion)
        ) {
            return undefined;
        }
        return this.readVersion(
            corpusId,
            procedureId,
            version ?? summary.latestVersion,
        );
    }

    public async archive(
        corpusId: string,
        procedureId: string,
        expectedVersion?: number,
    ): Promise<ProcedureVersion> {
        return this.transition(
            corpusId,
            procedureId,
            "archived",
            expectedVersion,
        );
    }

    public async markStale(
        corpusId: string,
        sourceId: string,
        activeRevisionId?: string,
    ): Promise<void> {
        const index = await this.readIndex(corpusId);
        const history = this.history(corpusId);
        const snapshot = await history.read();
        let draftChanged = false;
        for (const [id, versions] of Object.entries(snapshot.state.views)) {
            const current = versions.at(-1)!;
            if (
                current.compatibility ||
                current.state !== "draft" ||
                !current.definition.selector.sources.some(
                    (source) =>
                        source.sourceId === sourceId &&
                        source.revisionId !== activeRevisionId,
                )
            )
                continue;
            const next: ViewVersion = {
                ...current,
                revisionId: randomUUID(),
                version: current.version + 1,
                baseRevisionId: current.revisionId,
                state: "stale",
                actor: "memory-service",
                createdAt: timestamp(),
            };
            next.relationships = versionRelationships(
                next,
                authoredRelationships(current),
                current.generation?.input !== undefined,
            );
            snapshot.state.views[id] = [...versions, next];
            draftChanged = true;
        }
        if (draftChanged)
            await history.commit(
                snapshot.head,
                snapshot.state,
                this.entries(snapshot.state),
                "memory-service",
                "Invalidate changed source revisions",
            );
        let changed = false;
        for (const summary of index.procedures) {
            if (summary.state !== "saved") {
                continue;
            }
            const current = await this.readVersion(
                corpusId,
                summary.procedureId,
                summary.latestVersion,
            );
            const typed = snapshot.state.views[summary.procedureId]?.at(-1);
            if (!typed)
                throw new Error("Saved procedure has no typed view version");
            const dependsOnChangedRevision =
                typed.definition.selector.sources.some(
                    (source) =>
                        source.sourceId === sourceId &&
                        source.revisionId !== activeRevisionId,
                );
            if (!dependsOnChangedRevision) {
                continue;
            }
            const stale = await this.writeVersion(
                corpusId,
                summary.procedureId,
                current.version + 1,
                "stale",
                current.document,
                current.basedOnCandidateId,
                current.version,
            );
            this.setSummary(index, stale);
            changed = true;
        }
        if (changed) {
            await this.writePublishedIndex(corpusId, index);
        }
    }

    private async transition(
        corpusId: string,
        procedureId: string,
        state: "stale" | "archived",
        expectedVersion?: number,
    ): Promise<ProcedureVersion> {
        const index = await this.readIndex(corpusId);
        const summary = index.procedures.find(
            (item) => item.procedureId === procedureId,
        );
        if (summary === undefined) {
            throw new Error(`Unknown procedure '${procedureId}'`);
        }
        if (
            expectedVersion !== undefined &&
            expectedVersion !== summary.latestVersion
        ) {
            throw new Error(
                `Procedure version conflict: expected ${expectedVersion}, actual ${summary.latestVersion}`,
            );
        }
        const current = await this.readVersion(
            corpusId,
            procedureId,
            summary.latestVersion,
        );
        const next = await this.writeVersion(
            corpusId,
            procedureId,
            current.version + 1,
            state,
            current.document,
            current.basedOnCandidateId,
            current.version,
        );
        this.setSummary(index, next);
        await this.writePublishedIndex(corpusId, index);
        return next;
    }

    private async writeVersion(
        corpusId: string,
        procedureId: string,
        version: number,
        state: "saved" | "stale" | "archived",
        document: ProcedureDocument,
        basedOnCandidateId?: string,
        previousVersion?: number,
    ): Promise<ProcedureVersion> {
        if (state !== "saved" && document.agentEdition !== undefined) {
            document = {
                ...document,
                agentEdition: draftAgentEdition(
                    document.agentEdition,
                    `Procedure is ${state}`,
                ),
            };
        }
        const snapshot = (await this.history(corpusId).read()).state;
        const current = viewVersions(snapshot, procedureId).at(-1);
        if (current && !current.compatibility)
            throw new Error(
                "A draft view cannot be overwritten through procedure APIs",
            );
        const generatedCandidate =
            basedOnCandidateId === undefined
                ? undefined
                : snapshot.index.candidates.find(
                      (candidate) =>
                          candidate.candidateId === basedOnCandidateId,
                  );
        const generatedContent =
            generatedCandidate === undefined
                ? undefined
                : guideFromProcedure(generatedCandidate);
        const generation =
            generatedContent === undefined
                ? current?.generation
                : {
                      candidateId: basedOnCandidateId!,
                      content: generatedContent,
                      fingerprint: createHash("sha256")
                          .update(canonicalize(generatedContent))
                          .digest("hex"),
                  };
        const evidence = [
            getProcedureEvidenceReferences(document),
            ...(generation
                ? [getProcedureEvidenceReferences(generation.content)]
                : []),
        ].flatMap(({ citations, assets }) => [...citations, ...assets]);
        const next: ViewVersion = {
            corpusId,
            viewId: procedureId,
            revisionId: randomUUID(),
            version,
            state: state === "saved" ? "draft" : state,
            createdAt: timestamp(),
            actor: this.actor,
            provenance: "procedure",
            ...(current ? { baseRevisionId: current.revisionId } : {}),
            ...(generation === undefined ? {} : { generation }),
            definition: materializeDefinition(
                {
                    viewId: procedureId,
                    kind: "procedure",
                    selector: {
                        kind: "sources",
                        sources: [
                            ...new Map(
                                evidence.map((citation) => [
                                    viewSourceKey(citation),
                                    {
                                        sourceId: citation.sourceId,
                                        revisionId: citation.revisionId,
                                    },
                                ]),
                            ).values(),
                        ],
                    },
                },
                current?.definition,
            ),
            content: guideFromProcedure(document, current),
            relationships: [],
            compatibility: {
                state,
                ...(basedOnCandidateId === undefined
                    ? {}
                    : { basedOnCandidateId }),
                ...(previousVersion === undefined ? {} : { previousVersion }),
            },
        };
        next.relationships = versionRelationships(
            next,
            current ? authoredRelationships(current) : [],
        );
        this.pending.set(corpusId, [
            ...(this.pending.get(corpusId) ?? []),
            next,
        ]);
        return procedureFromGuide(next);
    }

    private async readVersion(
        corpusId: string,
        procedureId: string,
        version: number,
    ): Promise<ProcedureVersion> {
        const staged = this.pending
            .get(corpusId)
            ?.find(
                (item) =>
                    item.viewId === procedureId && item.version === version,
            );
        const snapshot = (await this.history(corpusId).read()).state;
        const stored =
            staged ??
            viewVersions(snapshot, procedureId).find(
                (item) => item.version === version,
            );
        if (!stored)
            throw new Error(
                `Unknown procedure '${procedureId}' version ${version}`,
            );
        const result = procedureFromGuide(stored);
        validateDocument(result.document);
        return result;
    }

    private setSummary(index: ProcedureIndex, version: ProcedureVersion): void {
        const next: ProcedureSummary = {
            corpusId: version.corpusId,
            procedureId: version.procedureId,
            title: version.document.title,
            state: version.state,
            latestVersion: version.version,
            updatedAt: version.createdAt,
        };
        index.procedures = [
            ...index.procedures.filter(
                (item) => item.procedureId !== version.procedureId,
            ),
            next,
        ];
    }

    private async readIndex(corpusId: string): Promise<ProcedureIndex> {
        return (await this.history(corpusId).read()).state.index;
    }

    private async writeIndex(
        corpusId: string,
        index: ProcedureIndex,
    ): Promise<void> {
        const history = this.history(corpusId);
        const { head, state } = await history.read();
        state.index = index;
        for (const version of this.pending.get(corpusId) ?? []) {
            state.views[version.viewId] = [
                ...viewVersions(state, version.viewId),
                version,
            ];
        }
        try {
            await history.commit(
                head,
                state,
                this.entries(state),
                this.actor,
                "Save procedure state",
            );
        } finally {
            this.pending.delete(corpusId);
        }
    }

    private defaultSettings(): PersonalHowToSettings {
        return {
            revision: 0,
            updatedAt: new Date(0).toISOString(),
            enabled: true,
            detectCandidates: true,
        };
    }

    private howToDirectory(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, "personal-how-to");
    }

    private settingsPath(corpusId: string): string {
        return path.join(this.howToDirectory(corpusId), "settings.json");
    }
}

export { TypedViewStore as PersonalHowToStore };
