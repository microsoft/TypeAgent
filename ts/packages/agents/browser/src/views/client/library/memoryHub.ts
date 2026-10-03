// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryCenterJob,
    MemoryCenterSource,
} from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    MemoryHubInboxItem,
    MemoryHubSnapshot,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView, invokeMemory } from "./viewClient";
import { mountMemoryManagement } from "./memoryManagement";
import { mountMemoryHubSearch } from "./memoryHubSearch";
import { mountMemoryHubExplore } from "./memoryHubExplore";
import { mountMemoryHubChanges } from "./memoryHubChanges";
import { mountMemoryHubImports } from "./memoryHubImports";
import { mountMemoryHubCapture } from "./memoryHubCapture";
import { mountMemoryHubRunbooks } from "./memoryHubRunbooks";
import { mountMemoryHubPreferences } from "./memoryHubPreferences";
import { mountMemoryHubRunbookImports } from "./memoryHubRunbookImports";
import { mountMemoryHubWebMaintenance } from "./memoryHubWebMaintenance";
import { mountMemoryHubViewPreferences } from "./memoryHubViewPreferences";
import { mountMemoryHubWebExplore } from "./memoryHubWebExplore";
import { notificationManager } from "./knowledgeUtilities";
import { migrateLegacyMemoryLocation } from "./memoryHubMigration";
import {
    inboxCounts,
    inboxItems,
    pages,
    parseRoute,
    readHidden,
    routeHash,
    type HubRoute,
} from "./memoryHubModel";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Memory element '${id}' is missing`);
    return value as T;
}

const SCOPE_KEY = "memoryHub.corpus";
const HIDE_KEY = "memoryHub.hidden";
const INSPECTOR_KEY = "memoryHub.inspector";
let scope = localStorage.getItem(SCOPE_KEY) ?? "";
const hidden = readHidden(localStorage.getItem(HIDE_KEY));
let snapshot: MemoryHubSnapshot = {
    corpora: [],
    inbox: [],
    procedures: [],
    errors: [],
};
let snapshotVersion = 0;
let snapshotAvailable = false;
let jobsCountAvailable = true;
let routeVersion = 0;
let inboxPage = 0;
let lastHash = location.hash || "#/inbox";
let reverting = false;
let focusReturn: { corpusId: string; sourceId: string } | undefined;
let manager: ReturnType<typeof mountMemoryManagement>;
let searchPanel: ReturnType<typeof mountMemoryHubSearch>;
let explorePanel: ReturnType<typeof mountMemoryHubExplore>;
let changesPanel: ReturnType<typeof mountMemoryHubChanges>;
let importsPanel: ReturnType<typeof mountMemoryHubImports>;
let capturePanel: ReturnType<typeof mountMemoryHubCapture>;
let runbooksPanel: ReturnType<typeof mountMemoryHubRunbooks>;
let preferencesPanel: ReturnType<typeof mountMemoryHubPreferences>;
let runbookImportsPanel: ReturnType<typeof mountMemoryHubRunbookImports>;
let webMaintenancePanel: ReturnType<typeof mountMemoryHubWebMaintenance>;
let viewPreferencesPanel: ReturnType<typeof mountMemoryHubViewPreferences>;
let webExplorePanel: ReturnType<typeof mountMemoryHubWebExplore>;
let pendingSearchQuery: string | undefined;

function invalidateDiscovery(): void {
    searchPanel.scopeChanged();
    explorePanel.scopeChanged();
}

function namedScopeAvailable(): boolean {
    return (
        !!scope &&
        snapshotAvailable &&
        snapshot.corpora.some((corpus) => corpus.corpusId === scope)
    );
}

function discardChanges(): boolean {
    return (
        manager.discardChanges() &&
        (runbooksPanel?.discardChanges() ?? true) &&
        (preferencesPanel?.discardChanges() ?? true) &&
        (viewPreferencesPanel?.discardChanges() ?? true) &&
        (runbookImportsPanel?.discardChanges() ?? true)
    );
}

function mountRunbookImports(): void {
    runbookImportsPanel = mountMemoryHubRunbookImports(
        el("hubRunbookImportHost"),
        {
            scope: () => scope || undefined,
            activityHost: el("hubRunbookActivity"),
            onError: (error) => {
                void hubAction(async () => {
                    throw error;
                });
            },
            onChanged: async () => {
                invalidateDiscovery();
                await refreshSnapshot();
            },
            onOpenRunbook: (corpusId, objectId) => {
                open({
                    page: "runbooks",
                    corpusId,
                    objectId,
                    runbookKind: "candidate",
                });
            },
        },
    );
    for (const [id, kind] of [
        ["addRunbookFolder", "folder"],
        ["addRunbookWiki", "wiki"],
        ["addRunbookUrls", "urls"],
    ] as const) {
        el(id).addEventListener("click", () => {
            if (!discardChanges()) return;
            el<HTMLDialogElement>("hubAddDialog").close();
            runbookImportsPanel.open(kind);
        });
    }
}

function mountRunbooks(): void {
    runbooksPanel = mountMemoryHubRunbooks(el("hubRunbooks"), {
        scope: () => scope || undefined,
        onError: (error) => {
            void hubAction(async () => {
                throw error;
            });
        },
        onChanged: async () => {
            invalidateDiscovery();
            await refreshSnapshot();
        },
        onOpenSource: (corpusId, objectId) => {
            open({ page: "library", corpusId, objectId });
        },
        onRouteChanged: (request) => {
            const current = parseRoute(location.hash);
            const inboxItem =
                current.page === "inbox"
                    ? snapshot.inbox.find(
                          (item) => item.id === current.objectId,
                      )
                    : undefined;
            if (
                request?.kind === "candidate" &&
                inboxItem?.kind === "candidate" &&
                inboxItem.corpusId === request.corpusId &&
                inboxItem.objectId === request.objectId
            )
                return;
            if (current.page !== "runbooks" && !inboxItem) return;
            const route: HubRoute = request
                ? {
                      page: "runbooks",
                      corpusId: request.corpusId,
                      objectId: request.objectId,
                      runbookKind: request.kind,
                      ...(request.version === undefined
                          ? {}
                          : { procedureVersion: request.version }),
                      ...(request.skillRevisionId === undefined
                          ? {}
                          : { skillRevisionId: request.skillRevisionId }),
                  }
                : { page: "runbooks" };
            const hash = routeHash(route);
            if (hash !== location.hash) {
                history.pushState(history.state, "", hash);
                lastHash = hash;
            }
        },
    });
    preferencesPanel = mountMemoryHubPreferences(el("hubSettings"), {
        scope: () => scope || undefined,
        onError: (error) => {
            void hubAction(async () => {
                throw error;
            });
        },
        onChanged: async () => {
            await refreshSnapshot();
        },
    });
}

function synchronizeQuery(query: string): void {
    el<HTMLInputElement>("hubAsk").value = query;
    localStorage.setItem("memoryHub.ask", query);
    const url = new URL(location.href);
    url.searchParams.set("query", query);
    history.replaceState(history.state, "", url);
}

function mountPhaseTwo(): void {
    const onError = (error: unknown) => {
        void hubAction(async () => {
            throw error;
        });
    };
    const selectedScope = () => scope || undefined;
    const onOpenSource = (corpusId: string, objectId: string) => {
        open({ page: "library", corpusId, objectId });
    };
    searchPanel = mountMemoryHubSearch(el("hubSearch"), {
        scope: selectedScope,
        onOpenSource,
        onError,
        onOpenProcedure: (corpusId, objectId) => {
            open({ page: "runbooks", corpusId, objectId });
        },
        onQueryChanged: synchronizeQuery,
        onNotify: (message) => notificationManager.showInfo(message),
    });
    explorePanel = mountMemoryHubExplore(el("hubExplore"), {
        scope: selectedScope,
        onOpenSource,
        onError,
    });
    changesPanel = mountMemoryHubChanges(el("hubChanges"), {
        scope: selectedScope,
        onError,
    });
    importsPanel = mountMemoryHubImports(el("hubImportHost"), {
        targetLabel: "TypeAgent Browser Memory (fixed)",
        scope: selectedScope,
        onError,
        onOpenJobs: () => {
            void hubAction(async () => {
                if (!discardChanges()) return;
                const corpus = snapshot.corpora.find(
                    (item) => item.name === "TypeAgent Browser Memory",
                );
                if (!corpus)
                    throw new Error(
                        "Browser corpus is unavailable. Import a source, then refresh before opening its jobs.",
                    );
                const selector = el<HTMLSelectElement>("hubCorpus");
                selector.value = corpus.corpusId;
                selector.dispatchEvent(new Event("change"));
                open({ page: "activity" });
            });
        },
        onComplete: async () => {
            invalidateDiscovery();
            await refreshSnapshot();
            await applyRoute();
        },
    });
    capturePanel = mountMemoryHubCapture(el("hubCaptureHost"), {
        onError,
        onComplete: async (result) => {
            invalidateDiscovery();
            await refreshSnapshot();
            open({
                page: "library",
                corpusId: result.corpusId,
                objectId: result.sourceId,
            });
            if (result.warnings.length) {
                el("hubDegraded").textContent =
                    `Capture completed with warnings:\n${result.warnings.join("\n")}`;
                el("hubDegraded").classList.remove("hidden");
            }
        },
    });
    for (const [id, launch] of [
        ["addBrowser", () => importsPanel.openBrowserImport()],
        ["addFolder", () => importsPanel.openFolderImport()],
        ["addPdf", () => void importsPanel.openPdfImport()],
    ] as const) {
        el(id).addEventListener("click", () => {
            if (!discardChanges()) return;
            el<HTMLDialogElement>("hubAddDialog").close();
            launch();
        });
    }
    el("addCapture").addEventListener("click", () => {
        if (!discardChanges()) return;
        el<HTMLDialogElement>("hubAddDialog").close();
        capturePanel.open();
    });
}

function button(label: string, action: () => void): HTMLButtonElement {
    const result = document.createElement("button");
    result.type = "button";
    result.textContent = label;
    result.addEventListener("click", action);
    return result;
}

export async function hubAction(action: () => Promise<void>): Promise<void> {
    el("hubError").classList.add("hidden");
    try {
        await action();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Superseded request") return;
        el("hubError").textContent = `Operation failed: ${message}`;
        el("hubError").classList.remove("hidden");
        el("hubStatus").textContent =
            /unavailable|offline|disconnected|fetch/i.test(message)
                ? "Offline"
                : "Connected · operation failed";
    }
}

function persistHidden(): void {
    localStorage.setItem(HIDE_KEY, JSON.stringify(hidden));
    renderInbox();
}

function open(route: HubRoute): boolean {
    if (document.querySelector("dialog[open]")) return false;
    if (!discardChanges()) return false;
    if (route.page === "library" && route.objectId) {
        history.replaceState(
            { ...history.state, memoryReturn: location.hash || "#/library" },
            "",
        );
    }
    location.hash = routeHash(route);
    return true;
}

function inboxAction(item: MemoryHubInboxItem): void {
    if (item.kind === "runbookWarning" && item.sourceId) {
        open({
            page: "library",
            corpusId: item.corpusId,
            objectId: item.sourceId,
        });
    } else if (item.kind === "job") {
        open({
            page: "activity",
            corpusId: item.corpusId,
            objectId: item.objectId,
        });
    } else {
        open({ page: "inbox", objectId: item.id });
    }
}

function inboxCard(item: MemoryHubInboxItem, dismissed: boolean): HTMLElement {
    const card = document.createElement("article");
    card.className = "inbox-card";
    const heading = document.createElement("h3");
    heading.textContent = item.title;
    const reason = document.createElement("p");
    reason.textContent = `${item.corpusName} · ${item.kind} · ${item.reason} · ${new Date(item.updatedAt).toLocaleString()}`;
    const ids = document.createElement("small");
    ids.className = "inspector-detail";
    ids.textContent = `${item.id} · ${item.fingerprint}`;
    const actions = document.createElement("div");
    actions.className = "hub-controls";
    actions.append(
        button(item.kind === "job" ? "Open job" : "Review", () =>
            inboxAction(item),
        ),
    );
    if (dismissed) {
        actions.append(
            button("Restore", () => {
                delete hidden[item.id];
                persistHidden();
            }),
        );
    } else {
        if (item.kind === "candidate") {
            actions.append(
                button("Reject", () => {
                    void hubAction(async () => {
                        if (
                            !confirm(
                                `Reject "${item.title}" in ${item.corpusName}?`,
                            )
                        )
                            return;
                        await invokeMemory("memoryRejectProcedureCandidate", {
                            corpusId: item.corpusId,
                            candidateId: item.objectId,
                        });
                        await refreshSnapshot();
                    });
                }),
            );
        }
        actions.append(
            button("Dismiss", () => {
                hidden[item.id] = { fingerprint: item.fingerprint };
                persistHidden();
            }),
            button("Snooze 1 day", () => {
                hidden[item.id] = {
                    fingerprint: item.fingerprint,
                    until: Date.now() + 86_400_000,
                };
                persistHidden();
            }),
        );
    }
    card.append(heading, reason, ids, actions);
    return card;
}

function renderInbox(): void {
    const counts = inboxCounts(snapshot.inbox, hidden, scope || undefined);
    el("inboxBadge").textContent = snapshotAvailable
        ? String(counts.inbox)
        : "—";
    el("activityBadge").textContent =
        snapshotAvailable && jobsCountAvailable
            ? String(counts.failedJobs)
            : "?";
    const dismissed = el<HTMLInputElement>("inboxDismissed").checked;
    const available = inboxItems(snapshot.inbox, hidden, {
        corpusId: scope || undefined,
        dismissed,
    });
    for (const option of el<HTMLSelectElement>("inboxKind").options) {
        const label = {
            "": "All",
            candidate: "Discovered how-tos",
            staleProcedure: "Stale procedures",
            job: "Failed / partial jobs",
            skillDraft: "Skill drafts",
            bindingDrift: "Changed tool bindings",
            runbookWarning: "Runbook extraction warnings",
        }[option.value as "" | MemoryHubInboxItem["kind"]];
        option.textContent = `${label} (${available.filter((item) => !option.value || item.kind === option.value).length})`;
    }
    const items = inboxItems(snapshot.inbox, hidden, {
        corpusId: scope || undefined,
        kind: el<HTMLSelectElement>("inboxKind").value,
        group: el<HTMLSelectElement>("inboxGroup").value,
        dismissed,
    });
    inboxPage = Math.min(
        inboxPage,
        Math.max(0, Math.ceil(items.length / 25) - 1),
    );
    const list = el("hubInbox");
    list.replaceChildren(
        ...items
            .slice(inboxPage * 25, (inboxPage + 1) * 25)
            .map((item) => inboxCard(item, dismissed)),
    );
    if (!items.length) {
        const message = document.createElement("p");
        message.textContent =
            !snapshotAvailable || (scope && !namedScopeAvailable())
                ? "Inbox is unavailable for this scope. Refresh or choose another corpus."
                : snapshot.errors.length
                  ? "No matching items in available results. Some corpora could not be loaded."
                  : dismissed
                    ? "No dismissed or snoozed items."
                    : "Nothing needs your attention.";
        const actions = document.createElement("div");
        actions.className = "hub-controls";
        actions.append(
            button("Add to memory", () =>
                el<HTMLDialogElement>("hubAddDialog").showModal(),
            ),
            button("Ask", () => open({ page: "search" })),
            button("Open Runbooks", () => open({ page: "runbooks" })),
        );
        list.append(message, actions);
    }
    el("inboxPage").textContent =
        `Page ${inboxPage + 1} · ${items.length} items`;
    el<HTMLButtonElement>("inboxPrevious").disabled = inboxPage === 0;
    el<HTMLButtonElement>("inboxNext").disabled =
        (inboxPage + 1) * 25 >= items.length;
}

function renderErrors(): void {
    const banner = el("hubDegraded");
    const messages = snapshot.errors.map(
        (error) =>
            `${snapshot.corpora.find((corpus) => corpus.corpusId === error.corpusId)?.name ?? (error.corpusId === "*" ? "All memory" : error.corpusId)} · ${error.operation}: ${error.message}`,
    );
    if (scope && !namedScopeAvailable())
        messages.push(
            "Selected corpus is unavailable. Choose another scope; it has not been broadened to All memory.",
        );
    banner.classList.toggle("hidden", messages.length === 0);
    banner.textContent = messages.length
        ? "Degraded results (not an empty-success response):\n" +
          messages.join("\n")
        : "";
    el("hubStatus").textContent = messages.length ? "Degraded" : "Connected";
}

async function refreshSnapshot(): Promise<void> {
    const version = ++snapshotVersion;
    let result: MemoryHubSnapshot;
    try {
        result = await invokeView("memoryHubSnapshot", {});
    } catch (error) {
        if (version === snapshotVersion) {
            snapshotAvailable = false;
            renderInbox();
        }
        throw error;
    }
    if (version !== snapshotVersion) return;
    snapshot = result;
    snapshotAvailable = true;
    jobsCountAvailable = !snapshot.errors.some(
        (error) => error.operation === "jobs",
    );
    if (
        snapshot.inbox.some(
            (item) => item.kind === "job" && item.jobState === undefined,
        )
    ) {
        jobsCountAvailable = false;
        snapshot.errors.push({
            corpusId: "*",
            operation: "jobs",
            message:
                "Failed-job count unavailable: snapshot omitted job state.",
        });
    }
    const select = el<HTMLSelectElement>("hubCorpus");
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All memory";
    select.append(all);
    for (const corpus of snapshot.corpora) {
        const option = document.createElement("option");
        option.value = corpus.corpusId;
        option.textContent = corpus.name;
        select.append(option);
    }
    if (
        scope &&
        !snapshot.corpora.some((corpus) => corpus.corpusId === scope)
    ) {
        const unavailable = document.createElement("option");
        unavailable.value = scope;
        unavailable.textContent = "Selected corpus is unavailable";
        unavailable.disabled = true;
        select.append(unavailable);
    }
    select.value = scope;
    renderInbox();
    renderErrors();
}

function move(selector: string, destination: string): HTMLElement {
    const node = document.querySelector<HTMLElement>(
        `#managementTemplate ${selector}`,
    );
    if (!node) throw new Error(`Management panel '${selector}' is missing`);
    el(destination).append(node);
    return node;
}

