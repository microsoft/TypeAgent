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
import { mountThemeToggle } from "./memoryHubTheme";
import { icon, iconButton, menuButton, setIconButton } from "./memoryHubUi";
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
let inboxKind = "";
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

const PDF_CHIP = "pdf";
const PDF_URI_PREFIX = "urn:pdf:";

const railPages: HubRoute["page"][] = [
    "inbox",
    "library",
    "runbooks",
    "explore",
    "activity",
    "settings",
];

function observeStatus(): void {
    const status = el("hubStatus");
    const update = () => {
        const text = status.textContent ?? "";
        status.dataset.state = /offline|failed/i.test(text)
            ? "bad"
            : /degraded|indexing/i.test(text)
              ? "warn"
              : "ok";
    };
    new MutationObserver(update).observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
    });
    update();
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
        scope: () =>
            el<HTMLSelectElement>("addTarget").value || scope || undefined,
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

const inboxKinds: Record<
    MemoryHubInboxItem["kind"],
    { label: string; chip: string; glyph: string; tone: string }
> = {
    candidate: {
        label: "Discovered how-to",
        chip: "How-tos",
        glyph: "fa-lightbulb",
        tone: "",
    },
    staleProcedure: {
        label: "Stale procedure",
        chip: "Stale",
        glyph: "fa-hourglass-half",
        tone: "warn",
    },
    job: {
        label: "Failed or partial job",
        chip: "Jobs",
        glyph: "fa-triangle-exclamation",
        tone: "bad",
    },
    skillDraft: {
        label: "Skill draft",
        chip: "Skill drafts",
        glyph: "fa-rocket",
        tone: "",
    },
    bindingDrift: {
        label: "Changed tool binding",
        chip: "Bindings",
        glyph: "fa-link-slash",
        tone: "warn",
    },
    runbookWarning: {
        label: "Extraction warning",
        chip: "Warnings",
        glyph: "fa-circle-exclamation",
        tone: "warn",
    },
};

function hideInboxItem(item: MemoryHubInboxItem, until?: number): void {
    hidden[item.id] = {
        fingerprint: item.fingerprint,
        ...(until === undefined ? {} : { until }),
    };
    persistHidden();
}

function inboxCard(item: MemoryHubInboxItem, dismissed: boolean): HTMLElement {
    const kind = inboxKinds[item.kind];
    const card = document.createElement("article");
    card.className = "inbox-card";
    const badge = document.createElement("div");
    badge.className = `inbox-icon ${kind.tone}`.trim();
    badge.append(icon(kind.glyph));
    const body = document.createElement("div");
    body.className = "inbox-body";
    const heading = document.createElement("h3");
    heading.textContent = item.title;
    const reason = document.createElement("p");
    reason.textContent = `${kind.label} · ${item.corpusName} · ${item.reason} · ${new Date(item.updatedAt).toLocaleString()}`;
    body.append(heading, reason);
    const actions = document.createElement("div");
    actions.className = "hub-row-actions";
    const primary = button(item.kind === "job" ? "Open job" : "Review", () =>
        inboxAction(item),
    );
    primary.classList.add("primary");
    actions.append(primary);
    if (dismissed) {
        actions.append(
            iconButton("fa-rotate-left", "Restore", () => {
                delete hidden[item.id];
                persistHidden();
            }),
        );
    } else {
        const more = [
            ...(item.kind === "candidate"
                ? [
                      {
                          label: "Reject",
                          icon: "fa-thumbs-down",
                          danger: true,
                          action: () => {
                              void hubAction(async () => {
                                  if (
                                      !confirm(
                                          `Reject "${item.title}" in ${item.corpusName}?`,
                                      )
                                  )
                                      return;
                                  await invokeMemory(
                                      "memoryRejectProcedureCandidate",
                                      {
                                          corpusId: item.corpusId,
                                          candidateId: item.objectId,
                                      },
                                  );
                                  await refreshSnapshot();
                              });
                          },
                      },
                  ]
                : []),
            {
                label: "Snooze 1 day",
                icon: "fa-bell-slash",
                action: () => hideInboxItem(item, Date.now() + 86_400_000),
            },
        ];
        actions.append(
            menuButton("More actions", more),
            iconButton("fa-xmark", "Dismiss", () => hideInboxItem(item)),
        );
    }
    card.append(badge, body, actions);
    return card;
}

