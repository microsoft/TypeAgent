// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
    validateReviewedAgentEdition,
    type MemoryService,
    type PersonalHowToService,
    type ProcedureVersion,
    type ProcedureSummary,
} from "@typeagent/memory-service";
import type { RunbookHostCapabilities } from "@typeagent/agent-server-protocol";
import type {
    MemoryHubRunbookFunctions,
    RunbookSummary,
    RunbookListRequest,
    RunbookSkill,
    RunbookError,
    RunbookSkillPreview,
    RunbookUsage,
} from "@typeagent/browser-control-rpc/viewRpc";
import { queryCorpora, timed } from "./memoryHubQuery.mjs";
import { mapMemoryHubCorpora } from "./memoryHub.mjs";
import {
    createRunbookCatalog,
    readRunbookSkillText,
} from "./memoryHubRunbookCatalog.mjs";
import {
    acceptRunbookBinding,
    suggestRunbookBindings,
    runbookDrift,
    requireRunbookVersion,
} from "./memoryHubRunbookBindings.mjs";
import {
    loadRunbookOriginal,
    runbookOriginals,
    runbookHistory,
    compareRunbook,
} from "./memoryHubRunbookOriginals.mjs";
import { readRunbookAsset } from "./memoryHubRunbookAssets.mjs";
import { sourceViewUsage } from "./memoryHubViewUsage.mjs";

type Service = MemoryService & PersonalHowToService;
const procedureMethods: ReadonlyArray<keyof PersonalHowToService> = [
    "getPersonalHowToSettings",
    "updatePersonalHowToSettings",
    "createProcedureCandidate",
    "getProcedureCandidate",
    "listProcedureCandidates",
    "rejectProcedureCandidate",
    "saveProcedure",
    "listProcedures",
    "getProcedure",
    "searchProcedures",
    "archiveProcedure",
];
function requireProcedureService(service: MemoryService): Service {
    function supportsProcedures(value: MemoryService): value is Service {
        return procedureMethods.every(
            (method) => typeof Reflect.get(value, method) === "function",
        );
    }
    if (!supportsProcedures(service))
        throw new Error("Canonical Runbook storage is unavailable");
    return service;
}
function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function procedureSkills(
    skills: RunbookSkill[],
    corpusId: string,
    procedureId: string,
): RunbookSkill[] {
    return skills
        .filter(
            (skill) =>
                skill.lineage?.corpusId === corpusId &&
                skill.lineage.procedureId === procedureId,
        )
        .sort(
            (left, right) =>
                right.createdAt.localeCompare(left.createdAt) ||
                left.revisionId.localeCompare(right.revisionId),
        );
}

function procedureReadiness(
    procedure: ProcedureVersion,
    skills: RunbookSkill[],
    drift: RunbookSummary["drift"],
): RunbookSummary["readiness"] {
    const currentSkills = skills.filter(
        (skill) =>
            skill.lineage?.version === procedure.version &&
            skill.lineage.jsonHash === procedure.jsonHash &&
            skill.lineage.markdownHash === procedure.markdownHash,
    );
    if (currentSkills.some((skill) => skill.active)) return "active";
    if (currentSkills.some((skill) => skill.state !== "archived"))
        return "skill";
    const edition = procedure.document.agentEdition;
    if (!edition) return "howto";
    if (procedure.state !== "saved" || edition.review.state !== "reviewed")
        return "howto";
    validateReviewedAgentEdition(procedure);
    const allBound =
        edition.steps.length > 0 &&
        edition.steps.every(
            (step) =>
                step.binding?.accepted &&
                ["mcp", "macro", "flow"].includes(step.binding.kind),
        );
    return allBound && !drift.length ? "toolsBound" : "runbook";
}

function matches(item: RunbookSummary, request: RunbookListRequest): boolean {
    return (
        (!request.query ||
            item.title
                .toLocaleLowerCase()
                .includes(request.query.toLocaleLowerCase())) &&
        (!request.states?.length || request.states.includes(item.state)) &&
        (!request.readiness?.length ||
            request.readiness.includes(item.readiness)) &&
        (request.needsReview !== true ||
            item.kind === "candidate" ||
            item.state === "stale" ||
            item.editionState === "draft" ||
            item.drift.length > 0)
    );
}