async function loadManagement(): Promise<void> {
    const response = await fetch("memoryManagement.html");
    if (!response.ok)
        throw new Error(
            `Memory management surface unavailable (${response.status})`,
        );
    const parsed = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
    );
    const template = document.createElement("div");
    template.id = "managementTemplate";
    template.className = "hidden";
    for (const node of parsed.querySelectorAll("main, body > dialog")) {
        template.append(document.importNode(node, true));
    }
    document.body.append(template);
    for (const dialog of template.querySelectorAll("dialog"))
        document.body.append(dialog);
    move(".sources-panel", "hubSources");
    const detail = move(".detail-panel", "drawer-content");
    detail.querySelector(".content-heading h3")!.textContent = "Source text";
    const revisions = detail.querySelector<HTMLElement>(".source-details")!;
    el("drawer-revisions").append(revisions);
    revisions.setAttribute("open", "");
    const knowledge = move(
        ".side-column > .card:not(.jobs-panel):not(.activity-panel)",
        "drawer-knowledge",
    );
    knowledge.querySelector("h2")!.textContent = "Derived knowledge";
    move(".jobs-panel", "hubActivity");
    move(".activity-panel", "hubActivity");
    const activityNotice = document.createElement("p");
    activityNotice.textContent =
        "Web activity is browser-wide. The existing activity API supports these six filters and linked-source filtering, not corpus scoping.";
    document.querySelector(".activity-panel")!.prepend(activityNotice);
    const settings = move(".howto-settings", "hubRunbooks");
    const corpusSettings = document.createElement("section");
    corpusSettings.className = "card howto-settings";
    while (
        settings.firstChild &&
        !(
            settings.firstChild instanceof HTMLElement &&
            settings.firstChild.classList.contains("subsection-heading")
        )
    ) {
        corpusSettings.append(settings.firstChild);
    }
    el("hubSettings").append(corpusSettings);
    template.append(settings);
    el("hubSettings").append(el("reindexCorpusButton"));
    el("hubMain").prepend(el("errorBanner"));
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Source type";
    const typeSelect = document.createElement("select");
    typeSelect.id = "hubSourceType";
    for (const type of ["", "web", "markdown", "text", "html", "vtt"]) {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type || "All types";
        typeSelect.append(option);
    }
    typeLabel.append(typeSelect);
    el("hubSources").prepend(typeLabel);
    typeSelect.addEventListener("change", () =>
        el("applySourceFilter").click(),
    );
    manager = mountMemoryManagement({
        scope: () => scope || undefined,
        async sources(params) {
            const type = typeSelect.value as MemoryCenterSource["sourceType"];
            const result = await invokeView("memoryHubSources", {
                ...params,
                corpusId: scope || undefined,
                sourceTypes: type ? [type] : undefined,
            });
            if (result.errors.length) {
                el("hubDegraded").textContent =
                    `Degraded source results:\n${result.errors.map((error) => `${error.corpusId}: ${error.message}`).join("\n")}`;
                el("hubDegraded").classList.remove("hidden");
                el("hubStatus").textContent = "Degraded";
            }
            return result;
        },
        procedures: (query) =>
            snapshot.procedures.filter(
                (item) =>
                    !query ||
                    item.title.toLowerCase().includes(query.toLowerCase()),
            ),
        changed: () =>
            hubAction(async () => {
                invalidateDiscovery();
                await refreshSnapshot();
            }),
        error: (_message, offline) => {
            el("hubStatus").textContent = offline
                ? "Offline"
                : "Connected · operation failed";
        },
        status: (indexing) => {
            if (
                snapshotAvailable &&
                el("hubDegraded").classList.contains("hidden") &&
                el("hubError").classList.contains("hidden")
            )
                el("hubStatus").textContent = indexing
                    ? "Indexing"
                    : "Connected";
        },
        corpusName: (corpusId) =>
            snapshot.corpora.find((corpus) => corpus.corpusId === corpusId)
                ?.name ?? corpusId,
        openSource: (corpusId, objectId) =>
            open({ page: "library", corpusId, objectId }),
        openProcedure: (corpusId, objectId) =>
            open({ page: "runbooks", corpusId, objectId }),
    });
    el("reindexCorpusButton").addEventListener("click", () => {
        if (!scope)
            void hubAction(async () => {
                throw new Error("Select a named corpus before reindexing.");
            });
    });
}