function inboxEmpty(
    dismissed: boolean,
    unavailable: boolean,
    degraded: boolean,
): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "hub-empty";
    const title = document.createElement("h3");
    const message = document.createElement("p");
    if (unavailable) {
        empty.append(icon("fa-plug-circle-exclamation"));
        title.textContent = "Inbox unavailable";
        message.textContent =
            "Inbox is unavailable for this scope. Refresh or choose another corpus.";
    } else if (degraded) {
        empty.append(icon("fa-triangle-exclamation"));
        title.textContent = "Nothing to show yet";
        message.textContent =
            "No matching items in available results. Some corpora could not be loaded.";
    } else if (dismissed) {
        empty.append(icon("fa-regular fa-bell-slash"));
        title.textContent = "No dismissed items";
        message.textContent = "Dismissed and snoozed items appear here.";
    } else {
        empty.append(icon("fa-regular fa-circle-check"));
        title.textContent = "You're all caught up";
        message.textContent = "Nothing needs your attention.";
    }
    empty.append(title, message);
    return empty;
}

function renderInboxChips(available: MemoryHubInboxItem[]): void {
    const host = el("inboxChips");
    const kinds = Array.from(new Set(available.map((item) => item.kind)));
    host.hidden = kinds.length < 2;
    const entries: Array<[string, string, number]> = [
        ["", "All", available.length],
        ...kinds.map((value): [string, string, number] => [
            value,
            inboxKinds[value].chip,
            available.filter((item) => item.kind === value).length,
        ]),
    ];
    host.replaceChildren(
        ...entries.map(([value, label, count]) => {
            const chip = button(`${label} ${count}`, () => {
                inboxKind = value;
                inboxPage = 0;
                renderInbox();
            });
            chip.setAttribute("aria-pressed", String(value === inboxKind));
            return chip;
        }),
    );
}