const cursorSchema = z.strictObject({
    scope: z.string(),
    offset: z.number().int().nonnegative(),
});
function pageItems<T>(
    items: T[],
    request: { pageSize?: number; continuationToken?: string },
    scope: string,
) {
    const pageSize = request.pageSize ?? 25;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
        throw new Error("Runbook page size must be between 1 and 100");
    let offset = 0;
    if (request.continuationToken !== undefined) {
        let cursor: z.infer<typeof cursorSchema>;
        try {
            cursor = cursorSchema.parse(
                JSON.parse(
                    Buffer.from(
                        request.continuationToken,
                        "base64url",
                    ).toString("utf8"),
                ),
            );
        } catch {
            throw new Error("Invalid Runbook page token");
        }
        if (cursor.scope !== scope)
            throw new Error(
                "Runbook results changed or page token belongs to another scope; refresh the list",
            );
        offset = cursor.offset;
    }
    if (offset > items.length)
        throw new Error("Runbook page token is outside available results");
    const end = offset + pageSize;
    return {
        items: items.slice(offset, end),
        total: items.length,
        ...(end < items.length
            ? {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify({ scope, offset: end }),
                  ).toString("base64url"),
              }
            : {}),
    };
}
function pageScope(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createMemoryHubRunbookFunctions(
    getService: () => MemoryService,
    getCapabilities: () => RunbookHostCapabilities | undefined,
): MemoryHubRunbookFunctions {
    const catalog = createRunbookCatalog(getCapabilities);
    const versions = new Map<string, Promise<ProcedureVersion>>();
    const service = () => requireProcedureService(getService());
    async function currentVersion(
        summary: ProcedureSummary,
    ): Promise<ProcedureVersion> {
        const key = JSON.stringify([
            summary.corpusId,
            summary.procedureId,
            summary.latestVersion,
            summary.state,
            summary.updatedAt,
        ]);
        let pending = versions.get(key);
        if (!pending) {
            pending = requireRunbookVersion(
                service(),
                summary.corpusId,
                summary.procedureId,
                summary.latestVersion,
            );
            versions.set(key, pending);
            void pending.catch(() => versions.delete(key));
        }
        return pending;
    }
    async function retainedVersion(
        summary: ProcedureSummary,
        version: number,
    ): Promise<ProcedureVersion> {
        if (version === summary.latestVersion) return currentVersion(summary);
        const key = JSON.stringify([
            summary.corpusId,
            summary.procedureId,
            version,
            summary.updatedAt,
        ]);
        let pending = versions.get(key);
        if (!pending) {
            pending = requireRunbookVersion(
                service(),
                summary.corpusId,
                summary.procedureId,
                version,
            );
            versions.set(key, pending);
            void pending.catch(() => versions.delete(key));
        }
        return pending;
    }
    async function summarize(
        summary: ProcedureSummary,
        corpusName: string,
        skills: RunbookSkill[],
    ): Promise<RunbookSummary> {
        const procedure = await currentVersion(summary);
        const linked = procedureSkills(
            skills,
            summary.corpusId,
            summary.procedureId,
        );
        const drift = await runbookDrift(procedure, getCapabilities());
        const edition = procedure.document.agentEdition;
        return {
            id: JSON.stringify([
                "procedure",
                summary.corpusId,
                summary.procedureId,
            ]),
            kind: "procedure",
            corpusId: summary.corpusId,
            corpusName,
            objectId: summary.procedureId,
            title: summary.title,
            state: summary.state,
            readiness: procedureReadiness(procedure, linked, drift),
            latestVersion: summary.latestVersion,
            updatedAt: summary.updatedAt,
            ...(edition === undefined
                ? {}
                : { editionState: edition.review.state }),
            boundSteps:
                edition?.steps.filter(
                    (step) =>
                        step.binding?.accepted &&
                        ["mcp", "macro", "flow"].includes(step.binding.kind),
                ).length ?? 0,
            totalSteps:
                edition?.steps.length ?? procedure.document.steps.length,
            skills: linked,
            drift,
        };
    }
    async function list(request: RunbookListRequest) {
        const memory = service();
        const [corpora, skills] = await Promise.all([
            queryCorpora(memory, request.corpusId),
            catalog.list(),
        ]);
        const errors: RunbookError[] = [];
        const results = await mapMemoryHubCorpora(corpora, async (corpus) => {
            const items: RunbookSummary[] = [];
            const recordError = (operation: string, error: unknown) =>
                errors.push({
                    corpusId: corpus.corpusId,
                    operation,
                    message: message(error),
                });
            await Promise.all([
                timed(
                    memory.listProcedureCandidates(corpus.corpusId, [
                        "detected",
                        "draft",
                    ]),
                ).then(
                    (candidates) => {
                        items.push(
                            ...candidates.map(
                                (candidate): RunbookSummary => ({
                                    id: JSON.stringify([
                                        "candidate",
                                        corpus.corpusId,
                                        candidate.candidateId,
                                    ]),
                                    kind: "candidate",
                                    corpusId: corpus.corpusId,
                                    corpusName: corpus.name,
                                    objectId: candidate.candidateId,
                                    title: candidate.title,
                                    state:
                                        candidate.state === "detected"
                                            ? "detected"
                                            : "draft",
                                    readiness: "detected",
                                    updatedAt: candidate.updatedAt,
                                    ...(candidate.agentEdition
                                        ? { editionState: "draft" as const }
                                        : {}),
                                    boundSteps: 0,
                                    totalSteps:
                                        candidate.agentEdition?.steps.length ??
                                        candidate.steps.length,
                                    skills: [],
                                    drift: [],
                                }),
                            ),
                        );
                    },
                    (error: unknown) => recordError("candidates", error),
                ),
                timed(
                    memory.listProcedures({ corpusId: corpus.corpusId }),
                ).then(
                    async (procedures) => {
                        for (
                            let index = 0;
                            index < procedures.length;
                            index += 4
                        ) {
                            await Promise.all(
                                procedures
                                    .slice(index, index + 4)
                                    .map(async (procedure) => {
                                        try {
                                            items.push(
                                                await summarize(
                                                    procedure,
                                                    corpus.name,
                                                    skills.skills,
                                                ),
                                            );
                                        } catch (error) {
                                            recordError(
                                                `procedure:${procedure.procedureId}`,
                                                error,
                                            );
                                        }
                                    }),
                            );
                        }
                    },
                    (error: unknown) => recordError("procedures", error),
                ),
            ]);
            return items;
        });
        const items = results
            .flat()
            .filter((item) => matches(item, request))
            .sort(
                (left, right) =>
                    left.title.localeCompare(right.title) ||
                    left.id.localeCompare(right.id),
            );
        const {
            continuationToken: _token,
            pageSize: _size,
            ...filters
        } = request;
        return {
            ...pageItems(items, request, pageScope([filters, items])),
            errors,
            warnings: skills.warnings,
        };
    }
    async function detail(
        request: Parameters<MemoryHubRunbookFunctions["memoryHubRunbook"]>[0],
    ) {
        const memory = service();
        const corpus = await timed(memory.getCorpus(request.corpusId));
        if (!corpus) throw new Error("Runbook corpus is unavailable");
        const catalogResult = await catalog.list();
        if (request.kind === "candidate") {
            if (
                request.version !== undefined ||
                request.skillRevisionId !== undefined
            )
                throw new Error(
                    "Candidate review cannot select a saved or skill revision",
                );
            const candidate = await timed(
                memory.getProcedureCandidate(
                    request.corpusId,
                    request.objectId,
                ),
            );
            if (!candidate) throw new Error("Runbook candidate is unavailable");
            return {
                corpusId: request.corpusId,
                corpusName: corpus.name,
                candidate,
                originals: await runbookOriginals(
                    memory,
                    request.corpusId,
                    candidate.citations,
                ),
                history: [],
                skills: [],
                drift: [],
                warnings: catalogResult.warnings,
            };
        }
        const procedure =
            request.version === undefined
                ? await timed(
                      memory.getProcedure(request.corpusId, request.objectId),
                  )
                : await requireRunbookVersion(
                      memory,
                      request.corpusId,
                      request.objectId,
                      request.version,
                  );
        if (!procedure) throw new Error("Runbook procedure is unavailable");
        const [originals, history, drift] = await Promise.all([
            runbookOriginals(
                memory,
                request.corpusId,
                procedure.document.citations,
            ),
            runbookHistory(memory, request.corpusId, request.objectId),
            runbookDrift(procedure, getCapabilities()),
        ]);
        const linkedSkills = procedureSkills(
            catalogResult.skills,
            request.corpusId,
            request.objectId,
        );
        if (
            request.skillRevisionId !== undefined &&
            !linkedSkills.some(
                (skill) => skill.revisionId === request.skillRevisionId,
            )
        ) {
            throw new Error(
                "The exact skill revision is unavailable or is not linked to this procedure",
            );
        }
        return {
            corpusId: request.corpusId,
            corpusName: corpus.name,
            procedure,
            originals,
            history: history.items.map(
                ({ version, state, createdAt, jsonHash, markdownHash }) => ({
                    version,
                    state,
                    createdAt,
                    jsonHash,
                    markdownHash,
                }),
            ),
            skills: linkedSkills,
            drift,
            warnings: catalogResult.warnings,
        };
    }
    async function preview(
        request: Parameters<
            MemoryHubRunbookFunctions["memoryHubPreviewSkill"]
        >[0],
    ): Promise<RunbookSkillPreview> {
        const result = await timed(
            catalog.requireCapabilities().previewProcedureArtifact({
                corpusId: request.corpusId,
                procedureId: request.procedureId,
                version: request.version,
                kind: "skill",
                skill: {
                    identity: request.identity,
                    ...(request.description === undefined
                        ? {}
                        : { description: request.description }),
                },
            }),
        );
        if (result.kind !== "skill")
            throw new Error("Skill preview returned another artifact kind");
        return {
            identity: request.identity,
            lineage: result.lineage,
            files: result.skill.files.map((file) => ({
                path: file.path,
                content:
                    file.encoding === "base64"
                        ? new TextDecoder("utf-8", { fatal: true }).decode(
                              Buffer.from(file.content, "base64"),
                          )
                        : file.content,
            })),
            valid: true,
            findings: [],
        };
    }
    return {
        memoryHubRunbooks: list,
        memoryHubRunbook: detail,
        memoryHubSaveRunbook: async (request) => {
            const result = await service().saveProcedure(request);
            versions.clear();
            return result;
        },
        memoryHubRunbookHistory: async (request) => {
            const page = await runbookHistory(
                service(),
                request.corpusId,
                request.procedureId,
                request.beforeVersion,
                request.pageSize,
            );
            return {
                ...page,
                items: page.items.map(
                    ({
                        version,
                        state,
                        createdAt,
                        jsonHash,
                        markdownHash,
                    }) => ({
                        version,
                        state,
                        createdAt,
                        jsonHash,
                        markdownHash,
                    }),
                ),
            };
        },
        memoryHubRunbookOriginal: (request) =>
            loadRunbookOriginal(
                service(),
                request.corpusId,
                {
                    sourceId: request.sourceId,
                    revisionId: request.revisionId,
                    ...(request.locator === undefined
                        ? {}
                        : { locator: request.locator }),
                },
                request.offset,
            ),
        async memoryHubRunbookUsedBy(request) {
            const memory = service();
            const corpus = await timed(memory.getCorpus(request.corpusId));
            if (!corpus) throw new Error("Source corpus is unavailable");
            const catalogResult = await catalog.list();
            const procedures = await timed(
                memory.listProcedures({ corpusId: request.corpusId }),
            );
            const items: RunbookUsage[] = [];
            for (const summary of procedures) {
                for (
                    let version = summary.latestVersion;
                    version >= 1;
                    version--
                ) {
                    const procedure = await retainedVersion(summary, version);
                    if (
                        !procedure.document.citations.some(
                            (citation) =>
                                citation.sourceId === request.sourceId,
                        )
                    )
                        continue;
                    const {
                        corpusId,
                        procedureId,
                        state,
                        jsonHash,
                        markdownHash,
                    } = procedure;
                    items.push({
                        procedure: {
                            corpusId,
                            procedureId,
                            version,
                            state,
                            jsonHash,
                            markdownHash,
                            document: { title: procedure.document.title },
                        },
                        skills: procedureSkills(
                            catalogResult.skills,
                            request.corpusId,
                            summary.procedureId,
                        ).filter(
                            (skill) =>
                                skill.lineage?.version === version &&
                                skill.lineage.jsonHash === jsonHash &&
                                skill.lineage.markdownHash === markdownHash,
                        ),
                    });
                }
            }
            const viewItems = await sourceViewUsage(
                memory,
                request.corpusId,
                request.sourceId,
            );
            return {
                ...pageItems(
                    items,
                    request,
                    pageScope([request.corpusId, request.sourceId, items]),
                ),
                warnings: catalogResult.warnings,
                ...(viewItems
                    ? {
                          views: pageItems(
                              viewItems,
                              {
                                  ...(request.pageSize === undefined
                                      ? {}
                                      : { pageSize: request.pageSize }),
                                  ...(request.viewContinuationToken ===
                                  undefined
                                      ? {}
                                      : {
                                            continuationToken:
                                                request.viewContinuationToken,
                                        }),
                              },
                              pageScope([
                                  request.corpusId,
                                  request.sourceId,
                                  viewItems,
                              ]),
                          ),
                      }
                    : {}),
            };
        },
        memoryHubSuggestBindings: (request) =>
            suggestRunbookBindings(
                service(),
                catalog.requireCapabilities(),
                request,
            ),
        memoryHubAcceptBinding: async (request) => {
            const result = await acceptRunbookBinding(
                service(),
                getCapabilities(),
                request,
            );
            versions.clear();
            return result;
        },
        memoryHubPreviewSkill: preview,
        async memoryHubPublishSkill(request) {
            const result = await timed(
                catalog.requireCapabilities().promoteProcedureArtifact({
                    corpusId: request.corpusId,
                    procedureId: request.procedureId,
                    version: request.version,
                    kind: "skill",
                    skill: {
                        identity: request.identity,
                        ...(request.description === undefined
                            ? {}
                            : { description: request.description }),
                    },
                }),
            );
            if (result.kind !== "skill")
                throw new Error(
                    "Skill publication returned another artifact kind",
                );
            return catalog.describe(result.entry);
        },
        async memoryHubSkillAction(request) {
            const capabilities = catalog.requireCapabilities();
            const action =
                request.action === "approve" || request.action === "draft"
                    ? "changeState"
                    : request.action;
            const entry = await capabilities.changeSkillLifecycle({
                identity: request.identity,
                revision: request.revisionId,
                expectedState: request.expectedState,
                expectedActive: request.expectedActive,
                action,
                ...(request.action === "approve"
                    ? { state: "approved" as const }
                    : {}),
                ...(request.action === "draft"
                    ? { state: "draft" as const }
                    : {}),
            });
            return catalog.describe(entry);
        },
        async memoryHubSkillFile(request) {
            return {
                path: request.path,
                content: await readRunbookSkillText(
                    catalog.requireCapabilities(),
                    request.identity,
                    request.revisionId,
                    request.path,
                ),
            };
        },
        memoryHubCompareRunbook: (request) =>
            compareRunbook(
                service(),
                request.corpusId,
                request.procedureId,
                request.version,
            ),
        async memoryHubSynthesizeRunbook(request) {
            const backend = service();
            if (typeof backend.requestRunbookSynthesis !== "function") {
                throw new Error("Explicit Runbook synthesis is unavailable");
            }
            const comparison = await compareRunbook(
                backend,
                request.corpusId,
                request.procedureId,
                request.version,
            );
            if (
                !comparison.updated.some(
                    (original) =>
                        original.citation.sourceId === request.sourceId &&
                        original.citation.revisionId === request.revisionId &&
                        original.available,
                )
            ) {
                throw new Error(
                    "The selected updated source revision is no longer available; reload the comparison",
                );
            }
            const job = await timed(
                backend.requestRunbookSynthesis({
                    corpusId: request.corpusId,
                    sourceId: request.sourceId,
                    revisionId: request.revisionId,
                }),
            );
            if (
                job.corpusId !== request.corpusId ||
                job.sourceId !== request.sourceId ||
                job.revisionId !== request.revisionId
            ) {
                throw new Error(
                    "Runbook synthesis returned a job for another source revision",
                );
            }
            return job;
        },
        memoryHubReadRunbookAsset: (request) =>
            readRunbookAsset(service(), request),
    };
}
