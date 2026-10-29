// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryHubInboxItem } from "@typeagent/browser-control-rpc/viewRpc";

export const pages = [
    "inbox",
    "search",
    "understanding",
    "library",
    "views",
    "questions",
    "explore",
    "activity",
    "notifications",
    "settings",
] as const;
export type HubPage = (typeof pages)[number];
export type HubRoute = {
    page: HubPage;
    corpusId?: string;
    objectId?: string;
    viewRevisionId?: string;
    viewPageId?: string;
    viewItemKey?: string;
    questionSlotId?: string;
    activityKind?: "view-build";
    webView?: "analytics" | "entities" | "topics";
    webEntity?: string;
    webTopic?: string;
};
export type HiddenItems = Record<
    string,
    { fingerprint: string; until?: number }
>;

function parseViewSelection(
    parts: string[],
): Pick<HubRoute, "viewRevisionId" | "viewPageId" | "viewItemKey"> {
    return {
        ...(parts[3] === "revision" && parts[4]
            ? { viewRevisionId: parts[4] }
            : {}),
        ...(parts[3] === "page" && parts[4]
            ? { viewPageId: parts[4] }
            : parts[5] === "page" && parts[6]
              ? { viewPageId: parts[6] }
              : {}),
        ...(parts[3] === "item" || parts[5] === "item" || parts[7] === "item"
            ? {
                  viewItemKey:
                      parts[
                          parts[3] === "item" ? 4 : parts[5] === "item" ? 6 : 8
                      ],
              }
            : {}),
    };
}

export function parseRoute(hash: string): HubRoute {
    const parts = hash
        .replace(/^#\/?/, "")
        .split("/")
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch (error) {
                console.warn("Invalid Memory deep-link encoding.", error);
                return "";
            }
        });
    const page = pages.find((value) => value === parts[0]) ?? "inbox";
    if (page === "explore" && parts[1] === "web") {
        const webView = (["analytics", "entities", "topics"] as const).find(
            (value) => value === parts[2],
        );
        if (webView) {
            return {
                page,
                webView,
                ...(webView === "entities" && parts[3]
                    ? { webEntity: parts[3] }
                    : {}),
                ...(webView === "topics" && parts[3]
                    ? { webTopic: parts[3] }
                    : {}),
            };
        }
    }
    if (page === "inbox") return { page, objectId: parts[1] || undefined };
    return {
        page,
        corpusId: parts[1] || undefined,
        objectId: parts[2] || undefined,
        ...(page === "views" ? parseViewSelection(parts) : {}),
        ...(page === "questions" && parts[3] === "slot" && parts[4]
            ? { questionSlotId: parts[4] }
            : {}),
        ...(page === "activity" && parts[3] === "view-build"
            ? { activityKind: "view-build" as const }
            : {}),
    };
}

export function routeHash(route: HubRoute): string {
    if (route.page === "explore" && route.webView) {
        const selection =
            route.webView === "entities"
                ? route.webEntity
                : route.webView === "topics"
                  ? route.webTopic
                  : undefined;
        return (
            "#/explore/web/" +
            [route.webView, selection]
                .filter((value) => value !== undefined)
                .map((value) => encodeURIComponent(value!))
                .join("/")
        );
    }
    return (
        "#/" +
        [
            route.page,
            ...(route.page === "inbox"
                ? [route.objectId]
                : [
                      route.corpusId,
                      route.objectId,
                      ...(route.page === "questions" && route.questionSlotId
                          ? ["slot", route.questionSlotId]
                          : []),
                      ...(route.page === "views" && route.viewRevisionId
                          ? ["revision", route.viewRevisionId]
                          : []),
                      ...(route.page === "views" && route.viewPageId
                          ? ["page", route.viewPageId]
                          : []),
                      ...(route.page === "views" && route.viewItemKey
                          ? ["item", route.viewItemKey]
                          : []),
                      ...(route.page === "activity" && route.activityKind
                          ? [route.activityKind]
                          : []),
                  ]),
        ]
            .filter((value) => value !== undefined)
            .map((value) => encodeURIComponent(value!))
            .join("/")
    );
}

export function isHidden(
    item: MemoryHubInboxItem,
    hidden: HiddenItems,
    now = Date.now(),
): boolean {
    const state = hidden[item.id];
    return (
        state?.fingerprint === item.fingerprint &&
        (state.until === undefined || state.until > now)
    );
}

export function inboxItems(
    items: MemoryHubInboxItem[],
    hidden: HiddenItems,
    options: {
        corpusId?: string;
        kind?: string;
        dismissed?: boolean;
        group?: string;
    } = {},
    now = Date.now(),
): MemoryHubInboxItem[] {
    return items
        .filter(
            (item) =>
                (!options.corpusId || item.corpusId === options.corpusId) &&
                (!options.kind || item.kind === options.kind) &&
                isHidden(item, hidden, now) === Boolean(options.dismissed),
        )
        .sort((a, b) => {
            const group =
                options.group === "corpus"
                    ? a.corpusName.localeCompare(b.corpusName)
                    : options.group === "kind"
                      ? a.kind.localeCompare(b.kind)
                      : 0;
            return (
                group ||
                (a.severity === b.severity
                    ? 0
                    : a.severity === "attention"
                      ? -1
                      : 1) ||
                a.updatedAt.localeCompare(b.updatedAt) ||
                a.id.localeCompare(b.id)
            );
        });
}

export function inboxCounts(
    items: MemoryHubInboxItem[],
    hidden: HiddenItems,
    corpusId?: string,
    now = Date.now(),
) {
    const visible = inboxItems(items, hidden, { corpusId }, now);
    return {
        inbox: visible.length,
        failedJobs: items.filter(
            (item) =>
                item.kind === "job" &&
                item.jobState === "failed" &&
                (!corpusId || item.corpusId === corpusId),
        ).length,
    };
}

export function readHidden(value: string | null): HiddenItems {
    try {
        const parsed: unknown = JSON.parse(value ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("Expected an Inbox preference object.");
        const entries = Object.entries(parsed);
        const valid = entries.filter(
            ([, state]) =>
                state &&
                typeof state === "object" &&
                typeof state.fingerprint === "string" &&
                (state.until === undefined ||
                    (typeof state.until === "number" &&
                        Number.isFinite(state.until))),
        );
        if (valid.length !== entries.length)
            console.warn("Ignored invalid Memory Inbox preference entries.");
        return Object.fromEntries(valid);
    } catch (error) {
        console.warn("Could not restore Memory Inbox preferences.", error);
        return {};
    }
}