function renderInbox(): void {
    const counts = inboxCounts(snapshot.inbox, hidden, scope || undefined);
    el("inboxBadge").textContent = snapshotAvailable
        ? String(counts.inbox)
        : "—";
    el("inboxBadge").dataset.count = String(counts.inbox);
    el("activityBadge").textContent =
        snapshotAvailable && jobsCountAvailable
            ? String(counts.failedJobs)
            : "?";
    el("activityBadge").dataset.count = String(counts.failedJobs);
    el("inboxSummary").textContent =
        snapshotAvailable && counts.inbox ? `${counts.inbox} need you` : "";
    const dismissedBox = el<HTMLInputElement>("inboxDismissed");
    const dismissed = dismissedBox.checked;
    const available = inboxItems(snapshot.inbox, hidden, {
        corpusId: scope || undefined,
        dismissed,
    });
    if (inboxKind && !available.some((item) => item.kind === inboxKind))
        inboxKind = "";
    renderInboxChips(available);
    const hiddenCount = inboxItems(snapshot.inbox, hidden, {
        corpusId: scope || undefined,
        dismissed: true,
    }).length;
    dismissedBox.parentElement!.hidden = !hiddenCount && !dismissed;
    const items = inboxItems(snapshot.inbox, hidden, {
        corpusId: scope || undefined,
        kind: inboxKind,
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
    if (!items.length)
        list.append(
            inboxEmpty(
                dismissed,
                !snapshotAvailable || !!(scope && !namedScopeAvailable()),
                snapshot.errors.length > 0,
            ),
        );
    el("inboxFilters").hidden =
        el("inboxChips").hidden && dismissedBox.parentElement!.hidden;
    const pager = el("inboxPage").parentElement!;
    pager.hidden = items.length <= 25;
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
    renderAddTargets();
    renderInbox();
    renderErrors();
}

function renderAddTargets(): void {
    const target = el<HTMLSelectElement>("addTarget");
    const previous = target.value;
    target.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a corpus";
    target.append(placeholder);
    for (const corpus of snapshot.corpora) {
        const option = document.createElement("option");
        option.value = corpus.corpusId;
        option.textContent = corpus.name;
        target.append(option);
    }
    const preferred = [scope, previous].find((id) =>
        snapshot.corpora.some((corpus) => corpus.corpusId === id),
    );
    target.value =
        preferred ??
        (snapshot.corpora.length === 1 ? snapshot.corpora[0].corpusId : "");
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
    const browserWide = document.createElement("span");
    browserWide.className = "hub-chip warn";
    browserWide.textContent = "Browser-wide";
    browserWide.title =
        "Web activity is browser-wide. The activity API supports these filters and linked-source filtering, not corpus scoping.";
    document.querySelector(".activity-panel h2")!.after(browserWide);
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
    const typeSelect = document.createElement("select");
    typeSelect.id = "hubSourceType";
    typeSelect.hidden = true;
    const typeChips = document.createElement("div");
    typeChips.className = "hub-chips hub-source-types";
    typeChips.setAttribute("role", "group");
    typeChips.setAttribute("aria-label", "Source type");
    for (const [type, label] of [
        ["", "All"],
        ["web", "Web"],
        ["markdown", "Markdown"],
        ["text", "Text"],
        ["html", "HTML"],
        ["vtt", "Transcript"],
        [PDF_CHIP, "PDF"],
    ]) {
        if (type !== PDF_CHIP) {
            const option = document.createElement("option");
            option.value = type;
            option.textContent = type || "All types";
            typeSelect.append(option);
        }
        const chip = button(label, () => {
            typeSelect.value = type === PDF_CHIP ? "" : type;
            // PDF imports are Markdown sources with a urn:pdf: identity.
            const filter = el<HTMLInputElement>("sourceFilter");
            if (type === PDF_CHIP) filter.value = PDF_URI_PREFIX;
            else if (filter.value === PDF_URI_PREFIX) filter.value = "";
            for (const other of typeChips.querySelectorAll("button"))
                other.setAttribute("aria-pressed", String(other === chip));
            el("applySourceFilter").click();
        });
        chip.setAttribute("aria-pressed", String(type === ""));
        typeChips.append(chip);
    }
    el("hubSources").prepend(typeChips, typeSelect);
    iconifyManagement();
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
        changed: async () => {
            invalidateDiscovery();
            await refreshSnapshot();
        },
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
        sourceForgotten: (corpusId, sourceId, title) => {
            notificationManager.showSuccess(`Forgot source "${title}".`);
            const route = parseRoute(location.hash);
            if (
                route.page === "library" &&
                route.corpusId === corpusId &&
                route.objectId === sourceId
            )
                open({ page: "library" });
        },
    });
    el("reindexCorpusButton").addEventListener("click", () => {
        if (!scope)
            void hubAction(async () => {
                throw new Error("Select a named corpus before reindexing.");
            });
    });
}

function restyleActivityPanel(): void {
    const panel = document.querySelector<HTMLElement>(".activity-panel")!;
    const filters = panel.querySelector<HTMLElement>(".activity-filters")!;
    const actions = panel.querySelector<HTMLElement>(".activity-actions")!;
    const details = document.createElement("details");
    details.className = "hub-filters";
    const summary = document.createElement("summary");
    summary.append(icon("fa-sliders"), "Filters");
    details.append(
        summary,
        filters,
        el("applyActivityFilter"),
        el("showSourceActivity"),
    );
    actions.before(details);
    actions.hidden = true;
    panel.querySelector(".section-heading")!.append(
        menuButton(
            "More activity actions",
            [
                {
                    label: "Delete matching events…",
                    icon: "fa-regular fa-trash-can",
                    danger: true,
                    action: () => el("forgetActivity").click(),
                },
            ],
            "fa-ellipsis-vertical",
        ),
    );
}