async function showTab(name: string): Promise<void> {
    for (const value of [
        "content",
        "knowledge",
        "revisions",
        "usedby",
        "activity",
    ]) {
        el(`drawer-${value}`).classList.toggle("hidden", value !== name);
        const tabButton = document.querySelector<HTMLElement>(
            `[data-tab="${value}"]`,
        )!;
        tabButton.setAttribute("aria-selected", String(value === name));
        tabButton.tabIndex = value === name ? 0 : -1;
    }
    if (name === "knowledge") await manager.loadSourceKnowledge();
    if (name === "usedby") await showSourceUsage();
    if (name === "activity") {
        const panel = document.querySelector<HTMLElement>(".activity-panel")!;
        el("drawer-activity").append(panel);
        el("showSourceActivity").click();
    }
}

async function showSourceUsage(continuationToken?: string): Promise<void> {
    const route = parseRoute(location.hash);
    if (!route.corpusId || !route.objectId)
        throw new Error(
            "Open a corpus-qualified source before loading its dependencies",
        );
    const generation = routeVersion;
    const host = el("drawer-usedby");
    if (!continuationToken)
        host.textContent =
            "Loading retained procedure versions and exact skill snapshots…";
    const page = await invokeView("memoryHubRunbookUsedBy", {
        corpusId: route.corpusId,
        sourceId: route.objectId,
        pageSize: 25,
        ...(continuationToken === undefined ? {} : { continuationToken }),
    });
    if (generation !== routeVersion || location.hash !== routeHash(route))
        return;
    if (!continuationToken) host.replaceChildren();
    const status = document.createElement("p");
    status.textContent = `${page.total} retained procedure versions cite this source. ${page.warnings.join(" ")}`;
    host.append(status);
    for (const usage of page.items) {
        const card = document.createElement("article");
        card.className = "card";
        const procedure = usage.procedure;
        card.append(
            button(
                `${procedure.document.title} · version ${procedure.version} · ${procedure.state}`,
                () => {
                    open({
                        page: "runbooks",
                        corpusId: procedure.corpusId,
                        objectId: procedure.procedureId,
                        runbookKind: "procedure",
                        procedureVersion: procedure.version,
                    });
                },
            ),
        );
        for (const skill of usage.skills) {
            card.append(
                button(
                    `${skill.displayName} · ${skill.state}${skill.active ? " · active" : ""} · exact snapshot ${skill.revisionId.slice(0, 12)}`,
                    () => {
                        open({
                            page: "runbooks",
                            corpusId: procedure.corpusId,
                            objectId: procedure.procedureId,
                            skillRevisionId: skill.revisionId,
                        });
                    },
                ),
            );
        }
        host.append(card);
    }
    if (page.nextContinuationToken)
        host.append(
            button("More source dependencies", () => {
                void hubAction(() =>
                    showSourceUsage(page.nextContinuationToken),
                );
            }),
        );
}

