// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewMergeConflict,
    ViewSnapshot,
    ViewVersion,
    ViewSynthesisOutput,
    ViewRelationshipInput,
    ViewPublicationPolicy,
    ViewPublicationStatus,
    DerivedViewContent,
    ViewKind,
    ViewCitation,
    ViewSummary,
    ViewBuildSummary,
} from "@typeagent/memory-service";
import { invokeMemory, invokeView } from "./viewClient";
import { MemoryHubInventoryPager } from "./memoryHubInventoryPager";
import {
    rbButton,
    rbError,
    rbChip,
    rbIconButton,
    rbNode,
    rbMarkdown,
} from "./memoryHubDocumentUi";
import { icon, menuButton, type MenuItem } from "./memoryHubUi";
import { viewRevisionTime, viewSheet } from "./memoryHubViewUi";
import {
    listReadyViewSources,
    listViewTimelineEvents,
    viewBuildBounds,
    createViewBuildTargets,
    readViewSourceText,
} from "./memoryHubViewBuild";
import { createProjectBriefEditor } from "./memoryHubProjectBrief";
import { createTimelineEditor } from "./memoryHubTimeline";
import { createWikiEditor } from "./memoryHubWiki";
import { createMaintenancePanel } from "./memoryHubMaintenance";
import { createGuideEditor } from "./memoryHubGuide";
import { viewContentToText } from "@typeagent/memory-service/view-text";

const viewKindLabels: Record<ViewKind, string> = {
    wiki: "Knowledge wiki",
    timeline: "Evidence-linked timeline",
    projectBrief: "Project brief",
    troubleshootingGuide: "Troubleshooting guide",
    schemaView: "Schema-defined questions",
};

function publicationDescription(
    publication: ViewPublicationStatus | undefined,
): string {
    return `Publication: ${publication?.blockedReason ?? publication?.reason ?? "not published"}. Published ${publication?.publishedRevisionId ?? "none"}; indexed ${publication?.indexedRevisionId ?? "none"}.`;
}

function jsonEditor(label: string, value: unknown): HTMLTextAreaElement {
    const editor = document.createElement("textarea");
    editor.setAttribute("aria-label", label);
    editor.rows = 12;
    editor.value = JSON.stringify(value, null, 2);
    return editor;
}

function editableEdges(view: ViewVersion): ViewRelationshipInput[] {
    return view.relationships.flatMap((edge) => {
        if (edge.origin === "system") return [];
        const {
            schemaVersion: _schemaVersion,
            family: _family,
            origin: _origin,
            reviewState: _reviewState,
            ...input
        } = edge;
        return [input];
    });
}

function retainedEvidenceEditor(
    enabled: boolean,
    retainedEdges: Map<string, ViewRelationshipInput>,
    onChange: () => void,
): HTMLFieldSetElement {
    const fieldset = rbNode("fieldset");
    fieldset.append(rbNode("legend", "Retained section evidence"));
    if (!enabled) return fieldset;
    for (const edge of retainedEdges.values()) {
        const label = rbNode("label");
        const retained = document.createElement("input");
        retained.type = "checkbox";
        retained.checked = true;
        retained.onchange = () => {
            if (retained.checked) retainedEdges.set(edge.id, edge);
            else retainedEdges.delete(edge.id);
            onChange();
        };
        label.append(
            retained,
            rbNode(
                "span",
                `${edge.from.sectionId}: ${edge.predicate} ${edge.to.kind === "source" ? `${edge.to.sourceId} @ ${edge.to.revisionId}` : edge.to.sectionId}`,
            ),
        );
        fieldset.append(label);
    }
    return fieldset;
}