function mountPageTabs(
    pageId: string,
    attribute: string,
    label: string,
    tabs: ReadonlyArray<readonly [string, string]>,
): void {
    const page = el(pageId);
    const nav = document.createElement("nav");
    nav.className = "hub-tabs";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", label);
    const select = (name: string) => {
        page.dataset[attribute] = name;
        for (const tab of nav.querySelectorAll("button"))
            tab.setAttribute(
                "aria-selected",
                String(tab.dataset.pageTab === name),
            );
    };
    for (const [name, text] of tabs) {
        const tab = button(text, () => select(name));
        tab.setAttribute("role", "tab");
        tab.dataset.pageTab = name;
        nav.append(tab);
    }
    page.querySelector(".hub-page-head")!.after(nav);
    select(tabs[0][0]);
}

function mountPageTabSets(): void {
    mountPageTabs("page-activity", "activityTab", "Activity views", [
        ["jobs", "Jobs"],
        ["web", "Web history"],
        ["changes", "Changes"],
    ]);
    mountPageTabs("page-settings", "settingsTab", "Settings groups", [
        ["corpus", "Corpus"],
        ["runbooks", "Runbook import"],
        ["graph", "Browser graph"],
        ["view", "View"],
    ]);
}

function mountSettingsBar(): void {
    const page = el("page-settings");
    const group = el("hubSettings");
    const bar = document.createElement("div");
    bar.className = "hub-savebar";
    const save = button("Save changes", () => target().save?.click());
    save.classList.add("primary");
    const discard = iconButton("fa-rotate-left", "Discard changes", () =>
        target().reload?.click(),
    );
    const hint = document.createElement("span");
    hint.className = "hub-hint";
    bar.append(save, discard, hint);
    page.append(bar);

    function byText(root: ParentNode, prefix: string) {
        return Array.from(root.querySelectorAll("button")).find((node) =>
            node.textContent?.trim().startsWith(prefix),
        );
    }
    function target(): {
        save?: HTMLButtonElement;
        reload?: HTMLButtonElement;
    } {
        switch (page.dataset.settingsTab) {
            case "corpus":
                return { save: el<HTMLButtonElement>("saveHowToSettings") };
            case "runbooks": {
                const form = group.querySelector("form.card");
                return form
                    ? {
                          save: byText(form, "Save runbook preferences"),
                          reload: byText(form, "Reload saved preferences"),
                      }
                    : {};
            }
            case "view": {
                const view = group.querySelector(".memory-view-preferences");
                return view
                    ? {
                          save: byText(view, "Save view preferences"),
                          reload: byText(view, "Reload saved view"),
                      }
                    : {};
            }
            default:
                return {};
        }
    }
    function sync(): void {
        const { save: saveButton, reload } = target();
        bar.hidden = !saveButton;
        for (const node of [
            el("saveHowToSettings"),
            ...group.querySelectorAll<HTMLButtonElement>(
                "form.card button, .memory-view-preferences button",
            ),
        ]) {
            const owned =
                node === saveButton ||
                node === reload ||
                /^(Save|Reload)/.test(node.textContent?.trim() ?? "");
            if (owned) node.classList.add("hub-bar-hidden");
        }
        const saveDisabled = !saveButton || saveButton.disabled;
        save.disabled = saveDisabled;
        discard.hidden = !reload;
        discard.disabled = !reload || reload.disabled;
        hint.textContent = saveDisabled
            ? "No unsaved changes"
            : "You have unsaved changes";
    }
    const observer = new MutationObserver(sync);
    observer.observe(group, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled"],
    });
    observer.observe(page, {
        attributes: true,
        attributeFilter: ["data-settings-tab"],
    });
    sync();
}

