// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AutomationCatalog,
    AutomationDetail,
    AutomationProviderStatus,
    AutomationSummary,
    AutomationValidationReport,
    AutomationVerb,
} from "@typeagent/agent-flows/catalog";
import { invokeView } from "./viewClient";
import { showConfirmationDialog, showNotification } from "./viewFeedback";
import {
    KIND_LABELS,
    KIND_ORDER,
    STATUS_LABELS,
    commonVerbs,
    countBy,
    countView,
    defaultFilters,
    filterAutomations,
    formatRelativeTime,
    isKind,
    sortAutomations,
    type FilterState,
    type SmartView,
    type SortKey,
} from "./automationsModel";

type Child = Node | string | undefined | null | false;

interface ElProps {
    class?: string;
    text?: string;
    title?: string;
    type?: string;
    disabled?: boolean;
    pressed?: boolean;
    selected?: boolean;
    role?: string;
    onclick?: () => void;
    onchange?: (event: Event) => void;
    checked?: boolean;
    label?: string;
}

// Builds nodes with textContent only. Names, scripts, and step arguments are
// stored data and are never parsed as HTML.
function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: ElProps = {},
    ...children: Child[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text !== undefined) node.textContent = props.text;
    if (props.title) node.title = props.title;
    if (props.label) node.setAttribute("aria-label", props.label);
    if (props.role) node.setAttribute("role", props.role);
    if (props.type) node.setAttribute("type", props.type);
    if (props.disabled) node.setAttribute("disabled", "");
    if (props.pressed !== undefined) {
        node.setAttribute("aria-pressed", String(props.pressed));
    }
    if (props.selected !== undefined) {
        node.setAttribute("aria-selected", String(props.selected));
    }
    if (props.checked !== undefined) {
        (node as unknown as HTMLInputElement).checked = props.checked;
    }
    if (props.onclick) node.addEventListener("click", props.onclick);
    if (props.onchange) node.addEventListener("change", props.onchange);
    for (const child of children) {
        if (child === undefined || child === null || child === false) continue;
        node.append(child);
    }
    return node;
}

type TabId = "overview" | "inputs" | "body" | "triggers" | "safety" | "history";

const TAB_LABELS: Record<TabId, string> = {
    overview: "Overview",
    inputs: "Inputs",
    body: "Body",
    triggers: "Triggers",
    safety: "Safety",
    history: "History",
};

