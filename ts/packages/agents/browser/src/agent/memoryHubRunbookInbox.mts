// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    FileMemoryService,
    MemoryService,
} from "@typeagent/memory-service";
import type {
    MemoryHubRunbookFunctions,
    MemoryHubSnapshot,
    MemoryHubInboxItem,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mapMemoryHubCorpora } from "./memoryHub.mjs";
import { timed } from "./memoryHubQuery.mjs";

type Jobs = MemoryService & Pick<FileMemoryService, "listRunbookJobs">;
function supportsRunbookJobs(service: MemoryService): service is Jobs {
    return typeof Reflect.get(service, "listRunbookJobs") === "function";
}
function attentionItem(
    kind: MemoryHubInboxItem["kind"],
    corpusId: string,
    corpusName: string,
    objectId: string,
    title: string,
    reason: string,
    updatedAt: string,
    state: unknown,
): MemoryHubInboxItem {
    return {
        id: JSON.stringify([kind, corpusId, objectId]),
        fingerprint: JSON.stringify(state),
        kind,
        corpusId,
        corpusName,
        objectId,
        title,
        reason,
        updatedAt,
        severity: "attention",
    };
}
export async function addRunbookInbox(
    snapshot: MemoryHubSnapshot,
    runbooks: MemoryHubRunbookFunctions,
    memory: MemoryService,
    corpusId?: string,
): Promise<void> {
    let token: string | undefined;
    const visited = new Set<string>();
    try {
        do {
            const page = await runbooks.memoryHubRunbooks({
                ...(corpusId === undefined ? {} : { corpusId }),
                pageSize: 100,
                ...(token === undefined ? {} : { continuationToken: token }),
            });
            for (const error of page.errors)
                snapshot.errors.push({ ...error, operation: "runbooks" });
            for (const warning of page.warnings)
                snapshot.errors.push({
                    corpusId: corpusId ?? "*",
                    operation: "skills",
                    message: warning,
                });
            for (const procedure of page.items.filter(
                (item) => item.kind === "procedure",
            )) {
                for (const skill of procedure.skills.filter(
                    (skill) =>
                        skill.state === "draft" || skill.state === "validated",
                )) {
                    const item = attentionItem(
                        "skillDraft",
                        procedure.corpusId,
                        procedure.corpusName,
                        `${procedure.objectId}:${JSON.stringify(skill.identity)}:${skill.revisionId}`,
                        skill.displayName,
                        `${skill.state} skill from procedure version ${skill.lineage?.version}; validation and approval grant no execution permission.`,
                        skill.createdAt,
                        [
                            skill.revisionId,
                            skill.state,
                            skill.active,
                            skill.lineage,
                        ],
                    );
                    item.objectId = procedure.objectId;
                    item.skillRevisionId = skill.revisionId;
                    snapshot.inbox.push(item);
                }
                if (procedure.drift.length)
                    snapshot.inbox.push(
                        attentionItem(
                            "bindingDrift",
                            procedure.corpusId,
                            procedure.corpusName,
                            procedure.objectId,
                            procedure.title,
                            procedure.drift
                                .map(
                                    (issue) =>
                                        `${issue.stepId}: ${issue.reason}`,
                                )
                                .join("; "),
                            procedure.updatedAt,
                            [procedure.latestVersion, procedure.drift],
                        ),
                    );
            }
            token = page.nextContinuationToken;
            if (token !== undefined) {
                if (visited.has(token))
                    throw new Error(
                        "Runbook triage returned a repeated page token",
                    );
                visited.add(token);
            }
        } while (token !== undefined);
    } catch (error) {
        snapshot.errors.push({
            corpusId: corpusId ?? "*",
            operation: "runbooks",
            message: error instanceof Error ? error.message : String(error),
        });
    }
    if (!supportsRunbookJobs(memory)) {
        snapshot.errors.push({
            corpusId: corpusId ?? "*",
            operation: "runbooks",
            message: "Post-capture Runbook job triage is unavailable",
        });
        return;
    }
    await mapMemoryHubCorpora(
        snapshot.corpora.filter(
            (corpus) => corpusId === undefined || corpus.corpusId === corpusId,
        ),
        async (corpus) => {
            try {
                const jobs = await timed(
                    memory.listRunbookJobs(corpus.corpusId),
                );
                for (const job of jobs) {
                    if (
                        !job.warnings.length &&
                        !["failed", "interrupted"].includes(job.state)
                    )
                        continue;
                    const item = attentionItem(
                        "runbookWarning",
                        corpus.corpusId,
                        corpus.name,
                        job.jobId,
                        `Runbook extraction ${job.state}`,
                        job.warnings.join("; ") ||
                            job.reason ||
                            "Extraction requires attention; captured evidence is retained.",
                        job.updatedAt,
                        [
                            job.state,
                            job.revisionId,
                            job.warnings,
                            job.updatedAt,
                        ],
                    );
                    item.sourceId = job.sourceId;
                    snapshot.inbox.push(item);
                }
            } catch (error) {
                snapshot.errors.push({
                    corpusId: corpus.corpusId,
                    operation: "runbooks",
                    message:
                        error instanceof Error ? error.message : String(error),
                });
            }
        },
    );
    const unique = new Map(snapshot.inbox.map((item) => [item.id, item]));
    snapshot.inbox = [...unique.values()].sort(
        (left, right) =>
            Number(left.severity === "info") -
                Number(right.severity === "info") ||
            left.updatedAt.localeCompare(right.updatedAt) ||
            left.id.localeCompare(right.id),
    );
}
