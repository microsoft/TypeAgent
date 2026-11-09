// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
    FileMemoryService,
    waitForMemoryJob,
    type FileMemoryServiceOptions,
    type ViewBuildJob,
    type ViewBuildSnapshot,
    type ViewVersion,
} from "@typeagent/memory-service";
import { viewContentToText } from "@typeagent/memory-service/view-text";
import { offlineOptions } from "./offline.js";
import {
    digest,
    parseConstructionPacket,
    type ConstructionBundle,
    type ConstructionPacket,
} from "./packets.js";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export interface RunnerOptions {
    packet: unknown;
    caseId: string;
    root: string;
    mode: "offline" | "live";
    timeoutMs?: number;
    signal?: AbortSignal;
    liveAuthorization?: { approved: true; identity: string };
    serviceOptions?: FileMemoryServiceOptions;
}

export interface ProjectRevision {
    sequence: number;
    viewId: string;
    revisionId: string;
    version: number;
    sourceIds: string[];
    savedHash: string;
    job: ViewBuildJob;
}

export async function claimRunRoot(root: string): Promise<void> {
    const resolved = path.resolve(root);
    const relative = path.relative(packageRoot, resolved);
    if (
        path.isAbsolute(relative) ||
        relative.startsWith("..") ||
        ![".runs", ".data", ".test-runs"].includes(
            relative.split(path.sep)[0],
        ) ||
        relative.split(path.sep).length < 2
    )
        throw new Error(
            "Run root must be a new example-local .runs/.data/.test-runs child",
        );
    const parts = relative.split(path.sep);
    let current = packageRoot;
    for (const part of parts) {
        current = path.join(current, part);
        try {
            const entry = await lstat(current);
            if (entry.isSymbolicLink())
                throw new Error(
                    "Owned runs refuse symbolic links and junctions",
                );
            if (current === resolved)
                throw new Error(
                    "Run root already exists; use a new run identity",
                );
            if (!entry.isDirectory())
                throw new Error("Run ancestor is not a directory");
            const actual = await realpath(current);
            if (path.relative(packageRoot, actual).startsWith(".."))
                throw new Error("Run ancestor escapes the example package");
        } catch (error) {
            if (
                !error ||
                typeof error !== "object" ||
                !("code" in error) ||
                error.code !== "ENOENT"
            )
                throw error;
        }
    }
    await mkdir(path.dirname(resolved), { recursive: true });
    await mkdir(resolved);
    await writeFile(
        path.join(resolved, ".wiki-views-owned.json"),
        JSON.stringify({ owner: "wiki-views", schemaVersion: 1 }) + "\n",
        { flag: "wx" },
    );
}

export async function waitForViewBuild(
    service: FileMemoryService,
    admitted: ViewBuildJob,
    signal: AbortSignal,
): Promise<ViewBuildJob> {
    let job = admitted;
    while (job.state === "running") {
        if (signal.aborted) {
            await service.cancelViewBuild({
                corpusId: job.corpusId,
                jobId: job.jobId,
            });
            signal.throwIfAborted();
        }
        await delay(20);
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Durable view-build receipt disappeared");
        job = current;
    }
    return job;
}

export async function assertOriginalCitations(
    service: FileMemoryService,
    view: ViewVersion,
): Promise<number> {
    if (!view.content.citations.length)
        throw new Error("View has no original citations");
    for (const citation of view.content.citations) {
        const original = await service.getSourceContent({
            corpusId: view.corpusId,
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            indexedLocator: citation.locator,
        });
        if (original.content !== citation.excerpt)
            throw new Error(`Citation excerpt mismatch: ${citation.sourceId}`);
    }
    return view.content.citations.length;
}

export async function pauseFamilies(
    service: FileMemoryService,
    corpusId: string,
) {
    for (const family of ["wiki", "projects", "topics"] as const)
        await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family,
            operation: "pause",
        });
    const policy = await service.getViewPublicationPolicy(corpusId);
    await service.updateViewPublicationPolicy({
        corpusId,
        expectedHead: (await service.listViews(corpusId)).head,
        expectedRevision: policy.revision,
        autoPublish: false,
    });
}

