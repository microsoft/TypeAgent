// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AutomationKind,
    AutomationStatus,
    AutomationSummary,
} from "@typeagent/agent-flows/catalog";

export type SmartView =
    | "all"
    | "needsReview"
    | "active"
    | "disabled"
    | "recent";

export type SortKey = "name" | "kind" | "status" | "lastRun";

export interface FilterState {
    search: string;
    view: SmartView;
    kind: AutomationKind | "all";
    scope: string | "all";
    origin: string | "all";
    sort: SortKey;
    sortDescending: boolean;
}

export const defaultFilters: FilterState = {
    search: "",
    view: "all",
    kind: "all",
    scope: "all",
    origin: "all",
    sort: "name",
    sortDescending: false,
};

export const KIND_LABELS: Record<AutomationKind, string> = {
    webflow: "Web macro",
    powershell: "Script",
    taskflow: "Workflow",
    toolMacro: "Tool macro",
};

export const KIND_ORDER: AutomationKind[] = [
    "webflow",
    "powershell",
    "taskflow",
    "toolMacro",
];

export const STATUS_LABELS: Record<AutomationStatus, string> = {
    needsReview: "Needs review",
    active: "Active",
    disabled: "Disabled",
};

const STATUS_RANK: Record<AutomationStatus, number> = {
    needsReview: 0,
    active: 1,
    disabled: 2,
};

const RECENT_DAYS = 7;

export function isKind(value: string | null): value is AutomationKind {
    return value !== null && (KIND_ORDER as readonly string[]).includes(value);
}

function matchesView(
    item: AutomationSummary,
    view: SmartView,
    now: number,
): boolean {
    switch (view) {
        case "all":
            return true;
        case "recent": {
            if (!item.lastRunAt) return false;
            const when = Date.parse(item.lastRunAt);
            return (
                !Number.isNaN(when) &&
                now - when <= RECENT_DAYS * 24 * 60 * 60 * 1000
            );
        }
        default:
            return item.status === view;
    }
}

function matchesSearch(item: AutomationSummary, search: string): boolean {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [item.name, item.description, item.scope, item.origin].some(
        (field) => field.toLowerCase().includes(query),
    );
}

export function filterAutomations(
    items: AutomationSummary[],
    filters: FilterState,
    now = Date.now(),
): AutomationSummary[] {
    return items.filter(
        (item) =>
            matchesView(item, filters.view, now) &&
            (filters.kind === "all" || item.kind === filters.kind) &&
            (filters.scope === "all" || item.scope === filters.scope) &&
            (filters.origin === "all" || item.origin === filters.origin) &&
            matchesSearch(item, filters.search),
    );
}

function compareBy(key: SortKey) {
    return (a: AutomationSummary, b: AutomationSummary): number => {
        switch (key) {
            case "name":
                return a.name.localeCompare(b.name);
            case "kind":
                return (
                    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
                    a.name.localeCompare(b.name)
                );
            case "status":
                return (
                    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
                    a.name.localeCompare(b.name)
                );
            case "lastRun":
                return (
                    (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? "") ||
                    a.name.localeCompare(b.name)
                );
        }
    };
}

export function sortAutomations(
    items: AutomationSummary[],
    filters: Pick<FilterState, "sort" | "sortDescending">,
): AutomationSummary[] {
    const sorted = [...items].sort(compareBy(filters.sort));
    return filters.sortDescending ? sorted.reverse() : sorted;
}

export function countBy<T extends string>(
    items: AutomationSummary[],
    pick: (item: AutomationSummary) => T,
): Map<T, number> {
    const counts = new Map<T, number>();
    for (const item of items) {
        const key = pick(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

export function countView(
    items: AutomationSummary[],
    view: SmartView,
    now = Date.now(),
): number {
    return items.filter((item) => matchesView(item, view, now)).length;
}

export function formatRelativeTime(
    iso: string | undefined,
    now = Date.now(),
): string {
    if (!iso) return "never";
    const when = Date.parse(iso);
    if (Number.isNaN(when)) return "unknown";
    const seconds = Math.max(0, Math.round((now - when) / 1000));
    if (seconds < 60) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

// Bulk actions are offered only when every selected item supports the verb,
// so the page never calls a provider for something it does not do.
export function commonVerbs(
    items: AutomationSummary[],
): Set<AutomationSummary["capabilities"][number]> {
    if (items.length === 0) return new Set();
    const [first, ...rest] = items;
    return new Set(
        first.capabilities.filter((verb) =>
            rest.every((item) => item.capabilities.includes(verb)),
        ),
    );
}