function publicationChoice(label: string, inherit: boolean): HTMLSelectElement {
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    for (const value of [...(inherit ? ["inherit"] : []), "on", "off"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent =
            value === "inherit" ? "Inherit" : value === "on" ? "On" : "Off";
        select.append(option);
    }
    return select;
}

export function mountMemoryHubViews(
    host: HTMLElement,
    options: {
        scope: () => string | undefined;
        onError: (error: unknown) => void;
        onNavigate?: (route: string) => void;
        onChange?: () => void;
        onOpenView?: (
            corpusId: string,
            viewId: string,
            revisionId?: string,
        ) => void;
        onBuildStarted?: (corpusId: string, jobId: string) => void;
        onChanged?: () => Promise<void> | void;
    },
) {
    const root = rbNode("section");
    root.className = "hub-draft-views";
    root.hidden = false;
    root.setAttribute("aria-label", "Derived views");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const controls = rbNode("div");
    const receipt = rbNode("details", undefined, "hub-view-build-receipt");
    receipt.hidden = true;
    const drafts = rbNode("div");
    const comparison = rbNode("div");
    root.append(
        rbNode("h3", "Views"),
        rbNode(
            "p",
            "Read reusable documents built from your memory. Choose a view to preview it, or build new views from ready evidence.",
        ),
        status,
        controls,
        receipt,
        drafts,
        comparison,
    );
    host.append(root);
    let snapshot: ViewSnapshot = { head: null, views: [] };
    let inventory: ViewSummary[] = [];
    const pager = new MemoryHubInventoryPager();
    let searchQuery = "";
    let selectedKind: ViewKind | undefined;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let policy: ViewPublicationPolicy = {
        revision: 0,
        autoPublish: true,
        views: {},
    };
    const publications = new Map<string, ViewPublicationStatus>();
    const pendingConflicts = new Map<string, ViewMergeConflict>();
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let busy = false;
    let refreshPending = false;
    let disposed = false;
    let detailRequest:
        | { key: string; sequence: number; work: Promise<void> }
        | undefined;
    let supportedKinds: ViewKind[] = ["troubleshootingGuide"];
    let maintenanceSupported = false;
    let buildsSupported = false;
    let capabilitiesLoaded = false;
    let route:
        | {
              corpusId: string;
              viewId: string;
              revisionId?: string;
              pageId?: string;
              itemKey?: string;
          }
        | undefined;
    let activeCorpus: string | undefined;
    let builder: ReturnType<typeof viewSheet> | undefined;
    let initialSources: string[] = [];
    let exactInitialSources = new Map<string, string>();
    let builderDirty = false;
    let visible = true;
    const heads = new Map<string, string | null>();
    const policies = new Map<string, ViewPublicationPolicy>();
    let corpusNames = new Map<string, string>();
    const publicationKey = (corpusId: string, viewId: string) =>
        JSON.stringify([corpusId, viewId]);
    const markDirty = () => {
        dirty = true;
        options.onChange?.();
    };
    const changed = async () => {
        options.onChange?.();
        await options.onChanged?.();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
        if (!dirty && !builderDirty) return;
        event.preventDefault();
        event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);

    async function action(operation: () => Promise<void>): Promise<void> {
        if (busy || disposed) return;
        busy = true;
        root.setAttribute("aria-busy", "true");
        try {
            await operation();
        } catch (error) {
            status.textContent = `View operation failed: ${rbError(error)}. No success or overwrite is assumed.`;
            const dialog =
                root.querySelector<HTMLDialogElement>("dialog[open]");
            if (dialog) {
                let alert = dialog.querySelector<HTMLElement>('[role="alert"]');
                if (!alert) {
                    alert = rbNode("p");
                    alert.setAttribute("role", "alert");
                    dialog.append(alert);
                }
                alert.textContent = status.textContent;
            }
            options.onError(error);
        } finally {
            busy = false;
            root.setAttribute("aria-busy", "false");
            if (refreshPending) {
                refreshPending = false;
                void action(refresh);
            }
        }
    }

    async function refresh(): Promise<void> {
        const current = ++sequence;
        const capabilities = await invokeMemory("memoryViewCapabilities", {});
        if (current !== sequence) return;
        capabilitiesLoaded = true;
        root.hidden = !visible;
        maintenanceSupported = capabilities.derivedViews?.maintenance === true;
        buildsSupported = capabilities.derivedViews?.builds === true;
        supportedKinds = (
            capabilities.derivedViews?.kinds ?? ["troubleshootingGuide"]
        ).filter(
            (kind): kind is ViewKind =>
                kind === "troubleshootingGuide" ||
                kind === "projectBrief" ||
                kind === "timeline" ||
                kind === "wiki" ||
                kind === "schemaView",
        );
        if (!buildsSupported) {
            pendingConflicts.clear();
            status.textContent =
                "The connected memory service does not provide view building. Views may be explicitly disabled by the host or unavailable in this service version. No setting in Memory needs to be enabled.";
            controls.replaceChildren();
            drafts.replaceChildren();
            receipt.replaceChildren();
            comparison.replaceChildren();
            return;
        }
        const selectedScope = options.scope();
        const corpusId = route?.corpusId ?? selectedScope;
        const catalog = await invokeMemory("memoryListCorpora", {});
        if (current !== sequence || selectedScope !== options.scope()) return;
        corpusNames = new Map(
            catalog.map((corpus) => [corpus.corpusId, corpus.name]),
        );
        const corpora = (corpusId ? [{ corpusId }] : catalog).filter((corpus) =>
            pager.includes(corpus.corpusId),
        );
        const collections = await Promise.all(
            corpora.map(async ({ corpusId }) => {
                const views = await invokeMemory("memoryListViewSummaries", {
                    ...pager.request(corpusId),
                    ...(route
                        ? { viewId: route.viewId, pageSize: 1 }
                        : {
                              ...(searchQuery ? { query: searchQuery } : {}),
                              ...(selectedKind ? { kind: selectedKind } : {}),
                          }),
                });
                return { corpusId, views };
            }),
        );
        if (current !== sequence || selectedScope !== options.scope()) return;
        heads.clear();
        policies.clear();
        for (const collection of collections) {
            heads.set(collection.corpusId, collection.views.head);
        }
        snapshot = {
            head: collections.length === 1 ? collections[0].views.head : null,
            views: [],
        };
        inventory = collections.flatMap((collection) => collection.views.items);
        pager.update(
            collections.map((collection) => ({
                corpusId: collection.corpusId,
                ...collection.views,
            })),
        );
        publications.clear();
        for (const view of inventory)
            publications.set(
                publicationKey(view.corpusId, view.viewId),
                view.publication,
            );
        if (current !== sequence) return;
        const build = rbButton("Build views", () => {
            exactInitialSources.clear();
            void action(() => openBuilder());
        });
        build.classList.add("primary");
        build.prepend(icon("fa-plus"));
        const maintenance = collectionWikiControls(capabilities);
        controls.replaceChildren(
            build,
            rbIconButton("fa-arrows-rotate", "Refresh views", () => {
                pager.reset();
                void action(refresh);
            }),
            ...(maintenance.length
                ? [menuButton("Maintain collection", maintenance, "fa-gear")]
                : []),
        );
        const jobs = collections.flatMap((collection) =>
            collection.views.latestBuild ? [collection.views.latestBuild] : [],
        );
        const familyStatus = collections.flatMap((collection) => [
            ...wikiStatusDescription(
                collection.corpusId,
                collection.views.wikiFamily,
            ),
            ...wikiStatusDescription(
                collection.corpusId,
                collection.views.projectFamily,
                "Projects",
            ),
        ]);
        renderDrafts();
        status.textContent += familyStatus.join(" ");
        if (jobs[0]) {
            const job = jobs[0];
            receipt.hidden = false;
            receipt.replaceChildren(
                rbButton(
                    `Latest build: ${job.state} — show operation details`,
                    () => {
                        void action(async () => {
                            const full = await invokeMemory(
                                "memoryGetViewBuild",
                                { corpusId: job.corpusId, jobId: job.jobId },
                            );
                            if (!full)
                                throw new Error(
                                    "The selected build is unavailable.",
                                );
                            renderReceipt(full);
                        });
                    },
                ),
            );
        } else {
            receipt.replaceChildren();
            receipt.hidden = true;
        }

        function wikiStatusDescription(
            corpusId: string,
            family: ViewSnapshot["wikiFamily"],
            label = "Wiki",
        ): string[] {
            if (!family) return [];
            return [
                `${corpusNames.get(corpusId) ?? corpusId}: ${label} ${family.enabled ? "automatic" : "paused"}; ${family.pending ? "bounded work pending" : "up to date"}${family.error ? `; retry needed: ${family.error}` : ""}.`,
            ];
        }

        // Family-wide maintenance lives in one menu rather than eight page
        // buttons that multiply with every family.
        function collectionWikiControls(capabilities: {
            derivedViews?: { informationalWiki?: true };
        }): MenuItem[] {
            if (!capabilities.derivedViews?.informationalWiki) return [];
            const glyphs = {
                update: "fa-arrows-rotate",
                rebuild: "fa-rotate-right",
                pause: "fa-pause",
                resume: "fa-play",
            } as const;
            return (["wiki", "projects"] as const).flatMap((family) =>
                (["update", "rebuild", "pause", "resume"] as const).map(
                    (operation): MenuItem => ({
                        label: `${operation[0].toUpperCase()}${operation.slice(1)} ${family === "wiki" ? "Wiki" : "Projects"}`,
                        icon: glyphs[operation],
                        action: () => {
                            void action(async () => {
                                const corpusId = options.scope();
                                if (!corpusId)
                                    throw new Error(
                                        "Choose one collection to update its Wiki.",
                                    );
                                const current = await invokeMemory(
                                    "memoryListViews",
                                    { corpusId },
                                );
                                const result = await invokeMemory(
                                    "memoryMaintainViews",
                                    {
                                        corpusId,
                                        expectedHead: current.head,
                                        family,
                                        operation,
                                    },
                                );
                                if (result.job) renderReceipt(result.job);
                                await refresh();
                            });
                        },
                    }),
                ),
            );
        }
        status.textContent = pager.total
            ? `Showing ${inventory.length} of ${pager.total} saved views${corpusId ? "" : " across your collections"}.`
            : "No views yet. Wiki pages and Projects are discovered automatically from indexed evidence. Update a collection family or build a timeline or guide.";
        if (route && !dirty) await renderRoute(route, current);
    }

    async function loadPendingConflicts(
        jobs: ViewBuildSummary[],
        current: number,
    ): Promise<void> {
        const references = new Map<
            string,
            { corpusId: string; conflictId: string }
        >();
        const ordered = [...jobs].sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
        );
        for (const job of ordered)
            for (const result of job.results) {
                const key = publicationKey(job.corpusId, result.viewId);
                if (result.conflictId && !references.has(key))
                    references.set(key, {
                        corpusId: job.corpusId,
                        conflictId: result.conflictId,
                    });
            }
        const conflicts = await Promise.all(
            [...references].map(async ([key, input]) => {
                const conflict = await invokeMemory(
                    "memoryGetViewConflict",
                    input,
                );
                if (!conflict)
                    throw new Error(
                        "A conflict referenced by a build receipt is unavailable; refresh Activity or inspect view history",
                    );
                return { key, conflict };
            }),
        );
        if (disposed || current !== sequence) return;
        pendingConflicts.clear();
        for (const { key, conflict } of conflicts)
            if (conflict.state === "pending")
                pendingConflicts.set(key, conflict);
    }

    async function ensureReaderCapabilities(current: number): Promise<boolean> {
        if (!capabilitiesLoaded) {
            const capabilities = await invokeMemory(
                "memoryViewCapabilities",
                {},
            );
            if (disposed || current !== sequence) return false;
            capabilitiesLoaded = true;
            buildsSupported = capabilities.derivedViews?.builds === true;
            maintenanceSupported =
                capabilities.derivedViews?.maintenance === true;
            supportedKinds = capabilities.derivedViews?.kinds ?? [];
        }
        if (!buildsSupported)
            throw new Error(
                "The connected memory service does not provide view building.",
            );
        return true;
    }

    async function readRouteView(
        target: Parameters<typeof renderRoute>[0],
    ): Promise<ViewVersion> {
        const latest = snapshot.views.find(
            (view) =>
                view.corpusId === target.corpusId &&
                view.viewId === target.viewId,
        );
        const view =
            target.revisionId || !latest
                ? await invokeMemory("memoryGetView", {
                      corpusId: target.corpusId,
                      viewId: target.viewId,
                      ...(target.revisionId
                          ? { revisionId: target.revisionId }
                          : {}),
                  })
                : latest;
        if (!view)
            throw new Error(
                target.revisionId
                    ? "Exact view revision is unavailable"
                    : "This view is unavailable in the selected collection.",
            );
        if (
            target.revisionId &&
            (view.revisionId !== target.revisionId ||
                view.corpusId !== target.corpusId ||
                view.viewId !== target.viewId)
        )
            throw new Error(
                "The service did not return the requested exact view revision",
            );
        return view;
    }

    async function renderRoute(
        target: {
            corpusId: string;
            viewId: string;
            revisionId?: string;
            pageId?: string;
            itemKey?: string;
        },
        current: number,
    ): Promise<void> {
        if (!(await ensureReaderCapabilities(current))) return;
        const view = await readRouteView(target);
        if (disposed || current !== sequence) return;
        if (!target.revisionId) {
            snapshot.views = [
                ...snapshot.views.filter(
                    (item) =>
                        item.corpusId !== view.corpusId ||
                        item.viewId !== view.viewId,
                ),
                view,
            ];
        }
        if (view.redirect && !target.revisionId) {
            await renderCurrentWikiRedirect(view.redirect, target, current);
            return;
        }
        const enableActions = showPreview(view, false);
        if (
            view.content.kind === "schemaView" &&
            (target.pageId || target.itemKey)
        ) {
            await showSchemaPage(target, current);
            if (disposed || current !== sequence) return;
            comparison
                .querySelector(".hub-view-actions")
                ?.replaceChildren(
                    rbButton("Back to views", backToViews),
                    rbNode("p", "Structured page (read-only)"),
                );
            return;
        }
        if (target.pageId)
            focusArticlePage(
                view.redirect?.anchors.find(
                    (anchor) => anchor.from === target.pageId,
                )?.to ?? target.pageId,
            );
        if (target.revisionId) {
            await showExactRevisionControls(view, current);
            return;
        }
        await loadReaderActions(view, current);
        if (disposed || current !== sequence) return;
        enableActions?.();
    }

    async function showExactRevisionControls(
        view: ViewVersion,
        current: number,
    ): Promise<void> {
        const revisionLabel = rbNode("p", "Selected revision (read-only)");
        comparison.querySelector(".hub-view-actions")?.replaceChildren(
            revisionLabel,
            rbNode("p", `Revision: ${view.revisionId}`),
            rbButton("Back to views", backToViews),
            rbButton("Open current view", () => {
                void showView(
                    view.corpusId,
                    view.redirect?.viewId ?? view.viewId,
                );
            }),
        );
        const summary = await invokeMemory("memoryListViewSummaries", {
            corpusId: view.corpusId,
            viewId: view.viewId,
            pageSize: 1,
        });
        if (disposed || current !== sequence) return;
        revisionLabel.textContent =
            summary.items.find((item) => item.viewId === view.viewId)
                ?.revisionId === view.revisionId
                ? "Exact revision (read-only)"
                : "Historical revision (read-only)";
    }

    async function loadReaderActions(
        view: ViewVersion,
        current: number,
    ): Promise<void> {
        const [summary, selectedJobs] = await Promise.all([
            invokeMemory("memoryListViewSummaries", {
                corpusId: view.corpusId,
                viewId: view.viewId,
                pageSize: 1,
            }),
            invokeMemory("memoryListViewBuildSummaries", {
                corpusId: view.corpusId,
                viewId: view.viewId,
                pageSize: 1,
            }),
        ]);
        if (disposed || current !== sequence) return;
        const latestSummary = summary.items.find(
            (item) => item.viewId === view.viewId,
        );
        if (!latestSummary || latestSummary.revisionId !== view.revisionId)
            throw new Error(
                "The current view changed; reopen it before editing.",
            );
        await loadPendingConflicts(selectedJobs.items, current);
        if (disposed || current !== sequence) return;
        heads.set(view.corpusId, summary.head);
        publications.set(
            publicationKey(view.corpusId, view.viewId),
            latestSummary.publication,
        );
    }

    function loadDetail(
        target: Parameters<typeof renderRoute>[0],
    ): Promise<void> {
        const key = JSON.stringify(target);
        if (detailRequest?.key === key && detailRequest.sequence === sequence)
            return detailRequest.work;
        const current = ++sequence;
        route = target;
        drafts.hidden = controls.hidden = true;
        comparison.setAttribute("aria-busy", "true");
        comparison.replaceChildren(
            rbButton("Back to views", backToViews),
            rbNode("p", "Loading view details..."),
        );
        const work = renderRoute(target, current)
            .catch((error: unknown) => {
                if (disposed || current !== sequence) return;
                const alert = rbNode(
                    "p",
                    `View details unavailable: ${rbError(error)}. Editing remains unavailable.`,
                );
                alert.setAttribute("role", "alert");
                comparison.append(alert);
                options.onError(error);
            })
            .finally(() => {
                if (disposed || current !== sequence) return;
                comparison.setAttribute("aria-busy", "false");
                detailRequest = undefined;
            });
        detailRequest = { key, sequence: current, work };
        return work;
    }

    async function showSchemaPage(
        target: Parameters<typeof renderRoute>[0],
        current: number,
    ): Promise<void> {
        const page = await invokeMemory("memoryGetViewPage", {
            corpusId: target.corpusId,
            viewId: target.viewId,
            ...(target.revisionId ? { revisionId: target.revisionId } : {}),
            ...(target.pageId ? { slotId: target.pageId } : {}),
            ...(target.itemKey ? { itemKey: target.itemKey } : {}),
        });
        if (disposed || current !== sequence) return;
        comparison.append(
            rbNode("p", `${page.uri} · ${page.revisionId}`),
            rbNode("pre", page.markdown),
        );
    }

    async function renderCurrentWikiRedirect(
        redirect: NonNullable<ViewVersion["redirect"]>,
        target: Parameters<typeof renderRoute>[0],
        current: number,
    ): Promise<void> {
        const pageId =
            target.pageId &&
            redirect.anchors.find((anchor) => anchor.from === target.pageId)
                ?.to;
        if (target.pageId && !pageId)
            throw new Error(
                "Old article anchor is unavailable; open the canonical article directly",
            );
        route = {
            corpusId: target.corpusId,
            viewId: redirect.viewId,
            ...(pageId ? { pageId } : {}),
        };
        const destination = `#/views/${encodeURIComponent(target.corpusId)}/${encodeURIComponent(redirect.viewId)}${pageId ? `/page/${encodeURIComponent(pageId)}` : ""}`;
        if (options.onNavigate) options.onNavigate(destination);
        else window.location.hash = destination;
        await renderRoute(route, current);
    }

    function backToViews(): void {
        if (!discardChanges()) return;
        sequence++;
        route = undefined;
        comparison.replaceChildren();
        drafts.hidden = controls.hidden = false;
        if (busy) refreshPending = true;
        else void action(refresh);
        if (options.onNavigate) options.onNavigate("#/views");
        else window.location.hash = "#/views";
    }

    function focusArticlePage(pageId: string): void {
        const page = [
            ...comparison.querySelectorAll<HTMLElement>("[data-page]"),
        ].find((entry) => entry.dataset.page === pageId);
        if (!page)
            throw new Error(
                "Requested article anchor is unavailable in this revision",
            );
        page.focus();
        page.scrollIntoView?.({ block: "start" });
    }

    async function openBuilder(
        corpusId = options.scope(),
        sourceIds: string[] = [],
        rebuilding?: ViewVersion,
    ): Promise<void> {
        if (!discardChanges()) return;
        sequence++;
        builder?.close();
        builder = viewSheet(
            root,
            "Build views",
            () => !busy && discardChanges(),
        );
        builder.element.addEventListener("change", () => {
            builderDirty = true;
        });
        initialSources = sourceIds;
        const picker = document.createElement("select");
        picker.setAttribute("aria-label", "Build collection");
        const corpora = await invokeMemory("memoryListCorpora", {});
        if (disposed || !builder.element.isConnected) return;
        picker.append(new Option("Choose a collection", ""));
        for (const corpus of corpora)
            picker.append(new Option(corpus.name, corpus.corpusId));
        picker.value = corpusId ?? "";
        picker.disabled = rebuilding !== undefined;
        const content = rbNode("div");
        builder.body.append(
            rbNode(
                "p",
                "Choose view types, ready evidence, then confirm exact inputs before generation.",
            ),
            picker,
            content,
        );
        const load = async () => {
            activeCorpus = picker.value || undefined;
            content.replaceChildren();
            if (!activeCorpus) {
                content.append(
                    rbNode(
                        "p",
                        "All memory can be browsed together. Builds use one explicit collection.",
                    ),
                );
                return;
            }
            const current = sequence;
            const corpusId = activeCorpus;
            policy = await invokeMemory("memoryGetViewPublicationPolicy", {
                corpusId,
            });
            await renderControls(corpusId, current, content, rebuilding);
        };
        picker.onchange = () => {
            void action(load);
        };
        await load();
    }

    async function renderControls(
        corpusId: string,
        current: number,
        container: HTMLElement,
        rebuilding?: ViewVersion,
    ): Promise<void> {
        const [sources, events] = await Promise.all([
            listReadyViewSources(corpusId),
            supportedKinds.includes("timeline")
                ? listViewTimelineEvents(corpusId)
                : Promise.resolve([]),
        ]);
        if (current !== sequence || activeCorpus !== corpusId) return;
        for (const [sourceId, revisionId] of exactInitialSources)
            if (
                sources.find((source) => source.sourceId === sourceId)
                    ?.revisionId !== revisionId
            )
                throw new Error(
                    "A selected source revision is no longer ready and current. Review source selection again.",
                );
        const selected = new Map<string, string>();
        const selectedEvents = new Set<string>();
        const eventHost = rbNode("fieldset");
        eventHost.hidden = true;
        eventHost.append(
            rbNode("legend", "Canonical timeline events (not document IDs)"),
        );
        for (const event of events) {
            const label = rbNode("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.setAttribute("aria-label", `Use event ${event.eventId}`);
            if (
                rebuilding?.definition.selector.kind === "timelineEvidence" &&
                rebuilding.definition.selector.events.some(
                    (input) => input.eventId === event.eventId,
                )
            ) {
                checkbox.checked = true;
                selectedEvents.add(event.eventId);
            }
            checkbox.onchange = () => {
                if (checkbox.checked) selectedEvents.add(event.eventId);
                else selectedEvents.delete(event.eventId);
            };
            label.append(
                checkbox,
                rbNode(
                    "span",
                    `${event.eventType} [${event.eventId}] occurred ${event.eventTime}; learned ${event.observedAt}; captured ${event.createdAt}`,
                ),
            );
            eventHost.append(label);
        }
        const sourceHost = rbNode("fieldset");
        sourceHost.append(
            rbNode(
                "legend",
                "Select exact current evidence (maximum 32 sources)",
            ),
        );
        const selectAll = document.createElement("input");
        selectAll.type = "checkbox";
        selectAll.setAttribute("aria-label", "Select all sources");
        const selectAllLabel = rbNode("label");
        selectAllLabel.append(selectAll, rbNode("span", "Select all sources"));
        const selectionCount = rbNode("p");
        selectionCount.setAttribute("role", "status");
        const sourceControls = new Map<string, HTMLInputElement>();
        const updateSelection = () => {
            selectAll.checked =
                sources.length > 0 && selected.size === sources.length;
            selectAll.indeterminate =
                selected.size > 0 && selected.size < sources.length;
            selectAll.disabled = sources.length === 0;
            selectionCount.textContent = `${selected.size} of ${sources.length} sources selected. Maximum 32 sources per view.${selected.size > 32 ? " Deselect sources before continuing." : ""}`;
        };
        selectAll.onchange = () => {
            for (const source of sources) {
                sourceControls.get(source.sourceId)!.checked =
                    selectAll.checked;
                if (selectAll.checked)
                    selected.set(source.sourceId, source.revisionId);
                else selected.delete(source.sourceId);
            }
            updateSelection();
        };
        sourceHost.append(selectAllLabel, selectionCount);
        sourceHost.append(
            rbNode(
                "p",
                "Choose sources relevant to the views you want. Project summaries can retrieve by query from all ready sources without manual selection; a selection optionally narrows that scope. Missing facts stay unknown.",
            ),
        );
        for (const source of sources) {
            const label = rbNode("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.setAttribute("aria-label", `Use ${source.title}`);
            checkbox.checked = initialSources.includes(source.sourceId);
            if (checkbox.checked)
                selected.set(source.sourceId, source.revisionId);
            checkbox.onchange = () => {
                if (checkbox.checked)
                    selected.set(source.sourceId, source.revisionId);
                else selected.delete(source.sourceId);
                updateSelection();
            };
            sourceControls.set(source.sourceId, checkbox);
            label.append(
                checkbox,
                rbNode(
                    "span",
                    `${source.title} [${source.sourceId} @ ${source.revisionId}]`,
                ),
            );
            sourceHost.append(label);
        }
        updateSelection();
        const selectedKinds = new Set<ViewKind>();
        if (rebuilding) selectedKinds.add(rebuilding.content.kind);
        const targets = new Map(
            supportedKinds.map((kind) => [
                kind,
                `${kind}-${[...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
            ]),
        );
        const kindPicker = rbNode("fieldset", undefined, "hub-view-kinds");
        kindPicker.append(rbNode("legend", "What would you like to build?"));
        for (const kind of supportedKinds) {
            if ((kind === "wiki" && !rebuilding) || kind === "schemaView")
                continue;
            if (rebuilding && kind !== rebuilding.content.kind) continue;
            const label = rbNode("label", undefined, "hub-view-kind");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = selectedKinds.has(kind);
            checkbox.disabled = rebuilding !== undefined;
            checkbox.setAttribute("aria-label", viewKindLabels[kind]);
            checkbox.onchange = () => {
                if (checkbox.checked) selectedKinds.add(kind);
                else selectedKinds.delete(kind);
                eventHost.hidden =
                    occurredFrom.hidden =
                    occurredTo.hidden =
                        !selectedKinds.has("timeline");
            };
            label.append(checkbox, rbNode("strong", viewKindLabels[kind]));
            kindPicker.append(label);
        }
        const cutoff = document.createElement("input");
        cutoff.setAttribute("aria-label", "Learned before ISO timestamp");
        cutoff.placeholder = "Optional learned-before ISO timestamp";
        const occurredFrom = document.createElement("input");
        occurredFrom.setAttribute("aria-label", "Occurred from ISO timestamp");
        occurredFrom.placeholder =
            "Optional occurrence start (explicit timezone)";
        const occurredTo = document.createElement("input");
        occurredTo.setAttribute("aria-label", "Occurred to ISO timestamp");
        occurredTo.placeholder = "Optional occurrence end (explicit timezone)";
        eventHost.hidden =
            occurredFrom.hidden =
            occurredTo.hidden =
                !selectedKinds.has("timeline");
        const corpusPolicy = publicationChoice(
            "Corpus auto-publish after build",
            false,
        );
        corpusPolicy.value = policy.autoPublish ? "on" : "off";
        const settings = rbNode("fieldset");
        settings.append(
            rbNode("legend", "Corpus settings: Auto-publish after build"),
            corpusPolicy,
            rbButton("Save corpus publication setting", () => {
                void action(async () => {
                    await invokeMemory("memoryUpdateViewPublicationPolicy", {
                        corpusId,
                        expectedHead: heads.get(corpusId) ?? null,
                        expectedRevision: policy.revision,
                        autoPublish: corpusPolicy.value === "on",
                    });
                    await refresh();
                    await changed();
                });
            }),
        );
        const buildPolicy = publicationChoice(
            "Build auto-publish after build",
            true,
        );
        const effective = rbNode("p");
        const updateEffective = () => {
            const override = rebuilding
                ? policy.views[rebuilding.viewId]?.autoPublish
                : undefined;
            const value =
                buildPolicy.value !== "inherit"
                    ? buildPolicy.value === "on"
                    : (override ?? policy.autoPublish);
            const origin =
                buildPolicy.value !== "inherit"
                    ? "build override"
                    : override == null
                      ? "corpus setting"
                      : "view override";
            effective.textContent = `Auto-publish after build: ${value ? "On" : "Off"} (${origin}). One-build overrides do not change saved settings.`;
        };
        buildPolicy.onchange = updateEffective;
        updateEffective();
        const projectQuery = document.createElement("input");
        projectQuery.setAttribute(
            "aria-label",
            "Indexed project summary query",
        );
        projectQuery.placeholder =
            "Required project name/query for bounded indexed summary";
        projectQuery.value = rebuilding?.definition.projectSummary?.query ?? "";
        container.replaceChildren(
            kindPicker,
            sourceHost,
            eventHost,
            cutoff,
            occurredFrom,
            occurredTo,
            buildPolicy,
            effective,
            projectQuery,
            rbButton("Continue to confirmation", () => {
                void action(async () => {
                    if (dirty)
                        throw new Error(
                            "Save or explicitly discard editor changes before building",
                        );
                    if (!selectedKinds.size)
                        throw new Error("Choose at least one view type");
                    const latest = await invokeMemory("memoryListViews", {
                        corpusId,
                    });
                    if (rebuilding) {
                        if (corpusId !== rebuilding.corpusId)
                            throw new Error(
                                "A rebuild cannot move a view to another collection",
                            );
                        const current = latest.views.find(
                            (view) => view.viewId === rebuilding.viewId,
                        );
                        if (
                            !current ||
                            current.version !== rebuilding.version ||
                            current.revisionId !== rebuilding.revisionId
                        )
                            throw new Error(
                                "The view changed; refresh it before rebuilding",
                            );
                    }
                    const selectedSources = [...selected].map(
                        ([sourceId, revisionId]) => ({
                            sourceId,
                            revisionId,
                        }),
                    );
                    const timelineSources = selectedKinds.has("timeline")
                        ? await recordSources(corpusId, selectedSources)
                        : [];
                    const bounds = viewBuildBounds(
                        cutoff.value,
                        occurredFrom.value,
                        occurredTo.value,
                        selectedKinds.has("timeline"),
                    );
                    const buildTargets = createViewBuildTargets(
                        selectedKinds,
                        targets,
                        selectedSources,
                        timelineSources,
                        selectedEvents,
                        rebuilding,
                        projectQuery.value,
                        selectedSources,
                    );
                    if (
                        current !== sequence ||
                        corpusId !== activeCorpus ||
                        !builder?.element.isConnected
                    )
                        return;
                    const confirmation = rbNode(
                        "section",
                        undefined,
                        "hub-view-confirmation",
                    );
                    const publication = buildPolicy.value;
                    confirmation.append(
                        rbNode("h3", "Confirm exact inputs"),
                        rbNode("p", effective.textContent ?? ""),
                    );
                    for (const target of buildTargets) {
                        const detail = rbNode("details");
                        detail.open = true;
                        detail.append(
                            rbNode(
                                "summary",
                                viewKindLabels[target.definition.kind],
                            ),
                            rbNode(
                                "p",
                                `${rebuilding ? "Rebuild view" : "New view"}: ${target.definition.viewId}`,
                            ),
                            rbNode(
                                "p",
                                target.definition.selector.sources
                                    .map(
                                        (source) =>
                                            `${source.sourceId} @ ${source.revisionId}`,
                                    )
                                    .join(", ") ||
                                    (target.definition.projectSummary
                                        ? "Search current eligible indexed sources automatically"
                                        : "No document sources"),
                            ),
                        );
                        if (
                            target.definition.selector.kind ===
                            "timelineEvidence"
                        )
                            detail.append(
                                rbNode(
                                    "p",
                                    `Canonical events: ${target.definition.selector.events.map((event) => event.eventId).join(", ") || "none"}`,
                                ),
                                rbNode(
                                    "p",
                                    `${sources.length - timelineSources.length} non-record documents excluded. Learned through ${bounds.learnedBefore ?? "unbounded"}; occurred ${bounds.occurredFrom ?? "unbounded"} to ${bounds.occurredTo ?? "unbounded"} (inclusive, UTC). Capture time is not knowledge time.`,
                                ),
                            );
                        confirmation.append(detail);
                    }
                    const submit = rbButton("Start build", () => {
                        void action(async () => {
                            if (
                                current !== sequence ||
                                corpusId !== activeCorpus
                            )
                                throw new Error(
                                    "Collection changed; review inputs again",
                                );
                            const job = await invokeMemory("memoryBuildViews", {
                                corpusId,
                                expectedHead: latest.head,
                                targets: buildTargets,
                                ...(Object.values(bounds).some(Boolean)
                                    ? { bounds }
                                    : {}),
                                ...(publication === "inherit"
                                    ? {}
                                    : { publication: publication === "on" }),
                            });
                            if (current === sequence) {
                                renderReceipt(job);
                                receipt.open = true;
                                builder?.element.remove();
                                builder = undefined;
                                builderDirty = false;
                                options.onChange?.();
                                await options.onChanged?.();
                                options.onBuildStarted?.(
                                    job.corpusId,
                                    job.jobId,
                                );
                            }
                        });
                    });
                    confirmation.append(
                        submit,
                        rbButton("Back to selection", () => {
                            confirmation.remove();
                            for (const child of [...container.children])
                                (child as HTMLElement).hidden = false;
                            eventHost.hidden =
                                occurredFrom.hidden =
                                occurredTo.hidden =
                                    !selectedKinds.has("timeline");
                        }),
                    );
                    for (const child of [...container.children])
                        (child as HTMLElement).hidden = true;
                    container.append(confirmation);
                    submit.focus();
                });
            }),
        );
        const settingsDetails = rbNode("details");
        settingsDetails.append(
            rbNode("summary", "Collection publication settings"),
            settings,
        );
        container.append(settingsDetails);
        const search = document.createElement("input");
        search.type = "search";
        search.setAttribute("aria-label", "Find ready sources");
        search.placeholder = "Find ready sources";
        search.oninput = () => {
            for (const checkbox of sourceControls.values()) {
                const label = checkbox.parentElement!;
                label.hidden = !(label.textContent ?? "")
                    .toLowerCase()
                    .includes(search.value.toLowerCase());
            }
        };
        sourceHost.insertBefore(search, sourceHost.children[1] ?? null);
    }

    async function recordSources(
        corpusId: string,
        sources: Array<{ sourceId: string; revisionId: string }>,
    ) {
        const records = [];
        for (const source of sources) {
            const content = await readViewSourceText(corpusId, source);
            let fenced = false;
            const lines = content.split(/\r?\n/).filter((line) => {
                if (/^\s*(`{3,}|~{3,})/.test(line)) {
                    fenced = !fenced;
                    return false;
                }
                return !fenced;
            });
            if (
                lines.some((line) =>
                    /^## Record [A-Za-z0-9][A-Za-z0-9._:-]{0,199}\s*$/.test(
                        line,
                    ),
                )
            )
                records.push(source);
        }
        return records;
    }

    function renderReceipt(job: ViewBuildJob): void {
        if (options.scope() && job.corpusId !== options.scope()) return;
        if (timer) clearTimeout(timer);
        receipt.hidden = false;
        receipt.replaceChildren(
            rbNode("summary", `Build ${job.jobId}: ${job.state}`),
        );
        if (job.maintenancePlan) {
            const plan = rbNode("details");
            plan.append(
                rbNode("summary", "Manual maintenance plan"),
                rbNode("pre", JSON.stringify(job.maintenancePlan, null, 2)),
            );
            receipt.append(plan);
        }
        for (const result of job.results) {
            const effective = result.snapshot.publicationPolicy;
            if (effective)
                receipt.append(
                    rbNode(
                        "p",
                        `Auto-publish: ${effective.autoPublish ? "On" : "Off"} (${effective.origin}); corpus policy revision ${effective.corpusRevision}, view policy revision ${effective.viewRevision}`,
                    ),
                );
            if (result.snapshot.definition?.kind === "timeline")
                receipt.append(
                    rbNode(
                        "p",
                        `Timeline checkpoint: learned through ${result.snapshot.bounds.learnedBefore ?? "unbounded"}; occurrence ${result.snapshot.bounds.occurredFrom ?? "unbounded"} to ${result.snapshot.bounds.occurredTo ?? "unbounded"} (inclusive). Record knowledge, not file import time, determines eligibility. Unknown required times are excluded. Canonical event authority is evidence, not permission.`,
                    ),
                );
            if (result.publication)
                receipt.append(
                    rbNode(
                        "p",
                        `Published ${result.publication.publishedRevisionId}; indexed ${result.publication.indexedRevisionId ?? "not ready"}: ${result.publication.reason}`,
                    ),
                );
            receipt.append(
                rbNode(
                    "p",
                    `${result.viewId}: ${result.state}. ${result.reason}`,
                ),
            );
            const exact = rbNode("details");
            exact.append(
                rbNode("summary", `Exact inputs for ${result.viewId}`),
                rbNode(
                    "p",
                    result.snapshot.inputs
                        .map(
                            (source) =>
                                `${source.sourceId} @ ${source.revisionId}`,
                        )
                        .join(", "),
                ),
            );
            receipt.append(exact);
            if (
                ["draft", "merged", "published", "searchable"].includes(
                    result.state,
                )
            )
                receipt.append(
                    rbButton("Open view", () => {
                        void showView(job.corpusId, result.viewId);
                    }),
                );
            if (result.inventory) {
                const details = rbNode("details");
                details.append(
                    rbNode(
                        "summary",
                        "Inspect source-first inventory, source check and final artifact coverage",
                    ),
                    rbNode(
                        "p",
                        "Source-to-inventory and semantic checks are model-based, not guarantees of semantic completeness. Diagnostic-only drafts are not reusable recovery.",
                    ),
                    rbNode(
                        "pre",
                        JSON.stringify(
                            {
                                inventory: result.inventory,
                                sourceCheck: result.inventoryAudit,
                                finalCoverage: result.coverage,
                            },
                            null,
                            2,
                        ),
                    ),
                );
                receipt.append(details);
            }
            if (result.missingEvidence?.length)
                receipt.append(
                    rbNode(
                        "p",
                        `Missing evidence: ${result.missingEvidence.join("; ")}`,
                    ),
                );
            if (result.conflictId)
                receipt.append(
                    rbButton("Compare and resolve conflict", () => {
                        void action(() =>
                            showConflict(job.corpusId, result.conflictId!),
                        );
                    }),
                );
        }
        receipt.append(
            rbButton("Refresh build status", () => {
                void action(() => poll(job));
            }),
        );
        if (job.results.some((result) => result.conflictId))
            receipt.append(
                rbNode(
                    "p",
                    "This receipt records the original build outcome. Explicit conflict resolution saves a separate draft revision.",
                ),
            );
        if (job.state === "running") {
            receipt.append(
                rbButton("Cancel pending materialization", () => {
                    void action(async () =>
                        renderReceipt(
                            await invokeMemory("memoryCancelViewBuild", {
                                corpusId: job.corpusId,
                                jobId: job.jobId,
                            }),
                        ),
                    );
                    status.textContent =
                        "Cancellation requested. Only the durable receipt confirms which targets were cancelled; completed targets are retained.";
                }),
            );
            const current = sequence;
            const tick = () => {
                if (current !== sequence) return;
                if (busy) timer = setTimeout(tick, 500);
                else void action(() => poll(job));
            };
            timer = setTimeout(tick, 500);
        } else if (job.state !== "complete")
            receipt.append(
                rbButton("Retry failed targets", () => {
                    void action(async () =>
                        renderReceipt(
                            await invokeMemory("memoryRetryViewBuild", {
                                corpusId: job.corpusId,
                                jobId: job.jobId,
                            }),
                        ),
                    );
                }),
            );
    }

    async function poll(job: ViewBuildJob): Promise<void> {
        const current = sequence;
        const value = await invokeMemory("memoryGetViewBuild", {
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (current !== sequence) return;
        if (!value)
            throw new Error("Exact build receipt is unavailable or forgotten");
        renderReceipt(value);
        // Polling never replaces an active editor.
        if (value.state !== "running" && !dirty) {
            const latest = await invokeMemory("memoryListViews", {
                corpusId: job.corpusId,
            });
            if (current === sequence) {
                heads.set(job.corpusId, latest.head);
                snapshot = {
                    head: options.scope() ? latest.head : null,
                    views: [
                        ...snapshot.views.filter(
                            (view) => view.corpusId !== job.corpusId,
                        ),
                        ...latest.views,
                    ],
                };
                renderDrafts();
                options.onChange?.();
            }
        }
    }

    function renderDrafts(): void {
        if (dirty) return;
        const search = document.createElement("input");
        search.type = "search";
        search.setAttribute("aria-label", "Find views");
        search.placeholder = "Find views";
        search.value = searchQuery;
        const kind = document.createElement("select");
        kind.setAttribute("aria-label", "Filter view type");
        kind.append(new Option("All view types", ""));
        for (const value of supportedKinds)
            kind.append(new Option(viewKindLabels[value], value));
        kind.value = selectedKind ?? "";
        const list = rbNode("div", undefined, "hub-view-list");
        // Kind plus one publication chip; version and index detail belong to
        // the view's own page.
        const viewStatusChips = (
            view: ViewSummary,
            publication: ReturnType<typeof publications.get>,
        ) => {
            const row = rbNode("div", undefined, "hub-chips");
            row.append(rbChip(viewKindLabels[view.content.kind as ViewKind]));
            if (publication?.indexedRevisionId === view.revisionId)
                row.append(rbChip("Searchable", "good"));
            else if (publication?.publishedRevisionId === view.revisionId)
                row.append(rbChip("Index not current", "warn"));
            else row.append(rbChip("Draft", "warn"));
            return row;
        };
        const render = () => {
            list.replaceChildren();
            const matches = inventory.filter(
                (view) =>
                    supportedKinds.some((kind) => view.content.kind === kind) &&
                    (!kind.value || view.content.kind === kind.value) &&
                    view.content.title
                        .toLowerCase()
                        .includes(search.value.toLowerCase()),
            );
            if (!matches.length)
                list.append(
                    rbNode(
                        "p",
                        "No views match. Try another type or build a new view.",
                    ),
                );
            for (const view of matches) {
                const card = rbNode("article", undefined, "hub-view-card");
                const publication = publications.get(
                    publicationKey(view.corpusId, view.viewId),
                );
                card.append(
                    rbButton(view.content.title, () => {
                        void showView(view.corpusId, view.viewId);
                    }),
                    viewStatusChips(view, publication),
                );
                if (!options.scope()) {
                    const diagnostics = rbNode("details");
                    diagnostics.append(
                        rbNode("summary", "Collection details"),
                        rbNode("p", `Corpus ID: ${view.corpusId}`),
                    );
                    card.append(
                        rbNode(
                            "p",
                            `Collection: ${corpusNames.get(view.corpusId) ?? "Collection name unavailable"}`,
                        ),
                        diagnostics,
                    );
                }
                list.append(card);
            }
        };
        const reload = () => {
            pager.reset();
            void action(refresh);
        };
        search.oninput = () => {
            searchQuery = search.value;
            render();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(reload, 250);
        };
        kind.onchange = () => {
            selectedKind = supportedKinds.find((value) => value === kind.value);
            reload();
        };
        drafts.replaceChildren(
            search,
            kind,
            list,
            pager.controls("views", () => {
                void action(refresh);
            }),
        );
        render();
    }

    async function showView(
        corpusId: string,
        viewId: string,
        revisionId?: string,
    ): Promise<void> {
        if (!discardChanges()) return;
        const work = loadDetail({ corpusId, viewId, revisionId });
        options.onNavigate?.(
            `#/views/${encodeURIComponent(corpusId)}/${encodeURIComponent(viewId)}${revisionId ? `/revision/${encodeURIComponent(revisionId)}` : ""}`,
        );
        options.onOpenView?.(corpusId, viewId, revisionId);
        await work;
    }

    function appendEditorialControls(
        view: ViewVersion,
        article: HTMLElement,
        more: HTMLElement,
    ): void {
        if (view.relatedArticles?.length) {
            const related = rbNode("nav");
            related.setAttribute("aria-label", "Related articles");
            related.append(rbNode("h3", "Related articles"));
            for (const entry of view.relatedArticles)
                related.append(
                    rbButton(entry.title, () => {
                        void action(() =>
                            showView(view.corpusId, entry.viewId),
                        );
                    }),
                );
            article.append(related);
        }
        const protectedTargets = view.protectedTargets ?? [];
        if (
            !view.generation ||
            !(view.content.kind === "wiki" || view.definition.projectSummary)
        )
            return;
        for (const target of protectedTargets)
            more.append(
                rbButton(`Unlock generated updates: ${target}`, () => {
                    void action(async () => {
                        if (!discardChanges()) return;
                        await invokeMemory("memorySaveViewDraft", {
                            corpusId: view.corpusId,
                            viewId: view.viewId,
                            expectedHead:
                                heads.get(view.corpusId) ?? snapshot.head,
                            expectedVersion: view.version,
                            definition: {
                                viewId: view.viewId,
                                kind: view.definition.kind,
                                selector: view.definition.selector,
                                ...(view.definition.wiki
                                    ? { wiki: view.definition.wiki }
                                    : {}),
                                ...(view.definition.schemaView
                                    ? {
                                          schemaView:
                                              view.definition.schemaView,
                                          maintenance:
                                              view.definition.maintenance,
                                      }
                                    : {}),
                                ...(view.definition.projectSummary
                                    ? {
                                          projectSummary:
                                              view.definition.projectSummary,
                                      }
                                    : {}),
                            },
                            content: view.content,
                            relationships: editableEdges(view),
                            unlockProtection: [target],
                        });
                        await changed();
                        await refresh();
                    });
                }),
            );
    }

    function showPreview(
        view: ViewVersion,
        actionsReady = true,
    ): (() => void) | undefined {
        if (!supportedKinds.includes(view.content.kind)) {
            comparison.replaceChildren(
                rbNode(
                    "p",
                    "This view type is not supported by the current memory service.",
                ),
            );
            return;
        }
        drafts.hidden = true;
        controls.hidden = true;
        const title = rbNode("h2", view.content.title);
        title.tabIndex = -1;
        const article = rbNode("article", undefined, "hub-view-document");
        article.append(
            title,
            rbNode("div", undefined, "hub-chips"),
            ...viewRevisionTime(view.createdAt),
        );
        article
            .querySelector(".hub-chips")!
            .append(
                rbChip(viewKindLabels[view.content.kind]),
                rbChip(`Version ${view.version}`),
            );
        if (view.content.summary) {
            const lead = rbMarkdown(view.content.summary);
            lead.classList.add("hub-view-lead");
            article.append(lead);
        }
        if (view.content.kind === "schemaView") {
            const questions = rbNode(
                "a",
                "Review questions, candidates and rubrics",
            );
            questions.href = `#/questions/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(view.viewId)}`;
            article.append(
                questions,
                rbButton("Read deterministic agent page", () => {
                    void action(async () => {
                        const page = await invokeMemory("memoryGetViewPage", {
                            corpusId: view.corpusId,
                            viewId: view.viewId,
                            ...(route?.revisionId
                                ? { revisionId: route.revisionId }
                                : {}),
                            ...(route?.pageId ? { slotId: route.pageId } : {}),
                            ...(route?.itemKey
                                ? { itemKey: route.itemKey }
                                : {}),
                        });
                        article.append(
                            rbNode("p", `${page.uri} · ${page.revisionId}`),
                            rbNode("pre", page.markdown),
                        );
                    });
                }),
            );
        }
        if (view.content.kind === "wiki") {
            const contents = rbNode("nav");
            contents.setAttribute("aria-label", "Wiki pages");
            for (const section of view.content.sections)
                contents.append(
                    rbButton(section.heading, () => {
                        focusArticlePage(section.id);
                        const revisionId = route?.revisionId;
                        route = {
                            corpusId: view.corpusId,
                            viewId: view.viewId,
                            pageId: section.id,
                            ...(revisionId ? { revisionId } : {}),
                        };
                        const destination = `#/views/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(view.viewId)}${revisionId ? `/revision/${encodeURIComponent(revisionId)}` : ""}/page/${encodeURIComponent(section.id)}`;
                        if (options.onNavigate) options.onNavigate(destination);
                        else window.location.hash = destination;
                    }),
                );
            article.append(contents);
        }
        for (const section of view.content.sections) {
            const page = rbNode("section", undefined, "hub-view-section");
            page.tabIndex = -1;
            page.dataset.page = section.id;
            page.append(
                rbNode("h3", section.heading),
                rbMarkdown(section.body),
            );
            if (view.content.kind === "timeline") {
                const record = view.content.sections.find(
                    (record) => record.id === section.id,
                )!;
                page.append(
                    rbNode(
                        "p",
                        `Occurred: ${record.details.occurredAt ?? "unknown"}; learned: ${record.details.learnedAt ?? "unknown"}; captured: ${record.details.capturedAt ?? "unknown"}`,
                    ),
                    rbNode(
                        "p",
                        `${record.details.eventType} - ${record.details.state}; outcome: ${record.details.outcome ?? "unknown"}`,
                    ),
                );
            }
            const evidence = rbNode("details");
            evidence.append(rbNode("summary", "Evidence and relationships"));
            for (const edge of view.relationships) {
                if (
                    edge.origin === "system" ||
                    edge.from.sectionId !== section.id
                )
                    continue;
                evidence.append(rbNode("p", edge.predicate));
                for (const citation of edge.citations)
                    evidence.append(
                        rbButton(
                            `Open exact evidence ${citation.sourceId}`,
                            () => showTimelineEvidence(view, citation),
                        ),
                    );
            }
            page.append(evidence);
            article.append(page);
        }
        if (view.content.citations.length) {
            const citations = rbNode("details");
            citations.append(rbNode("summary", "Exact source evidence"));
            for (const citation of view.content.citations)
                citations.append(
                    rbButton(
                        `${citation.sourceId} @ ${citation.revisionId}`,
                        () => showTimelineEvidence(view, citation),
                    ),
                );
            article.append(citations);
        }
        const actions = rbNode("div", undefined, "hub-view-actions");
        const back = rbButton("Back to views", backToViews);
        back.prepend(icon("fa-arrow-left"));
        actions.append(
            back,
            rbNode("p", "Checking publication and conflicts..."),
        );
        comparison.replaceChildren(actions, article);
        title.focus();
        function enableActions() {
            actions.replaceChildren();
            const more = rbNode("details", undefined, "hub-view-more-actions");
            const moreSummary = rbNode("summary", "More actions");
            more.append(moreSummary);
            appendEditorialControls(view, article, more);
            more.addEventListener("keydown", (event) => {
                if (event.key !== "Escape" || !more.open) return;
                event.preventDefault();
                more.open = false;
                moreSummary.focus();
            });
            const pendingConflict = pendingConflicts.get(
                publicationKey(view.corpusId, view.viewId),
            );
            if (pendingConflict)
                more.append(
                    rbButton("Review pending conflict", () => {
                        void action(() =>
                            showConflict(
                                view.corpusId,
                                pendingConflict.conflictId,
                            ),
                        );
                    }),
                );
            const editButton = rbButton("Edit", () => showEditor(view));
            editButton.classList.add("primary");
            editButton.prepend(icon("fa-pen"));
            actions.append(back, editButton);
            more.append(
                rbButton("Rebuild from evidence", () => {
                    exactInitialSources.clear();
                    void action(() =>
                        openBuilder(
                            view.corpusId,
                            view.definition.selector.sources.map(
                                (source) => source.sourceId,
                            ),
                            view,
                        ),
                    );
                }),
                rbButton("Publication and search", () => {
                    void action(async () => {
                        const current = sequence;
                        const savedPolicy = await invokeMemory(
                            "memoryGetViewPublicationPolicy",
                            { corpusId: view.corpusId },
                        );
                        if (disposed || current !== sequence) return;
                        policies.set(view.corpusId, savedPolicy);
                        const sheet = viewSheet(
                            root,
                            "Publication and search",
                            () => !busy && discardChanges(),
                        );
                        sheet.body.append(publicationPanel(view));
                    });
                }),
                rbButton("History", () => {
                    void action(async () => {
                        const history = await invokeMemory(
                            "memoryViewHistory",
                            {
                                corpusId: view.corpusId,
                                viewId: view.viewId,
                            },
                        );
                        if (disposed) return;
                        const sheet = viewSheet(root, "View history");
                        for (const entry of history)
                            sheet.body.append(
                                rbNode(
                                    "h3",
                                    `Version ${entry.version.version} (${entry.version.state}) @ ${entry.version.revisionId}`,
                                ),
                                rbMarkdown(
                                    viewContentToText(entry.version.content),
                                ),
                                rbIconButton(
                                    "fa-arrow-up-right-from-square",
                                    "Open exact revision",
                                    () => {
                                        sheet.close();
                                        void showView(
                                            view.corpusId,
                                            view.viewId,
                                            entry.version.revisionId,
                                        );
                                    },
                                ),
                            );
                    });
                }),
            );
            if (
                maintenanceSupported &&
                view.state !== "archived" &&
                !view.definition.wiki
            )
                more.append(
                    rbButton("Update view", () => {
                        if (!discardChanges()) return;
                        const sheet = viewSheet(
                            root,
                            "Update view",
                            () => !busy && discardChanges(),
                        );
                        const panel = createMaintenancePanel(
                            view,
                            heads.get(view.corpusId) ?? null,
                            {
                                action: (operation) => {
                                    void action(async () => {
                                        await operation();
                                        await changed();
                                    });
                                },
                                onChange: markDirty,
                                dirty: () => dirty,
                                saved: async () => {
                                    dirty = false;
                                    sheet.close();
                                    await refresh();
                                },
                                onBuild: (job) => {
                                    renderReceipt(job);
                                    options.onBuildStarted?.(
                                        job.corpusId,
                                        job.jobId,
                                    );
                                },
                                isCurrent: () =>
                                    !disposed && sheet.element.isConnected,
                            },
                        );
                        sheet.body.append(panel);
                    }),
                );
            actions.append(more);
        }
        if (actionsReady) enableActions();
        return enableActions;
    }

    function showTimelineEvidence(
        view: ViewVersion,
        citation: ViewCitation,
    ): void {
        void action(async () => {
            const capturedSequence = sequence;
            if (citation.locator.startsWith("indexed:")) {
                const fragment = await invokeMemory("memoryGetSourceContent", {
                    corpusId: view.corpusId,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    indexedLocator: citation.locator,
                });
                if (capturedSequence !== sequence) return;
                if (fragment.content !== citation.excerpt)
                    throw new Error(
                        "Indexed evidence anchor changed or is unavailable.",
                    );
                comparison.append(
                    rbNode(
                        "h5",
                        "Indexed-text evidence (not original source offsets)",
                    ),
                    rbNode("pre", fragment.content),
                );
                return;
            }
            const original = citation.evidence
                ? await invokeView("memoryHubEvidence", {
                      corpusId: view.corpusId,
                      kind: "event",
                      objectId: citation.evidence.eventId,
                      revisionId: citation.revisionId,
                  })
                : await invokeView("memoryHubSourceOriginal", {
                      corpusId: view.corpusId,
                      sourceId: citation.sourceId,
                      revisionId: citation.revisionId,
                      locator: citation.locator,
                  });
            if (capturedSequence !== sequence) return;
            if ("available" in original && !original.available)
                throw new Error(
                    original.error ?? "Original timeline evidence unavailable",
                );
            comparison.append(
                rbNode("h5", original.title),
                rbNode("pre", original.content),
            );
        });
    }

    function showEditor(view: ViewVersion): void {
        if (!discardChanges()) return;
        if (view.content.kind === "schemaView") {
            const link = rbNode(
                "a",
                "Open validated question and rubric editor",
            );
            link.href = `#/questions/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(view.viewId)}`;
            comparison.replaceChildren(
                link,
                rbNode(
                    "p",
                    "Candidate changes are explicit user assertions or reviews, not free-form source evidence edits.",
                ),
            );
            return;
        }
        const editorHead = heads.get(view.corpusId) ?? null;
        const projectEditor =
            view.content.kind === "projectBrief"
                ? createProjectBriefEditor(
                      view.content,
                      () => {
                          markDirty();
                      },
                      (sourceId, revisionId, locator) => {
                          void action(async () => {
                              const capturedSequence = sequence;
                              const original = await invokeView(
                                  "memoryHubSourceOriginal",
                                  {
                                      corpusId: view.corpusId,
                                      sourceId,
                                      revisionId,
                                      locator,
                                  },
                              );
                              if (capturedSequence !== sequence) return;
                              if (!original.available)
                                  throw new Error(
                                      original.error ??
                                          "Original project evidence is unavailable",
                                  );
                              comparison.append(
                                  rbNode("h5", original.title),
                                  rbNode("pre", original.content),
                              );
                          });
                      },
                      view.definition.projectSummary,
                  )
                : undefined;
        const timelineEditor =
            view.content.kind === "timeline"
                ? createTimelineEditor(
                      view.content,
                      editableEdges(view),
                      () => {
                          markDirty();
                      },
                      (citation) => showTimelineEvidence(view, citation),
                  )
                : undefined;
        const wikiEditor =
            view.content.kind === "wiki"
                ? createWikiEditor(
                      view.content,
                      editableEdges(view),
                      () => {
                          markDirty();
                      },
                      (citation) => showTimelineEvidence(view, citation),
                      view.definition.wiki,
                  )
                : undefined;
        const guideEditor =
            view.content.kind === "troubleshootingGuide"
                ? createGuideEditor(view.content, markDirty)
                : undefined;
        const structuredEditor =
            wikiEditor ?? timelineEditor ?? projectEditor ?? guideEditor;
        const relationshipEditor = wikiEditor ?? timelineEditor;
        const content = structuredEditor
            ? undefined
            : jsonEditor("Draft content with stable section IDs", view.content);
        const edges = jsonEditor("Typed relationships", editableEdges(view));
        const retainedEdges = new Map(
            editableEdges(view).map((edge) => [edge.id, edge]),
        );
        const projectEvidence = retainedEvidenceEditor(
            projectEditor !== undefined,
            retainedEdges,
            () => {
                markDirty();
            },
        );
        if (content)
            content.oninput = () => {
                markDirty();
            };
        edges.oninput = () => {
            markDirty();
        };
        const advancedRelationships = rbNode("details");
        advancedRelationships.append(
            rbNode("summary", "Typed relationships (advanced)"),
            edges,
        );
        comparison.replaceChildren(
            rbNode("h4", `Edit ${view.viewId} version ${view.version}`),
            rbNode(
                "p",
                "Content and relationships are separate structured edits. Narrative remains editable; checked fact/context passages must remain somewhere in the final artifact. Rebuild with changed evidence to revise facts. Saving checks exact evidence and semantic/context support; unsupported edits are blocked.",
            ),
            structuredEditor?.element ?? content!,
            ...(relationshipEditor
                ? []
                : projectEditor
                  ? [projectEvidence]
                  : [advancedRelationships]),
            rbButton("Save explicit edits", () => {
                void action(async () => {
                    await invokeMemory("memorySaveViewDraft", {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        expectedHead: editorHead,
                        expectedVersion: view.version,
                        definition: {
                            viewId: view.viewId,
                            kind: view.content.kind as ViewKind,
                            selector: view.definition.selector,
                            ...(wikiEditor?.retrieval()
                                ? { wiki: wikiEditor.retrieval() }
                                : {}),
                            ...(view.definition.maintenance
                                ? { maintenance: view.definition.maintenance }
                                : {}),
                            ...(view.definition.projectSummary
                                ? {
                                      projectSummary:
                                          projectEditor?.retrieval() ??
                                          view.definition.projectSummary,
                                  }
                                : {}),
                        },
                        content: structuredEditor
                            ? structuredEditor.read()
                            : (JSON.parse(
                                  content!.value,
                              ) as DerivedViewContent),
                        relationships: relationshipEditor
                            ? relationshipEditor.relationships()
                            : projectEditor
                              ? [...retainedEdges.values()]
                              : JSON.parse(edges.value),
                    });
                    dirty = false;
                    comparison.replaceChildren();
                    await refresh();
                    await changed();
                });
            }),
            rbButton("Discard unsaved edits", () => {
                if (discardChanges()) showPreview(view);
            }),
        );
        const heading = comparison.querySelector<HTMLElement>("h4");
        if (heading) {
            heading.tabIndex = -1;
            heading.focus();
        }
    }

    function publicationPanel(view: ViewVersion): HTMLElement {
        const panel = rbNode("section");
        const publication = publications.get(
            publicationKey(view.corpusId, view.viewId),
        );
        const savedPolicy = policies.get(view.corpusId);
        if (!savedPolicy)
            throw new Error(
                "Exact publication policy is unavailable; refresh views",
            );
        const viewPolicy = publicationChoice(
            "View auto-publish after build",
            true,
        );
        const override = savedPolicy.views[view.viewId]?.autoPublish;
        viewPolicy.value =
            override == null ? "inherit" : override ? "on" : "off";
        const publish = (retry: boolean) => {
            void action(async () => {
                if (dirty)
                    throw new Error("Save or discard edits before publication");
                const head = heads.get(view.corpusId);
                if (!head)
                    throw new Error("Exact view history head is unavailable");
                const revisionId = retry
                    ? publication?.publishedRevisionId
                    : view.revisionId;
                if (!revisionId)
                    throw new Error("No published revision to index");
                const result = await invokeMemory(
                    retry ? "memoryRetryViewIndex" : "memoryPublishView",
                    {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        revisionId,
                        expectedHead: head,
                        expectedVersion: view.version,
                    },
                );
                await refresh();
                status.textContent = result.reason;
                await changed();
            });
        };
        const retry = rbButton("Retry index", () => publish(true));
        retry.disabled = !publication?.publishedRevisionId;
        panel.append(
            rbNode("p", publicationDescription(publication)),
            rbNode(
                "p",
                `Effective auto-publish: ${(override ?? savedPolicy.autoPublish) ? "On" : "Off"} (${override == null ? "collection setting" : "view override"}). Collection policy revision ${savedPolicy.revision}; view policy revision ${savedPolicy.views[view.viewId]?.revision ?? 0}. Publication does not grant human review or execution.`,
            ),
            viewPolicy,
            rbButton("Save view publication override", () => {
                void action(async () => {
                    if (dirty)
                        throw new Error(
                            "Save or discard edits before changing publication policy",
                        );
                    await invokeMemory("memoryUpdateViewPublicationPolicy", {
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        expectedHead: heads.get(view.corpusId) ?? null,
                        expectedRevision:
                            savedPolicy.views[view.viewId]?.revision ?? 0,
                        autoPublish:
                            viewPolicy.value === "inherit"
                                ? null
                                : viewPolicy.value === "on",
                    });
                    await refresh();
                    await changed();
                });
            }),
            rbButton("Publish exact revision", () => publish(false)),
            retry,
        );
        return panel;
    }

    async function showConflict(
        corpusId: string,
        conflictId: string,
    ): Promise<void> {
        if (!discardChanges()) return;
        const currentSequence = sequence;
        const [conflict, latest] = await Promise.all([
            invokeMemory("memoryGetViewConflict", { corpusId, conflictId }),
            invokeMemory("memoryListViews", { corpusId }),
        ]);
        if (currentSequence !== sequence) return;
        if (!conflict) throw new Error("Conflict is unavailable or forgotten");
        renderConflict(conflict, latest);
    }

    function renderConflict(
        conflict: ViewMergeConflict,
        latest: ViewSnapshot,
    ): void {
        comparison.replaceChildren(
            rbNode(
                "h4",
                `Conflict ${conflict.conflictId}: ${conflict.targets.join(", ")}`,
            ),
        );
        for (const [label, value] of [
            ["Old generated base", conflict.base],
            ["Human draft at conflict", conflict.human],
            ["New generated candidate", conflict.candidate],
        ] as const)
            comparison.append(
                rbNode("h5", label),
                rbNode(
                    "pre",
                    value?.content.kind === "projectBrief" ||
                        value?.content.kind === "timeline" ||
                        value?.content.kind === "wiki"
                        ? viewContentToText(value.content)
                        : JSON.stringify(
                              value ?? "No known generated base",
                              null,
                              2,
                          ),
                ),
            );
        if (conflict.state === "resolved") {
            if (!conflict.resolutionRevisionId)
                throw new Error(
                    "Resolved conflict is missing its resolution revision",
                );
            comparison.append(
                rbNode(
                    "p",
                    `Resolved in draft revision ${conflict.resolutionRevisionId}. This historical comparison is read-only.`,
                ),
            );
            return;
        }
        const current = latest.views.find(
            (view) => view.viewId === conflict.viewId,
        );
        if (!current) throw new Error("Conflict target is missing");
        if (current.revisionId !== conflict.expectedRevisionId) {
            comparison.append(
                rbNode(
                    "p",
                    "The current draft changed after this conflict. This comparison is read-only; rebuild against the current draft before resolving.",
                ),
            );
            return;
        }
        const combinedBrief =
            conflict.candidate.content.kind === "projectBrief"
                ? createProjectBriefEditor(
                      conflict.candidate.content,
                      () => {
                          markDirty();
                      },
                      () => {
                          status.textContent =
                              "Inspect original evidence from the current brief before resolving.";
                      },
                  )
                : undefined;
        const combinedTimeline =
            conflict.candidate.content.kind === "timeline"
                ? createTimelineEditor(
                      conflict.candidate.content,
                      conflict.candidate.relationships,
                      () => {
                          markDirty();
                      },
                      () => {
                          status.textContent =
                              "Inspect exact original evidence from the current timeline before resolving.";
                      },
                  )
                : undefined;
        const combinedWiki =
            conflict.candidate.content.kind === "wiki"
                ? createWikiEditor(
                      conflict.candidate.content,
                      conflict.candidate.relationships,
                      () => {
                          markDirty();
                      },
                      (citation) => showTimelineEvidence(current, citation),
                  )
                : undefined;
        const combinedGuide =
            conflict.candidate.content.kind === "troubleshootingGuide"
                ? createGuideEditor(conflict.candidate.content, markDirty)
                : undefined;
        const structuredEditor = [
            combinedWiki,
            combinedTimeline,
            combinedBrief,
            combinedGuide,
        ].find((editor) => editor !== undefined);
        const relationshipEditor = combinedWiki ?? combinedTimeline;
        const combined = structuredEditor
            ? undefined
            : jsonEditor("Explicit combined resolution", conflict.candidate);
        if (combined)
            combined.oninput = () => {
                dirty = true;
            };
        const choice = document.createElement("select");
        choice.setAttribute("aria-label", "Conflict resolution choice");
        for (const [value, label] of [
            ["human", "Keep my edits"],
            ["generated", "Use new generated content"],
            ["combined", "Use explicit combined result"],
        ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            choice.append(option);
        }
        comparison.append(
            choice,
            structuredEditor?.element ?? combined!,
            rbButton("Resolve explicitly and save draft", () => {
                void action(async () => {
                    const selected = choice.value as
                        | "human"
                        | "generated"
                        | "combined";
                    const output: ViewSynthesisOutput | undefined =
                        selected === "combined"
                            ? structuredEditor
                                ? {
                                      ...conflict.candidate,
                                      content: structuredEditor.read(),
                                      ...(relationshipEditor
                                          ? {
                                                relationships:
                                                    relationshipEditor.relationships(),
                                            }
                                          : {}),
                                  }
                                : JSON.parse(combined!.value)
                            : undefined;
                    const saved = await invokeMemory(
                        "memoryResolveViewConflict",
                        {
                            corpusId: conflict.corpusId,
                            conflictId: conflict.conflictId,
                            expectedHead: latest.head!,
                            expectedVersion: current.version,
                            expectedRevisionId: current.revisionId,
                            inputFingerprint: conflict.input.fingerprint,
                            choice: selected,
                            ...(output === undefined
                                ? {}
                                : { combined: output }),
                        },
                    );
                    dirty = false;
                    comparison.replaceChildren();
                    await refresh();
                    await changed();
                    if (
                        !disposed &&
                        (!options.scope() ||
                            options.scope() === conflict.corpusId)
                    )
                        status.textContent = `Conflict resolved explicitly; saved draft version ${saved.version.version}. No publication or human review is granted.`;
                });
            }),
        );
    }

    function discardChanges(): boolean {
        if (
            (dirty || builderDirty) &&
            !confirm("Discard unsaved view changes?")
        )
            return false;
        dirty = false;
        builderDirty = false;
        options.onChange?.();
        return true;
    }
    return {
        refresh: () => action(refresh),
        discardChanges,
        showView,
        hide: () => {
            visible = false;
            sequence++;
            if (timer) clearTimeout(timer);
            root.hidden = true;
            for (const dialog of root.querySelectorAll("dialog"))
                dialog.remove();
            builder = undefined;
            builderDirty = false;
        },
        show: async (
            value: {
                corpusId?: string;
                viewId?: string;
                revisionId?: string;
                pageId?: string;
                itemKey?: string;
            } = {},
        ) => {
            if (!discardChanges()) return;
            visible = true;
            root.hidden = false;
            if (value.corpusId && value.viewId) {
                await loadDetail({
                    corpusId: value.corpusId,
                    viewId: value.viewId,
                    revisionId: value.revisionId,
                    pageId: value.pageId,
                    itemKey: value.itemKey,
                });
                return;
            }
            pager.reset();
            sequence++;
            visible = true;
            root.hidden = !visible;
            route =
                value.corpusId && value.viewId
                    ? {
                          corpusId: value.corpusId,
                          viewId: value.viewId,
                          revisionId: value.revisionId,
                          pageId: value.pageId,
                          itemKey: value.itemKey,
                      }
                    : undefined;
            if (busy) refreshPending = true;
            else await action(refresh);
            if (!buildsSupported) return;
            if (!route) {
                comparison.replaceChildren();
                drafts.hidden = controls.hidden = false;
            }
        },
        setRoute: async (value?: {
            corpusId: string;
            viewId: string;
            revisionId?: string;
            pageId?: string;
            itemKey?: string;
        }) => {
            if (!discardChanges()) return;
            sequence++;
            route = value;
            if (value) {
                await loadDetail(value);
            } else {
                comparison.replaceChildren();
                drafts.hidden = controls.hidden = false;
            }
        },
        buildFromSources: (
            corpusId?: string,
            sources?: Array<string | { sourceId: string; revisionId: string }>,
        ) =>
            action(async () => {
                exactInitialSources = new Map(
                    (sources ?? []).flatMap((source) =>
                        typeof source === "string"
                            ? []
                            : [[source.sourceId, source.revisionId]],
                    ),
                );
                await openBuilder(
                    corpusId,
                    sources?.map((source) =>
                        typeof source === "string" ? source : source.sourceId,
                    ),
                );
            }),
        scopeChanged() {
            if (disposed) return;
            sequence++;
            pager.reset();
            clearTimeout(searchTimer);
            snapshot = { head: null, views: [] };
            builder?.element.remove();
            builder = undefined;
            activeCorpus = undefined;
            route = undefined;
            drafts.hidden = controls.hidden = false;
            if (timer) clearTimeout(timer);
            controls.replaceChildren();
            drafts.replaceChildren();
            receipt.replaceChildren();
            comparison.replaceChildren();
            root.hidden = !visible;
            if (busy) refreshPending = true;
            else void action(refresh);
        },
        dispose() {
            disposed = true;
            refreshPending = false;
            sequence++;
            if (timer) clearTimeout(timer);
            window.removeEventListener("beforeunload", beforeUnload);
            root.remove();
        },
    };
}
