// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProcedureVersion,
    RunbookJobResult,
} from "@typeagent/memory-service";
import type { RunbookOriginal } from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubRunbookUi";

export function mountRunbookSynthesis(
    host: HTMLElement,
    options: {
        procedure: ProcedureVersion;
        original: RunbookOriginal;
        onError: (error: unknown) => void;
        onChanged: () => Promise<void>;
        onPendingChanged: (pending: boolean) => void;
        onOpenCandidate: (corpusId: string, candidateId: string) => void;
        initialJob?: RunbookJobResult;
        onRecorded: (job: RunbookJobResult) => void;
    },
) {
    const root = rbNode("article");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const jobHost = rbNode("div");
    const create = rbButton(
        "Create new draft",
        () => {
            void start();
        },
        "synthesize-new-draft",
    );
    root.append(
        rbNode(
            "h4",
            `Separate new draft from updated original: ${options.original.title}`,
        ),
        rbNode(
            "p",
            "This explicit request may use configured synthesis. Any generated candidates are separate; your current edition, review, unsaved edits and linked skills are never overwritten or approved.",
        ),
        create,
        status,
        jobHost,
    );
    host.append(root);
    let job = options.initialJob;
    let disposed = false;
    let sequence = 0;
    let working = false;
    create.disabled = !options.original.available;
    if (!options.original.available)
        status.textContent =
            "New-draft synthesis is unavailable because this exact updated source revision is missing.";
    function checkIdentity(value: RunbookJobResult) {
        if (
            value.corpusId !== options.procedure.corpusId ||
            value.sourceId !== options.original.citation.sourceId ||
            value.revisionId !== options.original.citation.revisionId
        )
            throw new Error(
                "Synthesis job identity does not match the requested corpus/source/revision.",
            );
    }
    function renderJob(value: RunbookJobResult) {
        jobHost.replaceChildren(
            rbNode("p", `Job ID: ${value.jobId}`),
            rbNode(
                "p",
                `Durable state: ${value.state} · last updated ${value.updatedAt}`,
            ),
            rbNode("p", value.reason ?? ""),
            rbNode("p", value.warnings.join("\n"), "runbook-warning"),
        );
        if (!value.candidateIds.length)
            jobHost.append(
                rbNode(
                    "p",
                    "No candidate IDs have been returned for this job. Completion does not imply a runbook or quality acceptance.",
                ),
            );
        for (const candidateId of value.candidateIds)
            jobHost.append(
                rbButton(`Review new draft ${candidateId}`, () =>
                    options.onOpenCandidate(value.corpusId, candidateId),
                ),
            );
        jobHost.append(
            rbButton(
                "Refresh synthesis job status",
                () => {
                    void refresh();
                },
                "refresh-synthesis-job",
            ),
        );
        create.disabled =
            working || value.state === "running" || !options.original.available;
    }
    async function request(
        operation: () => Promise<RunbookJobResult>,
        isWrite: boolean,
    ) {
        if (working || disposed) return;
        const current = ++sequence;
        working = true;
        create.disabled = true;
        if (isWrite) options.onPendingChanged(true);
        status.textContent = isWrite
            ? "Requesting a separate durable synthesis job…"
            : "Reading this exact durable job from the bounded job list…";
        try {
            const value = await operation();
            if (disposed || current !== sequence) return;
            checkIdentity(value);
            job = value;
            options.onRecorded(value);
            renderJob(value);
            status.textContent =
                "Durable job recorded. Existing edition and skills are unchanged; review any generated candidate separately.";
            await options.onChanged();
        } catch (error) {
            if (disposed || current !== sequence) return;
            status.textContent = `New-draft synthesis/status unavailable or failed: ${rbError(error)}. No candidate success or overwrite is assumed.`;
            options.onError(error);
        } finally {
            if (isWrite) options.onPendingChanged(false);
            working = false;
            if (!disposed && current === sequence)
                create.disabled =
                    job?.state === "running" || !options.original.available;
        }
    }
    async function start() {
        if (!options.original.available || job?.state === "running") return;
        await request(
            () =>
                invokeView("memoryHubSynthesizeRunbook", {
                    corpusId: options.procedure.corpusId,
                    procedureId: options.procedure.procedureId,
                    version: options.procedure.version,
                    sourceId: options.original.citation.sourceId,
                    revisionId: options.original.citation.revisionId,
                }),
            true,
        );
    }
    async function refresh() {
        const jobId = job?.jobId;
        if (!jobId) return;
        await request(async () => {
            const jobs = await invokeView("memoryHubRunbookJobs", {
                corpusId: options.procedure.corpusId,
            });
            const found = jobs.find((value) => value.jobId === jobId);
            if (!found)
                throw new Error(
                    "Exact job is not in the bounded latest-job list; its current state is unavailable. The last known record is retained, not replaced by another job.",
                );
            return found;
        }, false);
    }
    if (job) {
        checkIdentity(job);
        renderJob(job);
        status.textContent =
            "Last known durable job record retained. Refresh to read current state; no existing edition is replaced.";
    }
    return {
        dispose() {
            disposed = true;
            sequence++;
            root.remove();
        },
    };
}
