// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initRuntimeConfigFromProcessEnv } from "@typeagent/aiclient";
import { loadConfigSync } from "@typeagent/config";
import { readFile } from "node:fs/promises";
import { FileMemoryService } from "./fileMemoryService.js";
import { getConfiguredMemoryViewOptions } from "./viewHostOptions.js";
import { createMemoryServiceRpcFacade } from "./rpcFacade.js";
import { parseViewPageUri } from "./schemaViewOperations.js";
import type {
    MemoryViewService,
    ViewArchiveRequest,
    ViewBuildJob,
    ViewBuildRequest,
    ViewConflictResolution,
    ViewMaintenancePlanRequest,
    ViewMaintenanceRequest,
    ViewMaintenanceUpdate,
    ViewPublicationPolicyUpdate,
    ViewPublishRequest,
    ViewSaveRequest,
} from "./viewTypes.js";

const usage = `Derived Views:
node dist/memoryViewsCli.js --store <private-store> <command> [arguments]
  corpora
  capabilities
  create-corpus <name>
  list <corpusId>
  sources <corpusId>
  events <corpusId> [continuationToken]
  event <corpusId> <eventId>
  source <corpusId> <sourceId> [revisionId]
  synopsis <corpusId> <sourceId> [revisionId]
  topics <request.json>
  rebuild-topics <corpusId>
  read <corpusId> <viewId> [revisionId]
  history <corpusId> <viewId>
  questions <corpusId>
  page <memory-view-uri>
  edit-question <request.json>
  propose-schema <request.json>
  discover-questions <request.json>
  acquisitions <corpusId>
  acquire <request.json>
  run-acquisitions <corpusId>
  cancel-acquisition <request.json>
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
Build accepts troubleshootingGuide, projectBrief, timeline, wiki or schemaView definitions and uses configured synthesis. Schema views require schema-defined-v1 and data-only approved question slots; reads/pages do not invoke models. Proposals require explicit approval. Acquisition is disabled unless a host supplies individually authorized read tools and policy. Project summaries require a projectSummary selector with construction informational-project-summary-v1, query, aliases and excludedSourceIds; an empty source selector searches all eligible indexed sources. Automatic wiki/projects family update, rebuild, pause and resume requests use maintain with corpusId and expectedHead, without source selection. Wikis use bounded concept/system/project pages with stable identities and exact citations; editorial renames preserve identity. Timelines use timelineEvidence selectors with exact document revisions and canonical event IDs, with host-enforced knowledge/occurrence bounds. Fixed readers have no execution/skill controls. Eligible artifacts can publish and index. No reset, source deletion, skill approval or execution is performed.`;

const argumentCounts = new Map<string, readonly [number, number]>([
    ["corpora", [0, 0]],
    ["capabilities", [0, 0]],
    ["create-corpus", [1, 1]],
    ["list", [1, 1]],
    ["sources", [1, 1]],
    ["events", [1, 2]],
    ["event", [2, 2]],
    ["source", [2, 3]],
    ["synopsis", [2, 3]],
    ["topics", [1, 1]],
    ["rebuild-topics", [1, 1]],
    ["read", [2, 3]],
    ["history", [2, 2]],
    ["questions", [1, 1]],
    ["page", [1, 1]],
    ["edit-question", [1, 1]],
    ["propose-schema", [1, 1]],
    ["discover-questions", [1, 1]],
    ["acquisitions", [1, 1]],
    ["acquire", [1, 1]],
    ["run-acquisitions", [1, 1]],
    ["cancel-acquisition", [1, 1]],
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
    ["questions", (rpc, values) => rpc.listQuestions!(values[0])],
    ["page", (rpc, values) => rpc.getViewPage!(parseViewPageUri(values[0]))],
    [
        "edit-question",
        async (rpc, values) =>
            rpc.editQuestion!(JSON.parse(await readFile(values[0], "utf8"))),
    ],
    [
        "propose-schema",
        async (rpc, values) =>
            rpc.proposeSchemaView!(
                JSON.parse(await readFile(values[0], "utf8")),
            ),
    ],
    [
        "discover-questions",
        async (rpc, values) =>
            rpc.discoverSchemaQuestions!(
                JSON.parse(await readFile(values[0], "utf8")),
            ),
    ],
    ["acquisitions", (rpc, values) => rpc.listAcquisitions!(values[0])],
    [
        "acquire",
        async (rpc, values) =>
            rpc.requestAcquisition!(
                JSON.parse(await readFile(values[0], "utf8")),
            ),
    ],
    ["run-acquisitions", (rpc, values) => rpc.runAcquisitions!(values[0])],
    [
        "cancel-acquisition",
        async (rpc, values) =>
            rpc.cancelAcquisition!(
                JSON.parse(await readFile(values[0], "utf8")),
            ),
    ],
    [
        "topics",
        async (rpc, values) =>
            rpc.queryTopics(JSON.parse(await readFile(values[0], "utf8"))),
    ],
    [
        "rebuild-topics",
        async (rpc, values) =>
            waitForViewBuild(rpc, await rpc.rebuildTopics(values[0])),
    ],
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
    const [storeFlag, store, command, ...values] = args;
    if (storeFlag !== "--store" || !store || !command) throw new Error(usage);
    const counts = argumentCounts.get(command);
    if (!counts || values.length < counts[0] || values.length > counts[1])
        throw new Error(usage);
    const service = new FileMemoryService(store, {
        ...getConfiguredMemoryViewOptions(),
        ...(process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT
            ? {
                  viewModelEndpoint:
                      process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT,
              }
            : {}),
    });
    const rpc = createMemoryServiceRpcFacade(service);
    try {
        const operation = viewCommands.get(command);
        if (operation) return await operation(rpc, values);
        switch (command) {
            case "synopsis":
                return await rpc.getSourceSynopsis!({
                    corpusId: values[0],
                    sourceId: values[1],
                    ...(values[2] ? { revisionId: values[2] } : {}),
                });
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