function updateExploreNavigation(view: HubRoute["webView"]): void {
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
        "#hubExploreNavigation a",
    )) {
        if (link.dataset.exploreView === (view ?? "overview"))
            link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    }
}

function showPage(route: HubRoute, visiblePage: (typeof pages)[number]): void {
    if (visiblePage !== "settings") webMaintenancePanel.hide();
    if (visiblePage !== "explore" || !route.webView) webExplorePanel.hide();
    el("hubExplore").hidden = !!route.webView;
    updateExploreNavigation(route.webView);
    if (visiblePage === "activity") runbookImportsPanel.showActivity();
    else runbookImportsPanel.hideActivity();
    for (const page of pages)
        el(`page-${page}`).classList.toggle("hidden", page !== visiblePage);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
        "#hubRail a",
    )) {
        if (link.hash === `#/${route.page}`)
            link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    }
    el("hubDrawer").classList.add("hidden");
    el("hubActivity").append(
        document.querySelector<HTMLElement>(".activity-panel")!,
    );
    el<HTMLButtonElement>("addMarkdown").disabled = !namedScopeAvailable();
    el<HTMLButtonElement>("reindexCorpusButton").disabled =
        !namedScopeAvailable();
}

async function showCandidate(
    item: MemoryHubInboxItem,
    version: number,
): Promise<void> {
    await runbooksPanel.show({
        corpusId: item.corpusId,
        kind: "candidate",
        objectId: item.objectId,
    });
    if (version !== routeVersion) return;
}