export async function buildBundle(
    service: FileMemoryService,
    corpusId: string,
    bundle: ConstructionBundle,
    sources: Array<{ sourceId: string; revisionId: string }>,
    signal: AbortSignal,
) {
    const viewId = bundle.id;
    const current = await service.getView({
        corpusId,
        viewId,
        includeContext: false,
    });
    const maintenance = current
        ? undefined
        : await service.planViewMaintenance({ corpusId, viewIds: [viewId] });
    const intent = {
        query: bundle.query,
        aliases: bundle.aliases,
        excludedSourceIds: [],
    };
    const admitted = await service.buildViews({
        corpusId,
        expectedHead: (await service.listViews(corpusId)).head,
        publication: false,
        targets: [
            {
                expectedVersion:
                    current?.version ??
                    maintenance?.targets.find(
                        (target) => target.viewId === viewId,
                    )?.expectedVersion ??
                    0,
                definition: {
                    viewId,
                    kind: bundle.kind,
                    selector: {
                        kind: "sources",
                        sources: sources.map(({ sourceId, revisionId }) => ({
                            sourceId,
                            revisionId,
                        })),
                    },
                    ...(bundle.kind === "wiki"
                        ? {
                              wiki: {
                                  ...intent,
                                  construction:
                                      "informational-wiki-v1" as const,
                              },
                          }
                        : {
                              projectSummary: {
                                  ...intent,
                                  construction:
                                      "informational-project-summary-v1" as const,
                              },
                          }),
                },
            },
        ],
    });
    const job = await waitForViewBuild(service, admitted, signal);
    const target = job.results[0];
    if (!target?.revisionId || !["draft", "merged"].includes(target.state))
        throw new Error(
            `View target did not save a draft: ${job.state}/${target?.state}: ${target?.reason}`,
        );
    const view = await service.getView({
        corpusId,
        viewId,
        revisionId: target.revisionId,
        includeContext: false,
    });
    if (!view) throw new Error("Exact saved view revision is missing");
    await assertOriginalCitations(service, view);
    return { job, view };
}

async function prepareRunner(options: RunnerOptions) {
    const packet = parseConstructionPacket(options.packet);
    const bundle = packet.bundles.find((entry) => entry.id === options.caseId);
    if (!bundle)
        throw new Error(`Unknown construction case '${options.caseId}'`);
    if (options.mode !== "offline" && options.mode !== "live")
        throw new Error("Explicit offline or live mode required");
    if (
        options.mode === "live" &&
        (!options.liveAuthorization?.approved ||
            !options.liveAuthorization.identity.trim())
    )
        throw new Error(
            "Live ingestion/synthesis requires explicit non-secret approval",
        );
    if (
        options.mode === "offline" &&
        Object.keys(options.serviceOptions ?? {}).some(
            (key) =>
                ![
                    "viewDrafts",
                    "informationalViews",
                    "viewPublicationCheckpoint",
                ].includes(key),
        )
    )
        throw new Error(
            "Offline mode refuses model, index and synthesis overrides",
        );
    const timeoutMs =
        options.timeoutMs ?? 120_000 * (bundle.project?.meetingIds.length ?? 1);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
        throw new Error("Positive integer timeout required");
    const fixture =
        options.mode === "offline" ? await offlineOptions() : undefined;
    const hostOptions: FileMemoryServiceOptions = {
        ...fixture?.options,
        ...options.serviceOptions,
    };
    if (options.mode === "live" && !hostOptions.viewSynthesisAdapter)
        throw new Error(
            "Live runner requires configured host synthesis options",
        );
    hostOptions.viewDrafts ??= true;
    hostOptions.informationalViews ??= true;
    hostOptions.maintenanceMode = "manual";
    hostOptions.discoveryPolicy = "off";
    hostOptions.automaticKnowledgeDiscovery = false;
    return { packet, bundle, timeoutMs, fixture, hostOptions };
}