function iconifyManagement(): void {
    restyleActivityPanel();
    for (const [id, glyph, label] of [
        ["refreshButton", "fa-rotate", "Refresh corpus"],
        ["refreshJobsButton", "fa-rotate", "Refresh jobs"],
        ["sourcePrevious", "fa-chevron-left", "Previous sources"],
        ["sourceNext", "fa-chevron-right", "Next sources"],
        ["jobPrevious", "fa-chevron-left", "Previous jobs"],
        ["jobNext", "fa-chevron-right", "Next jobs"],
        ["activityPrevious", "fa-chevron-left", "Previous events"],
        ["activityNext", "fa-chevron-right", "Next events"],
        ["contentPrevious", "fa-chevron-left", "Previous content"],
        ["contentNext", "fa-chevron-right", "Next content"],
    ] as const)
        setIconButton(el<HTMLButtonElement>(id), glyph, label);
    const filter = el<HTMLInputElement>("sourceFilter");
    filter.placeholder = "Filter by title, URL or tag";
    let timer: number | undefined;
    filter.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => el("applySourceFilter").click(), 300);
    });
    el("applySourceFilter").hidden = true;
    const detailActions = el("reindexSourceButton").parentElement!;
    detailActions.hidden = true;
    const heading = detailActions.parentElement!;
    heading.append(
        menuButton("More source actions", [
            {
                label: "Reindex source",
                icon: "fa-rotate",
                disabled: () =>
                    el<HTMLButtonElement>("reindexSourceButton").disabled,
                action: () => el("reindexSourceButton").click(),
            },
            {
                label: "Forget source…",
                icon: "fa-regular fa-trash-can",
                danger: true,
                disabled: () =>
                    el<HTMLButtonElement>("forgetSourceButton").disabled,
                action: () => el("forgetSourceButton").click(),
            },
        ]),
    );
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

function updateExploreScope(
    route: HubRoute,
    visiblePage: (typeof pages)[number],
): void {
    if (visiblePage !== "explore") return;
    const badge = el("exploreScopeBadge");
    const browserOnly = !!route.webView;
    badge.classList.toggle("warn", browserOnly);
    badge.title = browserOnly
        ? "This view always reads TypeAgent Browser Memory and ignores the scope selector."
        : "";
    badge.textContent = browserOnly
        ? "Browser memory only"
        : `Scope: ${snapshot.corpora.find((corpus) => corpus.corpusId === scope)?.name ?? "All memory"}`;
}

function showPage(route: HubRoute, visiblePage: (typeof pages)[number]): void {
    if (visiblePage !== "settings") webMaintenancePanel.hide();
    if (visiblePage !== "explore" || !route.webView) webExplorePanel.hide();
    if (visiblePage !== "explore" || route.webView) explorePanel.hide();
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
    updateExploreScope(route, visiblePage);
    el("hubDrawer").classList.add("hidden");
    el("hubActivity").append(
        document.querySelector<HTMLElement>(".activity-panel")!,
    );
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
        el("page-activity").dataset.activityTab = "jobs";
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
    mountThemeToggle(el("hubTheme"));
    observeStatus();
    mountPageTabSets();
    mountSettingsBar();
    el("hubAdd").addEventListener("click", () => {
        renderAddTargets();
        el<HTMLDialogElement>("hubAddDialog").showModal();
    });
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
                    const target = el<HTMLSelectElement>("addTarget").value;
                    if (!target)
                        throw new Error(
                            "Choose a corpus in Add to before importing Markdown.",
                        );
                    await manager.selectCorpus(target);
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
    el("inboxDismissed").addEventListener("change", () => {
        inboxPage = 0;
        renderInbox();
    });
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
        if (event.altKey && /^[1-6]$/.test(event.key)) {
            event.preventDefault();
            open({ page: railPages[Number(event.key) - 1] });
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