async function findJob(
    corpusId: string,
    jobId: string,
    version: number,
): Promise<MemoryCenterJob | undefined> {
    let token: string | undefined;
    const visitedTokens = new Set<string>();
    do {
        const page = await invokeMemory("memoryListJobs", {
            corpusId: corpusId || undefined,
            pageSize: 25,
            continuationToken: token,
        });
        const selected = page.items.find((value) => value.jobId === jobId);
        if (selected || version !== routeVersion) return selected;
        token = page.nextContinuationToken;
        if (token && visitedTokens.has(token))
            throw new Error("Memory jobs returned a repeated page token.");
        if (token) visitedTokens.add(token);
    } while (token);
    return undefined;
}

async function showJob(
    corpusId: string,
    jobId: string,
    version: number,
): Promise<void> {
    const selected = await findJob(corpusId, jobId, version);
    if (version !== routeVersion) return;
    const detail = document.createElement("div");
    detail.id = "hubJobDetail";
    detail.className = "card";
    detail.textContent = selected
        ? `${selected.state} · ${selected.progress.stage ?? selected.state} · ${selected.progress.completed}/${selected.progress.total ?? "?"} · ${selected.error ?? ""} ${selected.warnings.join("\n")}`
        : "This job is no longer available. Retry is unavailable.";
    if (
        selected &&
        !["complete", "partial", "failed", "cancelled"].includes(selected.state)
    ) {
        detail.append(
            button("Cancel job", () => {
                void hubAction(async () => {
                    await invokeMemory("memoryCancelJob", {
                        jobId: selected.jobId,
                    });
                    await refreshSnapshot();
                    await applyRoute();
                });
            }),
        );
    }
    document.getElementById("hubJobDetail")?.remove();
    el("hubActivity").prepend(detail);
}

