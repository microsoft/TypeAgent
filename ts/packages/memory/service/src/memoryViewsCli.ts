// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { FileMemoryService } from "./fileMemoryService.js";
import { createMemoryServiceRpcFacade } from "./rpcFacade.js";
import { loadConfigSync } from "@typeagent/config";
import { initRuntimeConfigFromProcessEnv } from "@typeagent/aiclient";
import type {
    ViewSaveRequest,
    ViewArchiveRequest,
    ViewBuildRequest,
    ViewConflictResolution,
    ViewBuildJob,
    MemoryViewService,
    ViewPublishRequest,
    ViewPublicationPolicyUpdate,
    ViewMaintenanceRequest,
    ViewMaintenancePlanRequest,
    ViewMaintenanceUpdate,
} from "./viewTypes.js";

const usage = `Opt-in derived views:
node dist/memoryViewsCli.js --store <private-store> --enable-view-drafts <command> [arguments]
  corpora
  capabilities
  create-corpus <name>
  list <corpusId>
  sources <corpusId>
  events <corpusId> [continuationToken]
  event <corpusId> <eventId>
  source <corpusId> <sourceId> [revisionId]
  read <corpusId> <viewId> [revisionId]
  history <corpusId> <viewId>
  save <request.json>
  archive <request.json>
  build <request.json>
  plan-maintenance <request.json>
  maintain <request.json>
  set-maintenance <request.json>
  maintenance-status <corpusId> <receiptId>
  builds <corpusId>
  status <corpusId> <jobId>
  cancel <corpusId> <jobId>
  retry <corpusId> <jobId>
  inspect <corpusId> <conflictId>
  resolve <request.json>
  policy <corpusId>
  set-policy <request.json>
  publication <corpusId> <viewId>
  publish <request.json>
  retry-index <request.json>
  search <corpusId> <query>
The store must not be owned by a running server. Actor comes from the local OS identity.
Build accepts troubleshootingGuide, projectBrief, timeline or wiki definitions and uses configured synthesis. Wikis use bounded concept/system/project pages with stable identities and exact page/source proof; renames preserve identity and merges retain facts and citations. Timelines use timelineEvidence selectors with exact document revisions and canonical event IDs, with host-enforced knowledge/occurrence bounds. Fixed readers have no execution/skill controls. Eligible artifacts can publish and index; live synthesis remains unqualified. No reset, source deletion, skill approval or execution is performed.`;

const argumentCounts = new Map<string, readonly [number, number]>([
    ["corpora", [0, 0]],
    ["capabilities", [0, 0]],
    ["create-corpus", [1, 1]],
    ["list", [1, 1]],
    ["sources", [1, 1]],
    ["events", [1, 2]],
    ["event", [2, 2]],
    ["source", [2, 3]],
    ["read", [2, 3]],
    ["history", [2, 2]],
    ["save", [1, 1]],
    ["archive", [1, 1]],
    ["build", [1, 1]],
    ["plan-maintenance", [1, 1]],
    ["maintain", [1, 1]],
    ["set-maintenance", [1, 1]],
    ["maintenance-status", [2, 2]],
    ["builds", [1, 1]],
    ["status", [2, 2]],
    ["cancel", [2, 2]],
    ["retry", [2, 2]],
    ["inspect", [2, 2]],
    ["resolve", [1, 1]],
    ["publish", [1, 1]],
    ["retry-index", [1, 1]],
    ["policy", [1, 1]],
    ["set-policy", [1, 1]],
    ["publication", [2, 2]],
    ["search", [2, 2]],
]);

async function waitForViewBuild(
    rpc: MemoryViewService,
    admitted: ViewBuildJob,
): Promise<ViewBuildJob> {
    let job = admitted;
    while (job.state === "running") {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        const current = await rpc.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current)
            throw new Error("Build receipt disappeared during generation");
        job = current;
    }
    return job;
}

const viewCommands = new Map<
    string,
    (
        rpc: ReturnType<typeof createMemoryServiceRpcFacade>,
        values: string[],
    ) => Promise<unknown>