async function ingestBundle(
    service: FileMemoryService,
    corpusId: string,
    packet: ConstructionPacket,
    bundle: ConstructionBundle,
    signal: AbortSignal,
) {
    const mapping = [];
    for (const source of bundle.sources) {
        const admitted = await service.ingestDocument(
            {
                corpusId,
                source: {
                    sourceId: source.id,
                    sourceType: "text",
                    title: source.title,
                    text: source.text,
                    ...(source.authoredAt
                        ? { authoredAt: source.authoredAt }
                        : {}),
                },
                pipeline: { updatePolicy: "failIfExists" },
            },
            signal,
        );
        const receipt = await waitForMemoryJob(service, admitted.jobId, {
            signal,
            pollIntervalMs: 20,
        });
        if (receipt.state !== "complete")
            throw new Error(
                `Ingestion ${source.id}: ${receipt.state}: ${receipt.error ?? receipt.warnings.join("; ")}`,
            );
        const retained = await service.getSource(corpusId, admitted.sourceId);
        const revision = retained?.revisions.find(
            (entry) => entry.revisionId === admitted.revisionId,
        );
        if (!revision) throw new Error("Ingested source revision is missing");
        mapping.push({
            caseId: bundle.id,
            dataset: packet.dataset,
            datasetRelease: packet.release ?? null,
            datasetSourceId: source.id,
            sourceVersion: source.version,
            retainedSha256: source.sha256,
            corpusId,
            sourceId: admitted.sourceId,
            revisionId: admitted.revisionId,
            contentHash: revision.contentHash,
            receipt,
        });
    }
    return mapping;
}

async function saveProjectRevision(
    root: string,
    sequence: number,
    mapping: Awaited<ReturnType<typeof ingestBundle>>,
    built: Awaited<ReturnType<typeof buildBundle>>,
): Promise<ProjectRevision> {
    const revisionRoot = path.join(
        root,
        "revisions",
        String(sequence).padStart(4, "0"),
    );
    await mkdir(revisionRoot, { recursive: true });
    const saved = JSON.stringify(built.view, null, 2) + "\n";
    const revision: ProjectRevision = {
        sequence,
        viewId: built.view.viewId,
        revisionId: built.view.revisionId,
        version: built.view.version,
        sourceIds: mapping.map((source) => source.sourceId),
        savedHash: digest(saved),
        job: built.job,
    };
    for (const [name, data] of Object.entries({
        "saved.json": saved,
        "rendered.txt": viewContentToText(built.view.content) + "\n",
        "revision.json": JSON.stringify(revision, null, 2) + "\n",
        "source-mapping.json": JSON.stringify(mapping, null, 2) + "\n",
    }))
        await writeFile(path.join(revisionRoot, name), data, { flag: "wx" });
    return revision;
}