function isRunbookRoute(
    route: HubRoute,
    item: MemoryHubInboxItem | undefined,
): boolean {
    return (
        route.page === "runbooks" ||
        item?.kind === "staleProcedure" ||
        item?.kind === "skillDraft" ||
        item?.kind === "bindingDrift"
    );
}

async function showRunbookRoute(
    route: HubRoute,
    item: MemoryHubInboxItem | undefined,
    corpusId: string,
): Promise<void> {
    const objectId = item?.objectId ?? route.objectId;
    if (!objectId) {
        await runbooksPanel.show();
        return;
    }
    const skillRevisionId = item?.skillRevisionId ?? route.skillRevisionId;
    await runbooksPanel.show({
        corpusId,
        kind: route.runbookKind ?? "procedure",
        objectId,
        ...(route.procedureVersion === undefined
            ? {}
            : { version: route.procedureVersion }),
        ...(skillRevisionId === undefined ? {} : { skillRevisionId }),
    });
}

async function showManagedRoute(
    route: HubRoute,
    item: MemoryHubInboxItem | undefined,
    version: number,
): Promise<void> {
    if (!route.webView && !route.corpusId && scope && !namedScopeAvailable())
        throw new Error(
            "The selected corpus no longer exists. Choose another scope.",
        );
    document.getElementById("hubCandidateReview")?.remove();
    const corpusId = item?.corpusId ?? route.corpusId ?? scope;
    if (isRunbookRoute(route, item)) {
        await showRunbookRoute(route, item, corpusId);
        return;
    }
    if (route.page === "inbox" || route.webView) return;
    await manager.selectCorpus(corpusId);
    if (version !== routeVersion) return;
    if (route.page === "library" && route.objectId) {
        await manager.selectSource(route.objectId);
        if (version !== routeVersion) return;
        const corpusName =
            snapshot.corpora.find((corpus) => corpus.corpusId === corpusId)
                ?.name ?? "unavailable";
        el("drawerCorpus").textContent =
            `Source corpus: ${corpusName}${scope && corpusId !== scope ? " (outside selected scope)" : ""}`;
        el("hubDrawer").classList.remove("hidden");
        await showTab("content");
        el("drawerClose").focus();
    } else if (route.page === "activity" && route.objectId) {
        await showJob(corpusId, route.objectId, version);
    } else {
        document.getElementById("hubJobDetail")?.remove();
    }
}