>([
    [
        "plan-maintenance",
        async (rpc, values) =>
            rpc.planViewMaintenance(
                JSON.parse(
                    await readFile(values[0], "utf8"),
                ) as ViewMaintenancePlanRequest,
            ),
    ],
    [
        "set-maintenance",
        async (rpc, values) =>
            rpc.updateViewMaintenance(
                JSON.parse(
                    await readFile(values[0], "utf8"),
                ) as ViewMaintenanceUpdate,
            ),
    ],
    [
        "maintain",
        async (rpc, values) => {
            const receipt = await rpc.maintainViews(
                JSON.parse(
                    await readFile(values[0], "utf8"),
                ) as ViewMaintenanceRequest,
            );
            return {
                ...receipt,
                ...(receipt.job
                    ? { job: await waitForViewBuild(rpc, receipt.job) }
                    : {}),
            };
        },
    ],
    [
        "maintenance-status",
        async (rpc, values) =>
            (await rpc.getViewMaintenance({
                corpusId: values[0],
                receiptId: values[1],
            })) ?? null,
    ],
    [
        "build",
        async (rpc, values) => {
            const request: ViewBuildRequest = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return waitForViewBuild(rpc, await rpc.buildViews(request));
        },
    ],
    ["builds", (rpc, values) => rpc.listViewBuilds(values[0])],
    [
        "events",
        (rpc, values) =>
            rpc.listEvents({
                corpusId: values[0],
                pageSize: 200,
                ...(values[1] === undefined
                    ? {}
                    : { continuationToken: values[1] }),
            }),
    ],
    [
        "status",
        async (rpc, values) =>
            (await rpc.getViewBuild({
                corpusId: values[0],
                jobId: values[1],
            })) ?? null,
    ],
    [
        "cancel",
        (rpc, values) =>
            rpc.cancelViewBuild({ corpusId: values[0], jobId: values[1] }),
    ],
    [
        "retry",
        async (rpc, values) =>
            waitForViewBuild(
                rpc,
                await rpc.retryViewBuild({
                    corpusId: values[0],
                    jobId: values[1],
                }),
            ),
    ],
    [
        "inspect",
        async (rpc, values) =>
            (await rpc.getViewConflict({
                corpusId: values[0],
                conflictId: values[1],
            })) ?? null,
    ],
    [
        "resolve",
        async (rpc, values) => {
            const request: ViewConflictResolution = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return rpc.resolveViewConflict(request);
        },
    ],
    ["policy", (rpc, values) => rpc.getViewPublicationPolicy(values[0])],
    [
        "set-policy",
        async (rpc, values) => {
            const request: ViewPublicationPolicyUpdate = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return rpc.updateViewPublicationPolicy(request);
        },
    ],
    [
        "publication",
        (rpc, values) =>
            rpc.getViewPublication({ corpusId: values[0], viewId: values[1] }),
    ],
    [
        "publish",
        async (rpc, values) => {
            const request: ViewPublishRequest = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return rpc.publishView(request);
        },
    ],
    [
        "retry-index",
        async (rpc, values) => {
            const request: ViewPublishRequest = JSON.parse(
                await readFile(values[0], "utf8"),
            );
            return rpc.retryViewIndex(request);
        },
    ],
    [
        "search",
        (rpc, values) =>
            rpc.searchViews({
                corpusId: values[0],
                query: values[1],
                freshness: "current",
            }),
    ],
]);

export async function runMemoryViewsCli(args: string[]): Promise<unknown> {
    const [storeFlag, store, capability, command, ...values] = args;
    if (
        storeFlag !== "--store" ||
        !store ||
        capability !== "--enable-view-drafts" ||
        !command
    )
        throw new Error(usage);
    const counts = argumentCounts.get(command);
    if (!counts || values.length < counts[0] || values.length > counts[1])
        throw new Error(usage);
    const service = new FileMemoryService(store, {
        viewDrafts: true,
        ...(process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT
            ? {
                  runbookModelEndpoint:
                      process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT,
              }
            : {}),
    });
    const rpc = createMemoryServiceRpcFacade(service);
    try {
        const operation = viewCommands.get(command);
        if (operation) return await operation(rpc, values);
        switch (command) {
            case "capabilities":
                return await rpc.getCapabilities();
            case "corpora":
                return await rpc.listCorpora();
            case "create-corpus":
                return await rpc.createCorpus(values[0]);
            case "list":
                return await rpc.listViews(values[0]);
            case "sources":
                return await rpc.listSources(values[0]);
            case "event":
                return await rpc.getEvent(values[0], values[1]);
            case "source":
                return await rpc.getSourceContent({
                    corpusId: values[0],
                    sourceId: values[1],
                    ...(values[2] === undefined
                        ? {}
                        : { revisionId: values[2] }),
                });
            case "read":
                return (
                    (await rpc.getView({
                        corpusId: values[0],
                        viewId: values[1],
                        ...(values[2] === undefined
                            ? {}
                            : { revisionId: values[2] }),
                    })) ?? null
                );
            case "history":
                return await rpc.getViewHistory({
                    corpusId: values[0],
                    viewId: values[1],
                });
            case "save": {
                const request: ViewSaveRequest = JSON.parse(
                    await readFile(values[0], "utf8"),
                );
                return await rpc.saveViewDraft(request);
            }
            case "archive": {
                const request: ViewArchiveRequest = JSON.parse(
                    await readFile(values[0], "utf8"),
                );
                return await rpc.archiveView(request);
            }
        }
        throw new Error(usage);
    } finally {
        await service.close();
    }
}

// An import is testable without starting a service.
if (process.argv[1]?.endsWith("memoryViewsCli.js")) {
    loadConfigSync();
    initRuntimeConfigFromProcessEnv();
    runMemoryViewsCli(process.argv.slice(2)).then(
        (result) =>
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
        (error: unknown) => {
            console.error(
                error instanceof Error ? error.message : String(error),
            );
            process.exitCode = 1;
        },
    );
}
