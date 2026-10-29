// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hubNotifications } from "./memoryHubNotifications";
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
import {
    icon,
    menuButton,
    setIconButton,
    setTabLabel,
    type MenuItem,
} from "./memoryHubUi";
import { mountFlyout } from "./memoryHubFlyout";
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

function articleCompleteness(content: DerivedViewContent): HTMLElement[] {
    if (
        (content.kind !== "wiki" && content.kind !== "projectBrief") ||
        !content.status
    )
        return [];
    return [
        rbChip(
            `Completeness: ${content.status}`,
            content.status === "sufficient" ? "good" : "warn",
        ),
    ];
}

function appendArticleCoverage(
    article: HTMLElement,
    content: DerivedViewContent,
): void {
    if (
        (content.kind === "wiki" || content.kind === "projectBrief") &&
        content.coverageNote
    )
        article.append(
            rbNode("p", `Coverage: ${content.coverageNote}`, "hub-view-note"),
        );
}

function appendArticleIntroduction(
    article: HTMLElement,
    view: ViewVersion,
    meta: HTMLElement,
): HTMLElement {
    const hasInfobox =
        view.content.kind === "wiki" || view.content.kind === "projectBrief";
    const overviewLabel =
        view.content.kind === "projectBrief"
            ? "About this brief"
            : "About this article";
    const flow = hasInfobox
        ? rbNode("div", undefined, "hub-view-reading-flow")
        : article;
    const overview = hasInfobox
        ? rbNode("aside", undefined, "hub-view-infobox")
        : article;
    if (hasInfobox) {
        overview.setAttribute("aria-label", overviewLabel);
        overview.append(
            rbNode("h3", view.content.summary ? "Synopsis" : overviewLabel),
            rbNode(
                "p",
                view.content.kind === "projectBrief"
                    ? "Brief overview"
                    : "Article overview",
                "hub-view-infobox-label",
            ),
        );
    } else {
        overview.append(meta);
        appendArticleCoverage(overview, view.content);
    }
    if (view.content.summary) {
        const lead = rbMarkdown(view.content.summary);
        lead.classList.add("hub-view-lead");
        overview.append(lead);
    }
    if (hasInfobox) {
        appendArticleCoverage(overview, view.content);
        overview.append(meta);
        flow.append(overview);
        article.append(flow);
    }
    return flow;
}

const viewKindLabels: Record<ViewKind, string> = {
    wiki: "Knowledge wiki",
    timeline: "Evidence-linked timeline",
    projectBrief: "Project brief",
    troubleshootingGuide: "Troubleshooting guide",
    schemaView: "Schema-defined questions",
};

const viewKindIcons: Record<ViewKind, string> = {
    wiki: "fa-book-open",
    timeline: "fa-timeline",
    projectBrief: "fa-diagram-project",
    troubleshootingGuide: "fa-screwdriver-wrench",
    schemaView: "fa-table-list",
};

const viewTypeTabs: { kind?: ViewKind; label: string }[] = [
    { label: "All" },
    { kind: "wiki", label: "Knowledge Wiki" },
    { kind: "projectBrief", label: "Project Brief" },
    { kind: "timeline", label: "Timeline" },
    { kind: "troubleshootingGuide", label: "Troubleshooting Guide" },
];

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