function restoreFocus(visiblePage: (typeof pages)[number]): void {
    if (focusReturn && el("hubDrawer").classList.contains("hidden")) {
        const route = parseRoute(location.hash);
        const restored =
            route.page === "library" &&
            manager.focusSource(focusReturn.corpusId, focusReturn.sourceId);
        if (!restored) {
            const heading = el(
                `page-${visiblePage}`,
            ).querySelector<HTMLElement>("h2");
            if (heading) {
                heading.tabIndex = -1;
                heading.focus();
            }
        }
        focusReturn = undefined;
    }
}

async function applyRoute(): Promise<void> {
    const version = ++routeVersion;
    const route = parseRoute(location.hash);
    if (route.page === "inbox") {
        await refreshSnapshot();
        if (version !== routeVersion) return;
    }
    const item =
        route.page === "inbox" && route.objectId
            ? snapshot.inbox.find((value) => value.id === route.objectId)
            : undefined;
    if (route.page === "inbox" && route.objectId && !item)
        throw new Error(
            "Inbox item is no longer available. Refresh the Inbox.",
        );
    const visiblePage = item && item.kind !== "job" ? "runbooks" : route.page;
    showPage(route, visiblePage);
    if (item?.kind === "candidate") await showCandidate(item, version);
    else await showManagedRoute(route, item, version);
    if (version !== routeVersion) return;
    if (route.page === "search") {
        const query = pendingSearchQuery;
        pendingSearchQuery = undefined;
        await searchPanel.show(query);
    } else if (route.page === "explore") {
        if (!route.webView) await explorePanel.show();
        else
            await webExplorePanel.show({
                view: route.webView,
                ...(route.webEntity === undefined
                    ? {}
                    : { entity: route.webEntity }),
                ...(route.webTopic === undefined
                    ? {}
                    : { topic: route.webTopic }),
            });
    } else if (route.page === "activity") {
        await changesPanel.refresh();
    } else if (route.page === "settings") {
        await preferencesPanel.show();
        viewPreferencesPanel.show();
        await webMaintenancePanel.show();
    }
    if (version !== routeVersion) return;
    renderInbox();
    restoreFocus(visiblePage);
}