export async function runInformational(options: RunnerOptions) {
    const { packet, bundle, timeoutMs, fixture, hostOptions } =
        await prepareRunner(options);
    const requests: ViewBuildSnapshot[] = [];
    const control = new AbortController();
    const abort = () => control.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
        () => control.abort(new Error("Informational run timed out")),
        timeoutMs,
    );
    const adapter = hostOptions.viewSynthesisAdapter;
    if (adapter)
        hostOptions.viewSynthesisAdapter = {
            ...adapter,
            async generate(input, signal, inventory) {
                requests.push(structuredClone(input));
                return adapter.generate(input, signal, inventory);
            },
        };
    let service: FileMemoryService | undefined;
    let stage = "ownership";
    let owned = false;
    const started = Date.now();
    try {
        control.signal.throwIfAborted();
        await claimRunRoot(options.root);
        owned = true;
        await writeFile(
            path.join(options.root, "construction.json"),
            JSON.stringify(packet, null, 2) + "\n",
            { flag: "wx" },
        );
        stage = "initialization";
        service = new FileMemoryService(
            path.join(options.root, "store"),
            hostOptions,
        );
        await service.initialize();
        const capabilities = await service.getCapabilities();
        const required =
            bundle.kind === "wiki"
                ? capabilities.derivedViews?.informationalWiki
                : capabilities.derivedViews?.informationalProjects;
        if (!required)
            throw new Error(
                "Required informational view capability is disabled",
            );
        const { corpusId } = await service.createCorpus(
            `wiki-views-${bundle.id}`,
        );
        await pauseFamilies(service, corpusId);
        const mapping: Awaited<ReturnType<typeof ingestBundle>> = [];
        const batches = bundle.project
            ? bundle.sources.map((source) => [source])
            : [bundle.sources];
        const revisions: ProjectRevision[] = [];
        let built: Awaited<ReturnType<typeof buildBundle>> | undefined;
        for (const batch of batches) {
            stage = "ingestion";
            mapping.push(
                ...(await ingestBundle(
                    service,
                    corpusId,
                    packet,
                    { ...bundle, sources: batch },
                    control.signal,
                )),
            );
            stage = "construction";
            built = await buildBundle(
                service,
                corpusId,
                bundle,
                mapping,
                control.signal,
            );
            if (bundle.project)
                revisions.push(
                    await saveProjectRevision(
                        options.root,
                        revisions.length + 1,
                        mapping,
                        built,
                    ),
                );
        }
        if (!built) throw new Error("Construction run saved no revision");
        await writeFile(
            path.join(options.root, "source-mapping.json"),
            JSON.stringify(mapping, null, 2) + "\n",
            { flag: "wx" },
        );
        const { job, view } = built;
        const saved = JSON.stringify(view, null, 2) + "\n";
        const rendered = viewContentToText(view.content) + "\n";
        const serializedRequest = JSON.stringify(requests, null, 2) + "\n";
        const receipt = {
            schemaVersion: 1,
            mode: options.mode,
            caseId: bundle.id,
            ...(bundle.project ? { project: bundle.project, revisions } : {}),
            status: "ok",
            qualityBaseline: false,
            requestEvidenceKind: "indexed-build-snapshot",
            runtime: {
                nodeVersion: process.version,
                synthesisIdentity: hostOptions.viewSynthesisAdapter?.identity,
            },
            sourceManifestHash: digest(JSON.stringify(packet)),
            inputHash: digest(JSON.stringify(bundle)),
            corpusId,
            job,
            revisionId: view.revisionId,
            savedHash: digest(saved),
            renderedHash: digest(rendered),
            requestHash: digest(serializedRequest),
            latencyMs: Date.now() - started,
            injectedBehavior: fixture
                ? {
                      identity: fixture.options.viewSynthesisAdapter?.identity,
                      counters: fixture.counters,
                  }
                : null,
            authorizationIdentity:
                options.liveAuthorization?.identity ?? "offline",
            publication: await service.getViewPublication({
                corpusId,
                viewId: view.viewId,
            }),
        };
        for (const [name, data] of Object.entries({
            "saved.json": saved,
            "rendered.txt": rendered,
            "request-evidence.json": serializedRequest,
            "receipt.json": JSON.stringify(receipt, null, 2) + "\n",
        }))
            await writeFile(path.join(options.root, name), data, {
                flag: "wx",
            });
        return { receipt, view, mapping, requests };
    } catch (error) {
        if (owned)
            await writeFile(
                path.join(options.root, "failure.json"),
                JSON.stringify(
                    {
                        status: "failed",
                        component: "wiki-views",
                        stage,
                        reason:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        latencyMs: Date.now() - started,
                    },
                    null,
                    2,
                ) + "\n",
                { flag: "wx" },
            );
        throw error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        await service?.close();
    }
}