const SMART_VIEWS: { view: SmartView; label: string }[] = [
    { view: "needsReview", label: "Needs review" },
    { view: "all", label: "All" },
    { view: "active", label: "Active" },
    { view: "disabled", label: "Disabled" },
    { view: "recent", label: "Recent runs" },
];

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class AutomationsApp {
    private items: AutomationSummary[] = [];
    private providers: AutomationProviderStatus[] = [];
    private filters: FilterState = { ...defaultFilters };
    private selected = new Set<string>();
    private openId: string | undefined;
    private detail: AutomationDetail | undefined;
    private validation: AutomationValidationReport | undefined;
    private tab: TabId = "overview";
    private loadError: string | undefined;
    private loading = true;

    async initialize() {
        const kind = new URLSearchParams(location.search).get("kind");
        if (isKind(kind)) this.filters.kind = kind;
        document
            .getElementById("searchInput")!
            .addEventListener("input", (event) => {
                this.filters.search = (event.target as HTMLInputElement).value;
                this.renderList();
            });
        await this.load();
    }

    private async load() {
        this.loading = true;
        try {
            const catalog = (await invokeView(
                "listAutomations",
            )) as AutomationCatalog;
            this.items = catalog.items;
            this.providers = catalog.providers;
            this.loadError = undefined;
            this.selected = new Set(
                [...this.selected].filter((id) =>
                    this.items.some((item) => item.id === id),
                ),
            );
            const pending = countView(this.items, "needsReview");
            if (this.filters.view === "all" && pending > 0) {
                this.filters.view = "needsReview";
            } else if (this.filters.view === "needsReview" && pending === 0) {
                this.filters.view = "all";
            }
        } catch (error) {
            this.loadError = errorMessage(error);
        } finally {
            this.loading = false;
        }
        this.render();
    }

    private render() {
        this.renderRail();
        this.renderNotices();
        this.renderList();
        this.renderDetail();
    }

    private railButton(
        label: string,
        count: number,
        pressed: boolean,
        onclick: () => void,
    ) {
        return el(
            "button",
            { class: "rail-item", pressed, type: "button", onclick },
            el("span", { text: label }),
            el("span", { class: "rail-count", text: String(count) }),
        );
    }

    private renderRail() {
        const rail = document.getElementById("rail")!;
        rail.replaceChildren();
        const now = Date.now();

        rail.append(el("h2", { text: "Views" }));
        for (const { view, label } of SMART_VIEWS) {
            rail.append(
                this.railButton(
                    label,
                    countView(this.items, view, now),
                    this.filters.view === view,
                    () => {
                        this.filters.view = view;
                        this.render();
                    },
                ),
            );
        }

        rail.append(el("h2", { text: "Kind" }));
        const kindCounts = countBy(this.items, (item) => item.kind);
        rail.append(
            this.railButton(
                "All kinds",
                this.items.length,
                this.filters.kind === "all",
                () => this.setFacet("kind", "all"),
            ),
        );
        for (const kind of KIND_ORDER) {
            rail.append(
                this.railButton(
                    KIND_LABELS[kind],
                    kindCounts.get(kind) ?? 0,
                    this.filters.kind === kind,
                    () => this.setFacet("kind", kind),
                ),
            );
        }

        this.renderFacet(rail, "Scope", "scope", (i) => i.scope);
        this.renderFacet(rail, "Origin", "origin", (i) => i.origin);
    }

    private renderFacet(
        rail: HTMLElement,
        title: string,
        key: "scope" | "origin",
        pick: (item: AutomationSummary) => string,
    ) {
        const counts = countBy(this.items, pick);
        if (counts.size === 0) return;
        rail.append(el("h2", { text: title }));
        rail.append(
            this.railButton(
                "Any",
                this.items.length,
                this.filters[key] === "all",
                () => this.setFacet(key, "all"),
            ),
        );
        for (const [value, count] of [...counts].sort((a, b) =>
            a[0].localeCompare(b[0]),
        )) {
            rail.append(
                this.railButton(value, count, this.filters[key] === value, () =>
                    this.setFacet(key, value),
                ),
            );
        }
    }

    private setFacet(key: "kind" | "scope" | "origin", value: string) {
        (this.filters as unknown as Record<string, string>)[key] = value;
        this.render();
    }

    private renderNotices() {
        const notices = document.getElementById("notices")!;
        notices.replaceChildren();
        if (this.loadError) {
            notices.append(
                el("div", {
                    class: "auto-notice",
                    text: `Could not load automations: ${this.loadError}`,
                }),
            );
        }
        for (const provider of this.providers) {
            if (provider.available) continue;
            notices.append(
                el("div", {
                    class: "auto-notice",
                    text: `${KIND_LABELS[provider.kind]}s are unavailable: ${provider.reason ?? "unknown reason"}`,
                }),
            );
        }
        const review = countView(this.items, "needsReview");
        if (review > 0 && this.filters.view !== "needsReview") {
            notices.append(
                el(
                    "div",
                    { class: "auto-banner" },
                    el("span", {
                        text: `${review} ${review === 1 ? "automation needs" : "automations need"} your review`,
                    }),
                    el("button", {
                        class: "btn-auto",
                        type: "button",
                        text: "Review now",
                        onclick: () => {
                            this.filters.view = "needsReview";
                            this.render();
                        },
                    }),
                ),
            );
        }
    }

    private visibleItems(): AutomationSummary[] {
        return sortAutomations(
            filterAutomations(this.items, this.filters),
            this.filters,
        );
    }

    private sortHeader(label: string, key: SortKey) {
        const active = this.filters.sort === key;
        const arrow = active ? (this.filters.sortDescending ? " ▼" : " ▲") : "";
        return el(
            "th",
            {},
            el("button", {
                type: "button",
                text: `${label}${arrow}`,
                onclick: () => {
                    if (active) {
                        this.filters.sortDescending =
                            !this.filters.sortDescending;
                    } else {
                        this.filters.sort = key;
                        this.filters.sortDescending = false;
                    }
                    this.renderList();
                },
            }),
        );
    }

    private renderList() {
        const container = document.getElementById("listContainer")!;
        container.replaceChildren();
        this.renderBulkBar();
        if (this.loading) {
            container.append(
                el("p", {
                    class: "auto-muted",
                    text: "Loading automations...",
                }),
            );
            return;
        }
        const rows = this.visibleItems();
        if (rows.length === 0) {
            container.append(
                el("p", {
                    class: "auto-muted",
                    text:
                        this.items.length === 0
                            ? "No automations yet. They appear here when TypeAgent learns a flow or you record one."
                            : "No automations match the current view and filters.",
                }),
            );
            return;
        }
        const head = el(
            "tr",
            {},
            el("th", {}),
            this.sortHeader("Name", "name"),
            this.sortHeader("Kind", "kind"),
            el("th", { text: "Scope" }),
            this.sortHeader("Status", "status"),
            this.sortHeader("Last run", "lastRun"),
        );
        const body = el("tbody");
        for (const item of rows) body.append(this.renderRow(item));
        container.append(
            el("table", { class: "auto-table" }, el("thead", {}, head), body),
        );
    }

    private renderRow(item: AutomationSummary) {
        const checkbox = el("input", {
            type: "checkbox",
            label: `Select ${item.name}`,
            checked: this.selected.has(item.id),
            onchange: (event) => {
                if ((event.target as HTMLInputElement).checked) {
                    this.selected.add(item.id);
                } else {
                    this.selected.delete(item.id);
                }
                this.renderBulkBar();
            },
        });
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        const row = el(
            "tr",
            {
                selected: this.openId === item.id,
                onclick: () => void this.open(item.id),
            },
            el("td", {}, checkbox),
            el(
                "td",
                {},
                el("div", {
                    class: "auto-name",
                    text:
                        item.version === undefined
                            ? item.name
                            : `${item.name} (v${item.version})`,
                }),
                el("div", { class: "auto-sub", text: item.description }),
            ),
            el(
                "td",
                {},
                el("span", {
                    class: "chip chip-kind",
                    text: KIND_LABELS[item.kind],
                }),
            ),
            el("td", { text: item.scope }),
            el(
                "td",
                {},
                el("span", {
                    class: `chip chip-${item.status}`,
                    text: STATUS_LABELS[item.status],
                }),
            ),
            el("td", { text: formatRelativeTime(item.lastRunAt) }),
        );
        return row;
    }

    private selectedItems(): AutomationSummary[] {
        return this.items.filter((item) => this.selected.has(item.id));
    }

    private renderBulkBar() {
        const bar = document.getElementById("bulkBar")!;
        bar.replaceChildren();
        const items = this.selectedItems();
        bar.hidden = items.length === 0;
        if (items.length === 0) return;
        const verbs = commonVerbs(items);
        bar.append(el("strong", { text: `${items.length} selected` }));
        const actions: { verb: AutomationVerb; label: string }[] = [
            { verb: "approve", label: "Approve" },
            { verb: "disable", label: "Disable" },
            { verb: "delete", label: "Delete" },
        ];
        for (const { verb, label } of actions) {
            if (!verbs.has(verb)) continue;
            bar.append(
                el("button", {
                    class:
                        verb === "delete"
                            ? "btn-auto btn-danger-auto"
                            : "btn-auto",
                    type: "button",
                    text: label,
                    onclick: () => void this.bulk(verb, items),
                }),
            );
        }
        bar.append(
            el("button", {
                class: "btn-auto",
                type: "button",
                text: "Clear",
                onclick: () => {
                    this.selected.clear();
                    this.renderList();
                },
            }),
        );
    }

    private async bulk(verb: AutomationVerb, items: AutomationSummary[]) {
        if (
            verb === "delete" &&
            !(await showConfirmationDialog(
                `Delete ${items.length} automation(s)? This cannot be undone.`,
            ))
        ) {
            return;
        }
        const failures: string[] = [];
        for (const item of items) {
            try {
                await this.runVerb(verb, item.id);
            } catch (error) {
                failures.push(`${item.name}: ${errorMessage(error)}`);
            }
        }
        this.selected.clear();
        if (failures.length > 0) {
            showNotification(failures.join("\n"), "error", 8000);
        } else {
            showNotification(`${items.length} updated`, "success");
        }
        await this.load();
    }

    private runVerb(verb: AutomationVerb, id: string): Promise<unknown> {
        switch (verb) {
            case "approve":
                return invokeView("approveAutomation", { id });
            case "disable":
                return invokeView("disableAutomation", { id });
            case "delete":
                return invokeView("deleteAutomation", { id });
            case "validate":
                return invokeView("validateAutomation", { id });
        }
    }

    private async open(id: string) {
        this.openId = id;
        this.detail = undefined;
        this.validation = undefined;
        this.tab = "overview";
        this.renderList();
        this.renderDetail();
        try {
            const detail = (await invokeView("getAutomation", {
                id,
            })) as AutomationDetail;
            if (this.openId !== id) return;
            this.detail = detail;
            if (detail.capabilities.includes("validate")) {
                this.validation = (await invokeView("validateAutomation", {
                    id,
                })) as AutomationValidationReport;
            }
        } catch (error) {
            if (this.openId !== id) return;
            showNotification(errorMessage(error), "error");
        }
        if (this.openId === id) this.renderDetail();
    }

    private close() {
        this.openId = undefined;
        this.detail = undefined;
        this.renderList();
        this.renderDetail();
    }

    private renderDetail() {
        const panel = document.getElementById("detailPanel")!;
        panel.replaceChildren();
        panel.hidden = this.openId === undefined;
        if (this.openId === undefined) return;
        const summary = this.items.find((item) => item.id === this.openId);
        const detail = this.detail;
        if (!summary) {
            this.close();
            return;
        }
        panel.append(this.renderDetailHead(summary));
        if (!detail) {
            panel.append(
                el(
                    "div",
                    { class: "detail-body" },
                    el("p", { text: "Loading..." }),
                ),
            );
            return;
        }
        panel.append(
            el("div", { class: "detail-body" }, ...this.renderTab(detail)),
        );
        panel.append(this.renderActions(detail));
    }

    private renderDetailHead(summary: AutomationSummary) {
        const tabs = el("div", { class: "detail-tabs", role: "tablist" });
        for (const id of Object.keys(TAB_LABELS) as TabId[]) {
            tabs.append(
                el("button", {
                    type: "button",
                    role: "tab",
                    selected: this.tab === id,
                    text:
                        id === "body" && summary.kind === "toolMacro"
                            ? "Steps"
                            : TAB_LABELS[id],
                    onclick: () => {
                        this.tab = id;
                        this.renderDetail();
                    },
                }),
            );
        }
        return el(
            "div",
            { class: "detail-head" },
            el("button", {
                class: "detail-close",
                type: "button",
                label: "Close details",
                text: "×",
                onclick: () => this.close(),
            }),
            el("h1", {
                text:
                    summary.version === undefined
                        ? summary.name
                        : `${summary.name} (v${summary.version})`,
            }),
            el(
                "div",
                {},
                el("span", {
                    class: "chip chip-kind",
                    text: KIND_LABELS[summary.kind],
                }),
                " ",
                el("span", {
                    class: `chip chip-${summary.status}`,
                    text: STATUS_LABELS[summary.status],
                }),
            ),
            tabs,
        );
    }

    private facts(rows: [string, string][]) {
        const list = el("dl", { class: "facts" });
        for (const [label, value] of rows) {
            list.append(el("dt", { text: label }), el("dd", { text: value }));
        }
        return list;
    }

    private renderTab(detail: AutomationDetail): Node[] {
        switch (this.tab) {
            case "overview":
                return this.overviewTab(detail);
            case "inputs":
                return this.inputsTab(detail);
            case "body":
                return this.bodyTab(detail);
            case "triggers":
                return this.triggersTab(detail);
            case "safety":
                return this.safetyTab(detail);
            case "history":
                return this.historyTab(detail);
        }
    }

    private overviewTab(detail: AutomationDetail): Node[] {
        const nodes: Node[] = [];
        if (detail.capabilities.includes("approve")) {
            nodes.push(el("h3", { text: "Review" }), ...this.validationNodes());
        }
        nodes.push(
            el("h3", { text: "What it does" }),
            el("p", { text: detail.description || "No description." }),
            el("h3", { text: "Details" }),
            this.facts([
                ["Scope", detail.scope],
                ["Origin", detail.origin],
                ...(detail.executionClass
                    ? ([["Execution", detail.executionClass]] as [
                          string,
                          string,
                      ][])
                    : []),
                ["Created", formatRelativeTime(detail.createdAt)],
                ["Last run", formatRelativeTime(detail.lastRunAt)],
                ...(detail.runCount === undefined
                    ? []
                    : ([["Run count", String(detail.runCount)]] as [
                          string,
                          string,
                      ][])),
            ]),
        );
        if (detail.warnings.length > 0) {
            nodes.push(
                el("h3", { text: "Warnings" }),
                el(
                    "ul",
                    {},
                    ...detail.warnings.map((w) => el("li", { text: w })),
                ),
            );
        }
        return nodes;
    }

    private validationNodes(): Node[] {
        const report = this.validation;
        if (!report)
            return [el("p", { class: "auto-muted", text: "Validating..." })];
        const nodes: Node[] = [
            el("p", {
                text: report.valid
                    ? "Validation passed."
                    : "Validation found errors. This version cannot be approved.",
            }),
        ];
        if (report.issues.length > 0) {
            nodes.push(
                el(
                    "ul",
                    {},
                    ...report.issues.map((issue) =>
                        el("li", {
                            class: `issue-${issue.severity}`,
                            text: `${issue.severity}: ${issue.message}${issue.stepId ? ` (${issue.stepId})` : ""}`,
                        }),
                    ),
                ),
            );
        }
        return nodes;
    }

    private inputsTab(detail: AutomationDetail): Node[] {
        if (detail.parameters.length === 0) {
            return [el("p", { class: "auto-muted", text: "No inputs." })];
        }
        return detail.parameters.map((p) =>
            el(
                "div",
                { class: "step" },
                el("div", {
                    class: "step-title",
                    text: `${p.name}: ${p.type}${p.required ? " (required)" : ""}${p.secret ? " (secret)" : ""}`,
                }),
                p.description
                    ? el("div", { class: "auto-muted", text: p.description })
                    : undefined,
            ),
        );
    }

    private bodyTab(detail: AutomationDetail): Node[] {
        const nodes: Node[] = [];
        for (const step of detail.steps) {
            nodes.push(
                el(
                    "div",
                    { class: "step" },
                    el("div", {
                        class: "step-title",
                        text: `${step.id}  ${step.title}`,
                    }),
                    ...step.lines.map((line) => el("div", { text: line })),
                ),
            );
        }
        if (detail.body) {
            nodes.push(
                el("h3", { text: detail.body.language }),
                el("pre", {}, el("code", { text: detail.body.text })),
            );
        }
        if (nodes.length === 0) {
            nodes.push(
                el("p", {
                    class: "auto-muted",
                    text: "No body is stored for this item.",
                }),
            );
        }
        return nodes;
    }

    private triggersTab(detail: AutomationDetail): Node[] {
        if (detail.triggerPhrases.length === 0) {
            return [
                el("p", {
                    class: "auto-muted",
                    text: "No trigger phrases are stored. It can still be run by name.",
                }),
            ];
        }
        return [
            el(
                "ul",
                {},
                ...detail.triggerPhrases.map((p) => el("li", { text: p })),
            ),
        ];
    }

    private safetyTab(detail: AutomationDetail): Node[] {
        if (detail.safety.length === 0) {
            return [
                el("p", {
                    class: "auto-muted",
                    text: "No safety metadata is stored.",
                }),
            ];
        }
        const nodes: Node[] = [
            this.facts(detail.safety.map((f) => [f.label, f.value])),
        ];
        if (detail.kind === "powershell") {
            nodes.push(
                el("p", {
                    class: "auto-muted",
                    text: "These values are stored policy metadata. They are not a security boundary on their own.",
                }),
            );
        }
        return nodes;
    }

    private historyTab(detail: AutomationDetail): Node[] {
        const recorded: [string, string][] = [
            ["Last run", formatRelativeTime(detail.lastRunAt)],
            ...(detail.runCount === undefined
                ? []
                : ([["Run count", String(detail.runCount)]] as [
                      string,
                      string,
                  ][])),
        ];
        return [
            this.facts(recorded),
            el("p", {
                class: "auto-muted",
                text: "Per-run history is not recorded for this kind yet.",
            }),
        ];
    }

    private renderActions(detail: AutomationDetail) {
        const actions = el("div", { class: "detail-actions" });
        const can = (verb: AutomationVerb) =>
            detail.capabilities.includes(verb);
        if (can("delete")) {
            actions.append(
                el("button", {
                    class: "btn-auto btn-danger-auto",
                    type: "button",
                    text:
                        detail.status === "needsReview"
                            ? "Discard draft"
                            : "Delete",
                    onclick: () => void this.single("delete", detail),
                }),
            );
        }
        if (can("disable")) {
            actions.append(
                el("button", {
                    class: "btn-auto",
                    type: "button",
                    text: "Disable",
                    onclick: () => void this.single("disable", detail),
                }),
            );
        }
        if (can("approve")) {
            actions.append(
                el("button", {
                    class: "btn-auto btn-primary-auto",
                    type: "button",
                    text: `Approve${detail.version === undefined ? "" : ` v${detail.version}`}`,
                    disabled:
                        this.validation === undefined || !this.validation.valid,
                    onclick: () => void this.single("approve", detail),
                }),
            );
        }
        return actions;
    }

    private async single(verb: AutomationVerb, detail: AutomationDetail) {
        if (
            verb === "delete" &&
            !(await showConfirmationDialog(
                `Delete "${detail.name}"? This cannot be undone.`,
            ))
        ) {
            return;
        }
        try {
            await this.runVerb(verb, detail.id);
            if (verb === "delete") this.openId = undefined;
            await this.load();
            if (this.openId !== undefined) await this.open(this.openId);
        } catch (error) {
            showNotification(errorMessage(error), "error", 8000);
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    void new AutomationsApp().initialize();
});