function viewLoadingStatus(label: string): HTMLParagraphElement {
    const status = rbNode("p", label, "hub-view-loading");
    status.setAttribute("role", "status");
    status.prepend(
        icon("fa-solid fa-spinner fa-spin"),
        document.createTextNode(" "),
    );
    return status;
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
    const total = rbNode("span", "Loading...", "hub-list-total");
    const loading = viewLoadingStatus("Loading views...");
    loading.hidden = true;
    const listLoading = viewLoadingStatus("Loading views...");
    listLoading.classList.add("hub-view-list-loading");
    listLoading.hidden = true;
    const controls = rbNode("div", undefined, "hub-view-controls");
    const receipt = rbNode("div", undefined, "hub-view-build-receipt");
    let flyout: ReturnType<typeof mountFlyout> | undefined;
    let latestJob:
        | Pick<ViewBuildJob, "corpusId" | "state" | "jobId">
        | undefined;
    const latestBuild = rbIconButton("fa-bell", "Latest build", () =>
        openLatestBuild(),
    );
    latestBuild.hidden = true;
    const drafts = rbNode("div");
    const comparison = rbNode("div");
    root.append(loading, status, drafts, comparison);
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
    const pendingConflicts = new Map<string, string>();
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let busy = false;
    let refreshPending = false;
    type InventoryState = "loading" | "ready" | "error";
    let inventoryState: InventoryState = "ready";
    let inventoryElements:
        | { card: HTMLElement; list: HTMLElement; pager: HTMLElement }
        | undefined;
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

    function setInventoryState(state: InventoryState): void {
        inventoryState = state;
        listLoading.hidden = state !== "loading";
        if (!inventoryElements) return;
        inventoryElements.card.setAttribute(
            "aria-busy",
            String(state === "loading"),
        );
        inventoryElements.list.hidden = state !== "ready";
        inventoryElements.pager.hidden = state !== "ready";
    }

    async function refresh(): Promise<void> {
        const current = ++sequence;
        loading.hidden = !!(
            inventoryElements &&
            drafts.contains(inventoryElements.card) &&
            !drafts.hidden
        );
        setInventoryState("loading");
        status.textContent = "";
        total.textContent = "Loading...";
        try {
            await refreshInventory(current);
            if (current === sequence) setInventoryState("ready");
        } catch (error) {
            if (current === sequence) {
                total.textContent = "Unavailable";
                setInventoryState("error");
            }
            throw error;
        } finally {
            if (current === sequence) loading.hidden = true;
        }
    }

    async function refreshInventory(current: number): Promise<void> {
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
            clearReceipt();
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
                              excludeKinds: ["schemaView"],
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
                ? [
                      menuButton(
                          "Maintain collection",
                          maintenance,
                          "fa-screwdriver-wrench",
                      ),
                  ]
                : []),
            latestBuild,
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
        hubNotifications.set("views", {
            title: "Views",
            page: "views",
            context: corpusId
                ? (corpusNames.get(corpusId) ?? corpusId)
                : "All memory",
            messages: familyStatus,
        });
        renderDrafts();
        if (jobs[0]) setLatest(jobs[0]);
        else clearReceipt();

        function wikiStatusDescription(
            corpusId: string,
            family: ViewSnapshot["wikiFamily"],
            label = "Wiki",
        ): string[] {
            if (!family?.error) return [];
            return [
                `${corpusNames.get(corpusId) ?? corpusId}: ${label} retry needed: ${family.error}.`,
            ];
        }

        // Family-wide maintenance lives in one menu rather than eight page
        // buttons that multiply with every family.
        function collectionWikiControls(capabilities: {
            derivedViews?: { informationalWiki?: true };
        }): MenuItem[] {
            if (!capabilities.derivedViews?.informationalWiki) return [];
            return (["wiki", "projects"] as const).flatMap((family) =>
                (["update", "rebuild", "pause", "resume"] as const).map(
                    (operation): MenuItem => ({
                        label: `${operation[0].toUpperCase()}${operation.slice(1)} ${family === "wiki" ? "Wiki" : "Projects"}`,
                        icon: "fa-screwdriver-wrench",
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
                                if (result.job) showReceipt(result.job);
                                await refresh();
                            });
                        },
                    }),
                ),
            );
        }
        if (route && !dirty) await renderRoute(route, current);
    }

    async function loadPendingConflicts(
        jobs: ViewBuildSummary[],
        current: number,
    ): Promise<void> {
        const references = new Map<
            string,
            {
                corpusId: string;
                conflictId: string;
                state: ViewBuildSummary["results"][number]["conflictState"];
            }
        >();
        const seen = new Set<string>();
        const ordered = [...jobs].sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
        );
        for (const job of ordered)
            for (const result of job.results) {
                const key = publicationKey(job.corpusId, result.viewId);
                if (result.conflictId && !seen.has(key)) {
                    seen.add(key);
                    if (result.conflictState === "resolved") continue;
                    references.set(key, {
                        corpusId: job.corpusId,
                        conflictId: result.conflictId,
                        state: result.conflictState,
                    });
                }
            }
        const conflicts = await Promise.all(
            [...references].map(async ([key, input]) => {
                if (input.state === "pending")
                    return { key, conflictId: input.conflictId };
                const conflict = await invokeMemory("memoryGetViewConflict", {
                    corpusId: input.corpusId,
                    conflictId: input.conflictId,
                });
                if (!conflict)
                    throw new Error(
                        "A conflict referenced by a build receipt is unavailable; refresh Activity or inspect view history",
                    );
                return {
                    key,
                    conflictId:
                        conflict.state === "pending"
                            ? conflict.conflictId
                            : undefined,
                };
            }),
        );
        if (disposed || current !== sequence) return;
        pendingConflicts.clear();
        for (const { key, conflictId } of conflicts)
            if (conflictId) pendingConflicts.set(key, conflictId);
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
                    rbIconButton("fa-arrow-left", "Back to views", backToViews),
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
            rbIconButton("fa-arrow-left", "Back to views", backToViews),
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
        loading.hidden = true;
        drafts.hidden = controls.hidden = true;
        comparison.setAttribute("aria-busy", "true");
        comparison.replaceChildren(
            rbIconButton("fa-arrow-left", "Back to views", backToViews),
            viewLoadingStatus("Loading view details..."),
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
                comparison.querySelector(".hub-view-loading")?.remove();
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
        loading.hidden = false;
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
                                showReceipt(job);
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

    function setLatest(
        job: Pick<ViewBuildJob, "corpusId" | "state" | "jobId">,
    ) {
        hubNotifications.set("view-build", {
            title: "View builds",
            page: "activity",
            context: corpusNames.get(job.corpusId) ?? job.corpusId,
            severity: ["failed", "interrupted"].includes(job.state)
                ? "warning"
                : "info",
            messages: [`Build ${job.jobId}: ${job.state}`],
        });
        latestJob = job;
        latestBuild.hidden = false;
        setIconButton(
            latestBuild,
            job.state === "running"
                ? "fa-solid fa-circle-notch fa-spin"
                : "fa-bell",
            `Latest build: ${job.state}`,
        );
        latestBuild.classList.toggle(
            "danger",
            ["failed", "interrupted"].includes(job.state),
        );
    }
    function clearReceipt() {
        hubNotifications.clear("view-build");
        latestJob = undefined;
        latestBuild.hidden = true;
        receipt.replaceChildren();
        flyout?.close();
    }
    function openReceipt() {
        flyout ??= mountFlyout(host, "Build details");
        flyout.open({
            title: "Latest build",
            render: (body) => {
                body.append(receipt);
            },
        });
    }
    function showReceipt(job: ViewBuildJob) {
        renderReceipt(job);
        openReceipt();
    }
    function openLatestBuild() {
        const job = latestJob;
        if (!job) return;
        void action(async () => {
            const full = await invokeMemory("memoryGetViewBuild", {
                corpusId: job.corpusId,
                jobId: job.jobId,
            });
            if (!full) throw new Error("The selected build is unavailable.");
            showReceipt(full);
        });
    }
    function renderReceipt(job: ViewBuildJob): void {
        if (options.scope() && job.corpusId !== options.scope()) return;
        if (timer) clearTimeout(timer);
        setLatest(job);
        receipt.replaceChildren(
            rbNode("p", `Build ${job.jobId}: ${job.state}`, "hub-muted"),
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
            const block = rbNode("section", undefined, "hub-result");
            const blockHead = rbNode("div", undefined, "hub-row-actions");
            const blockTitle = rbNode("span", result.viewId, "hub-grow");
            blockTitle.title = result.viewId;
            blockHead.append(
                rbChip(
                    result.state,
                    ["blocked", "failed"].includes(result.state)
                        ? "bad"
                        : [
                                "draft",
                                "merged",
                                "published",
                                "searchable",
                            ].includes(result.state)
                          ? "good"
                          : undefined,
                ),
                blockTitle,
            );
            block.append(blockHead);
            const effective = result.snapshot.publicationPolicy;
            if (effective)
                block.append(
                    rbNode(
                        "p",
                        `Auto-publish: ${effective.autoPublish ? "On" : "Off"} (${effective.origin}); corpus policy revision ${effective.corpusRevision}, view policy revision ${effective.viewRevision}`,
                    ),
                );
            if (result.snapshot.definition?.kind === "timeline")
                block.append(
                    rbNode(
                        "p",
                        `Timeline checkpoint: learned through ${result.snapshot.bounds.learnedBefore ?? "unbounded"}; occurrence ${result.snapshot.bounds.occurredFrom ?? "unbounded"} to ${result.snapshot.bounds.occurredTo ?? "unbounded"} (inclusive). Record knowledge, not file import time, determines eligibility. Unknown required times are excluded. Canonical event authority is evidence, not permission.`,
                    ),
                );
            if (result.publication)
                block.append(
                    rbNode(
                        "p",
                        `Published ${result.publication.publishedRevisionId}; indexed ${result.publication.indexedRevisionId ?? "not ready"}: ${result.publication.reason}`,
                    ),
                );
            block.append(rbNode("p", result.reason));
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
            block.append(exact);
            if (
                ["draft", "merged", "published", "searchable"].includes(
                    result.state,
                )
            )
                block.append(
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
                block.append(details);
            }
            if (result.missingEvidence?.length)
                block.append(
                    rbNode(
                        "p",
                        `Missing evidence: ${result.missingEvidence.join("; ")}`,
                    ),
                );
            if (result.conflictId)
                block.append(
                    rbButton("Compare and resolve conflict", () => {
                        void action(() =>
                            showConflict(job.corpusId, result.conflictId!),
                        );
                    }),
                );
            receipt.append(block);
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
        const previousTabs = drafts.querySelector<HTMLElement>(".hub-tabs");
        const restoreTabFocus = previousTabs?.contains(document.activeElement);
        const tabScroll = previousTabs?.scrollLeft ?? 0;
        const search = document.createElement("input");
        search.type = "search";
        search.setAttribute("aria-label", "Find views");
        search.placeholder = "Find views";
        search.value = searchQuery;
        const kinds = rbNode("div", undefined, "hub-tabs");
        kinds.setAttribute("role", "group");
        kinds.setAttribute("aria-label", "Filter view type");
        for (const { kind: value, label } of viewTypeTabs) {
            if (value && !supportedKinds.includes(value)) continue;
            const tab = setTabLabel(
                rbButton(label, () => {
                    selectedKind = value;
                    for (const other of kinds.querySelectorAll("button"))
                        other.setAttribute(
                            "aria-pressed",
                            String(other === tab),
                        );
                    render();
                    reload();
                }),
                value ? viewKindIcons[value] : "fa-layer-group",
                label,
            );
            tab.setAttribute("aria-pressed", String(value === selectedKind));
            kinds.append(tab);
        }
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
                    (!selectedKind || view.content.kind === selectedKind) &&
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
                const open = () => {
                    void showView(view.corpusId, view.viewId);
                };
                const heading = rbNode("h3", undefined, "hub-view-card-title");
                heading.append(rbButton(view.content.title, open));
                card.append(heading, viewStatusChips(view, publication));
                if (!options.scope())
                    card.append(
                        rbNode(
                            "p",
                            `Collection: ${corpusNames.get(view.corpusId) ?? "Collection name unavailable"}`,
                            "hub-muted",
                        ),
                    );
                card.addEventListener("click", (event) => {
                    if (!(event.target instanceof HTMLButtonElement)) open();
                });
                list.append(card);
            }
        };
        const reload = () => {
            pager.reset();
            if (busy) {
                sequence++;
                refreshPending = true;
                setInventoryState("loading");
                total.textContent = "Loading...";
                return;
            }
            void action(refresh);
        };
        search.oninput = () => {
            searchQuery = search.value;
            render();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(reload, 250);
        };
        const toolbar = rbNode("div", undefined, "hub-view-toolbar");
        toolbar.append(
            search,
            rbNode("span", undefined, "hub-spacer"),
            controls,
        );
        const card = rbNode("section", undefined, "card hub-list-card");
        card.setAttribute("aria-label", "Views list");
        const cardHead = rbNode("div", undefined, "section-heading");
        total.textContent = `${pager.total} total`;
        total.title = `Showing ${inventory.length} loaded views.`;
        cardHead.append(rbNode("h2", "Views"), total);
        card.append(cardHead);
        const pagination = pager.controls("views", () => {
            void action(refresh);
        });
        card.append(toolbar, listLoading, list, pagination);
        inventoryElements = { card, list, pager: pagination };
        setInventoryState(inventoryState);
        drafts.replaceChildren(kinds, card);
        kinds.scrollLeft = tabScroll;
        if (restoreTabFocus)
            kinds
                .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
                ?.focus({ preventScroll: true });
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
        more: MenuItem[],
    ): void {
        if (view.relatedArticles?.length) {
            const related = rbNode("nav", undefined, "hub-related");
            related.setAttribute("aria-label", "Related articles");
            const relatedList = rbNode("ul");
            for (const entry of view.relatedArticles) {
                const item = rbNode("li");
                item.append(
                    rbButton(entry.title, () => {
                        void action(() =>
                            showView(view.corpusId, entry.viewId),
                        );
                    }),
                );
                relatedList.append(item);
            }
            related.append(rbNode("h3", "Related articles"), relatedList);
            article.append(related);
        }
        const protectedTargets = view.protectedTargets ?? [];
        if (
            !view.generation ||
            !(view.content.kind === "wiki" || view.definition.projectSummary)
        )
            return;
        for (const target of protectedTargets)
            more.push({
                label: `Unlock generated updates: ${target}`,
                icon: "fa-lock-open",
                action: () => {
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
                },
            });
    }

    function citationKey(citation: ViewCitation) {
        return `${citation.sourceId}@${citation.revisionId}@${citation.locator}`;
    }
    function evidenceRow(view: ViewVersion, citation: ViewCitation) {
        const row = rbNode("div", undefined, "hub-row-actions");
        const label = rbNode("span", citation.sourceId, "hub-grow");
        label.title = `${citation.sourceId} @ ${citation.revisionId} · ${citation.locator}`;
        row.append(
            label,
            rbIconButton(
                "fa-arrow-up-right-from-square",
                `Open exact evidence ${citation.sourceId}`,
                () => showTimelineEvidence(view, citation),
            ),
        );
        return row;
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
        const meta = rbNode("div", undefined, "hub-view-meta");
        const metaChips = rbNode("div", undefined, "hub-chips");
        metaChips.append(
            rbChip(viewKindLabels[view.content.kind]),
            rbChip(`Version ${view.version}`),
            ...articleCompleteness(view.content),
        );
        meta.append(metaChips, ...viewRevisionTime(view.createdAt));
        article.append(title);
        const readingFlow = appendArticleIntroduction(article, view, meta);
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
        if (
            view.content.kind === "wiki" &&
            (view.content.sections.length > 1 ||
                view.content.sections[0]?.heading !== view.content.title)
        ) {
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
            readingFlow.append(contents);
        }
        for (const section of view.content.sections) {
            const page = rbNode("section", undefined, "hub-view-section");
            page.tabIndex = -1;
            page.dataset.page = section.id;
            if (
                view.content.sections.length > 1 ||
                section.heading !== view.content.title
            )
                page.append(rbNode("h3", section.heading));
            page.append(rbMarkdown(section.body));
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
            const listed = new Set(view.content.citations.map(citationKey));
            const extra = view.relationships
                .flatMap((edge) =>
                    edge.origin === "system" ||
                    edge.from.sectionId !== section.id
                        ? []
                        : edge.citations,
                )
                .filter((citation) => !listed.has(citationKey(citation)));
            if (extra.length) {
                const evidence = rbNode("details");
                evidence.append(
                    rbNode("summary", `Evidence (${extra.length})`),
                    ...extra.map((citation) => evidenceRow(view, citation)),
                );
                page.append(evidence);
            }
            readingFlow.append(page);
        }
        if (view.content.citations.length) {
            const citations = rbNode("details");
            citations.append(
                rbNode("summary", `Sources (${view.content.citations.length})`),
                ...view.content.citations.map((citation) =>
                    evidenceRow(view, citation),
                ),
            );
            article.append(citations);
        }
        const actions = rbNode("div", undefined, "hub-view-actions");
        const back = rbIconButton(
            "fa-arrow-left",
            "Back to views",
            backToViews,
        );
        actions.append(
            back,
            rbNode("p", "Checking publication and conflicts..."),
        );
        comparison.replaceChildren(actions, article);
        title.focus();
        function enableActions() {
            actions.replaceChildren();
            const more: MenuItem[] = [];
            appendEditorialControls(view, article, more);
            const pendingConflict = pendingConflicts.get(
                publicationKey(view.corpusId, view.viewId),
            );
            if (pendingConflict)
                more.push({
                    label: "Review pending conflict",
                    icon: "fa-code-compare",
                    action: () => {
                        void action(() =>
                            showConflict(view.corpusId, pendingConflict),
                        );
                    },
                });
            const editButton = rbIconButton("fa-pen", "Edit", () =>
                showEditor(view),
            );
            editButton.classList.add("primary");
            actions.append(
                back,
                rbNode("span", undefined, "hub-spacer"),
                editButton,
            );
            more.push(
                {
                    label: "Rebuild from evidence",
                    icon: "fa-arrows-rotate",
                    action: () => {
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
                    },
                },
                {
                    label: "Publication and search",
                    icon: "fa-magnifying-glass",
                    action: () => {
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
                    },
                },
                {
                    label: "History",
                    icon: "fa-clock-rotate-left",
                    action: () => {
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
                                        viewContentToText(
                                            entry.version.content,
                                        ),
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
                    },
                },
            );
            if (
                maintenanceSupported &&
                view.state !== "archived" &&
                !view.definition.wiki
            )
                more.push({
                    label: "Update view",
                    icon: "fa-screwdriver-wrench",
                    action: () => {
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
                                    showReceipt(job);
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
                    },
                });
            actions.append(menuButton("More actions", more));
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
            loading.hidden = true;
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
            comparison.replaceChildren();
            drafts.hidden = controls.hidden = false;
            loading.hidden = false;
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
            hubNotifications.clear("views");
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
            clearReceipt();
            comparison.replaceChildren();
            root.hidden = !visible;
            loading.hidden = !visible;
            if (busy) refreshPending = true;
            else void action(refresh);
        },
        dispose() {
            disposed = true;
            refreshPending = false;
            sequence++;
            if (timer) clearTimeout(timer);
            window.removeEventListener("beforeunload", beforeUnload);
            flyout?.dispose();
            root.remove();
        },
    };
}