export async function mountMemoryHub(): Promise<void> {
    const migrated = migrateLegacyMemoryLocation(location.href);
    if (migrated.href !== location.href) {
        history.replaceState(history.state, "", migrated.href);
        lastHash = location.hash;
    }
    el("hubRefresh").onclick = () => location.reload();
    await loadManagement();
    mountPhaseTwo();
    mountRunbooks();
    mountRunbookImports();
    const onError = (error: unknown) => {
        void hubAction(async () => {
            throw error;
        });
    };
    webMaintenancePanel = mountMemoryHubWebMaintenance(el("hubSettings"), {
        onError,
        onOpenGraph: () => open({ page: "explore", webView: "entities" }),
    });
    viewPreferencesPanel = mountMemoryHubViewPreferences(el("hubSettings"), {
        onError,
    });
    webExplorePanel = mountMemoryHubWebExplore(el("hubWebExplore"), {
        onError,
        showNavigation: false,
        onRouteChanged: (request) => {
            const current = parseRoute(location.hash);
            if (current.page !== "explore") return;
            if (!current.webView && request.view === "analytics") return;
            const hash = routeHash({
                page: "explore",
                webView: request.view,
                ...(request.entity === undefined
                    ? {}
                    : { webEntity: request.entity }),
                ...(request.topic === undefined
                    ? {}
                    : { webTopic: request.topic }),
            });
            if (hash === location.hash) return;
            history.pushState(history.state, "", hash);
            lastHash = hash;
            el("hubExplore").hidden = true;
            updateExploreNavigation(request.view);
        },
    });
    const guardPreferences = (event: BeforeUnloadEvent) => {
        if (!viewPreferencesPanel.isDirty()) return;
        event.preventDefault();
        event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardPreferences);
    pendingSearchQuery =
        (
            new URLSearchParams(location.search).get("query") ??
            localStorage.getItem("memoryHub.ask") ??
            ""
        ).trim() || undefined;
    await hubAction(refreshSnapshot);
    if (snapshotAvailable) await hubAction(applyRoute);
    el("hubRefresh").onclick = null;
    const query =
        new URLSearchParams(location.search).get("query") ??
        localStorage.getItem("memoryHub.ask") ??
        "";
    el<HTMLInputElement>("hubAsk").value = query;
    const inspector = el<HTMLInputElement>("hubInspector");
    inspector.checked = localStorage.getItem(INSPECTOR_KEY) === "true";
    document.body.classList.toggle("inspector", inspector.checked);
    inspector.addEventListener("change", () => {
        localStorage.setItem(INSPECTOR_KEY, String(inspector.checked));
        document.body.classList.toggle("inspector", inspector.checked);
    });
    el("hubAdd").addEventListener("click", () =>
        el<HTMLDialogElement>("hubAddDialog").showModal(),
    );
    el("addClose").addEventListener("click", () =>
        el<HTMLDialogElement>("hubAddDialog").close(),
    );
    for (const [id, target] of [
        ["addCreate", "createCorpusDialog"],
        ["addMarkdown", "importDocumentDialog"],
    ]) {
        el(id).addEventListener("click", () => {
            void hubAction(async () => {
                if (!discardChanges()) return;
                if (id === "addMarkdown") {
                    if (!scope)
                        throw new Error(
                            "Select a named corpus before importing Markdown.",
                        );
                    await manager.selectCorpus(scope);
                }
                el<HTMLDialogElement>("hubAddDialog").close();
                el<HTMLDialogElement>(target).showModal();
            });
        });
    }
    el("hubRefresh").addEventListener("click", () => {
        if (!discardChanges()) return;
        void hubAction(async () => {
            invalidateDiscovery();
            await refreshSnapshot();
            await applyRoute();
        });
    });
    el<HTMLSelectElement>("hubCorpus").addEventListener("change", () => {
        if (!discardChanges()) {
            el<HTMLSelectElement>("hubCorpus").value = scope;
            return;
        }
        scope = el<HTMLSelectElement>("hubCorpus").value;
        localStorage.setItem(SCOPE_KEY, scope);
        invalidateDiscovery();
        runbooksPanel.scopeChanged();
        preferencesPanel.scopeChanged();
        runbookImportsPanel.scopeChanged();
        renderErrors();
        inboxPage = 0;
        const route = parseRoute(location.hash);
        location.hash = routeHash({ page: route.page });
        void hubAction(applyRoute);
    });
    for (const id of ["inboxKind", "inboxGroup", "inboxDismissed"]) {
        el(id).addEventListener("change", () => {
            inboxPage = 0;
            renderInbox();
        });
    }
    el("inboxPrevious").addEventListener("click", () => {
        inboxPage--;
        renderInbox();
    });
    el("inboxNext").addEventListener("click", () => {
        inboxPage++;
        renderInbox();
    });
    el("drawerClose").addEventListener("click", () => {
        if (!discardChanges()) return;
        const route = parseRoute(location.hash);
        if (route.corpusId && route.objectId)
            focusReturn = {
                corpusId: route.corpusId,
                sourceId: route.objectId,
            };
        if (history.state?.memoryDrawer) history.back();
        else open({ page: "library" });
    });
    el("drawerExpand").addEventListener("click", () =>
        el("hubDrawer").classList.toggle("expanded"),
    );
    for (const node of document.querySelectorAll<HTMLElement>("[data-tab]")) {
        node.addEventListener("click", () => {
            void hubAction(() => showTab(node.dataset.tab!));
        });
        node.addEventListener("keydown", (event) => {
            if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            const tabs = Array.from(
                document.querySelectorAll<HTMLElement>("[data-tab]"),
            );
            const index =
                (tabs.indexOf(node) +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                tabs.length;
            event.preventDefault();
            tabs[index].focus();
            tabs[index].click();
        });
    }
    el<HTMLFormElement>("hubAskForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const ask = el<HTMLInputElement>("hubAsk").value;
        if (!ask.trim()) {
            void hubAction(async () => {
                throw new Error("Enter a query before searching.");
            });
            return;
        }
        const alreadySearch = parseRoute(location.hash).page === "search";
        if (!open({ page: "search" })) return;
        searchPanel.scopeChanged();
        pendingSearchQuery = ask;
        synchronizeQuery(ask);
        if (alreadySearch) void hubAction(applyRoute);
    });
    window.addEventListener("hashchange", () => {
        if (reverting) {
            reverting = false;
            return;
        }
        if (document.querySelector("dialog[open]") || !discardChanges()) {
            reverting = true;
            location.hash = lastHash;
            return;
        }
        lastHash = location.hash;
        const route = parseRoute(location.hash);
        if (route.page === "library" && route.objectId)
            history.replaceState({ ...history.state, memoryDrawer: true }, "");
        void hubAction(applyRoute);
    });
    document.addEventListener("keydown", (event) => {
        const editing =
            event.target instanceof HTMLElement &&
            /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
        if (event.key === "/" && !editing) {
            event.preventDefault();
            el("hubAsk").focus();
        }
        if (
            event.key === "Escape" &&
            !el("hubDrawer").classList.contains("hidden") &&
            !document.querySelector("dialog[open]")
        )
            el("drawerClose").click();
        if (event.altKey && /^[1-7]$/.test(event.key)) {
            event.preventDefault();
            open({ page: pages[Number(event.key) - 1] });
        }
    });
    const refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible")
            void hubAction(refreshSnapshot);
    }, 60_000);
    window.addEventListener("pagehide", (event) => {
        if (event.persisted) return;
        clearInterval(refreshTimer);
        searchPanel.dispose();
        explorePanel.dispose();
        changesPanel.dispose();
        importsPanel.dispose();
        capturePanel.dispose();
        runbooksPanel.dispose();
        preferencesPanel.dispose();
        runbookImportsPanel.dispose();
        webMaintenancePanel.dispose();
        viewPreferencesPanel.dispose();
        webExplorePanel.dispose();
        window.removeEventListener("beforeunload", guardPreferences);
    });
}

if (document.body.dataset.memoryHub) void hubAction(mountMemoryHub);
