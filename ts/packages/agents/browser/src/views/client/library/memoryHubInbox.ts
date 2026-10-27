// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountFlyout } from "./memoryHubFlyout";
import { rbButton, rbIconButton, rbNode } from "./memoryHubDocumentUi";
import { setTabLabel } from "./memoryHubUi";

export type InboxCategory = "questions" | "views" | "operations";
export interface InboxAttentionCard {
    title: string;
    summary: string;
    detail: HTMLElement;
    entries?: number;
}

const tabIcons: Record<string, string> = {
    all: "fa-inbox",
    questions: "fa-circle-question",
    views: "fa-layer-group",
    operations: "fa-list-check",
};

export function mountMemoryHubInbox(
    host: HTMLElement,
    sections: Array<{
        id: InboxCategory;
        label: string;
        host: HTMLElement;
    }>,
) {
    const root = rbNode("section", undefined, "hub-inbox-workspace");
    const tabs = rbNode("div", undefined, "hub-tabs hub-inbox-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Inbox attention types");
    const overview = rbNode("section");
    const panels = new Map<string, HTMLElement>([["all", overview]]);
    const buttons = new Map<string, HTMLButtonElement>();
    const statuses = new Map<InboxCategory, HTMLElement>();
    const counts = new Map<InboxCategory, { count: number; more: boolean }>();
    const errors = new Map<InboxCategory, string>();
    const cards = new WeakMap<HTMLElement, InboxAttentionCard>();
    const inspector = mountFlyout(host, "Inbox details");
    let selected = "all";

    root.append(tabs, overview);
    for (const section of sections) {
        const panel = rbNode("section");
        const status = rbNode("p");
        status.setAttribute("role", "status");
        statuses.set(section.id, status);
        panel.append(status, section.host);
        panels.set(section.id, panel);
        root.append(panel);
    }
    host.append(root);
    for (const [id, label] of [
        ["all", "All"],
        ...sections.map((section) => [section.id, section.label]),
    ]) {
        const tab = setTabLabel(
            rbButton(label, () => select(id)),
            tabIcons[id],
            label,
        );
        tab.id = `inbox-tab-${id}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", `inbox-panel-${id}`);
        const panel = panels.get(id)!;
        panel.id = `inbox-panel-${id}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        panel.tabIndex = 0;
        buttons.set(id, tab);
        tab.title =
            "Counts cover loaded attention items or groups. + means additional items may be available.";
        tabs.append(tab);
    }
    tabs.addEventListener("keydown", (event) => {
        const keys = [...buttons.keys()];
        const index = keys.indexOf(selected);
        const target =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? keys.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % keys.length
                    : event.key === "ArrowLeft"
                      ? (index + keys.length - 1) % keys.length
                      : undefined;
        if (target === undefined) return;
        event.preventDefault();
        select(keys[target]);
        buttons.get(keys[target])!.focus();
    });

    function select(id: string) {
        inspector.close();
        selected = id;
        for (const [key, tab] of buttons) {
            tab.setAttribute("aria-selected", String(key === id));
            tab.tabIndex = key === id ? 0 : -1;
            panels.get(key)!.hidden = key !== id;
        }
    }
    function formatCount(id: InboxCategory) {
        const value = counts.get(id);
        if (errors.has(id))
            return value?.count ? `${value.count}+; partial` : "unavailable";
        return value ? `${value.count}${value.more ? "+" : ""}` : "...";
    }
    function row(card: InboxAttentionCard) {
        const item = rbNode("article", undefined, "hub-inbox-item");
        item.dataset.entries = String(card.entries ?? 1);
        const content = rbNode("div", undefined, "hub-inbox-item-text");
        content.append(
            rbNode("h4", card.title),
            rbNode(
                "p",
                card.summary.length > 180
                    ? `${card.summary.slice(0, 177)}...`
                    : card.summary,
            ),
        );
        const review = rbIconButton(
            "fa-file-lines",
            `Review: ${card.title}`,
            () =>
                inspector.open({
                    title: card.title,
                    render(body) {
                        body.append(card.detail);
                        return () => card.detail.remove();
                    },
                }),
        );
        item.append(content, review);
        cards.set(item, card);
        return item;
    }
    function renderCategory(section: (typeof sections)[number]) {
        const count = formatCount(section.id);
        const status = statuses.get(section.id)!;
        const value = counts.get(section.id);
        const message = errors.get(section.id);
        section.host.hidden = !value && !message;
        status.setAttribute("role", message ? "alert" : "status");
        status.textContent =
            message ??
            (value
                ? value.more
                    ? "Showing loaded attention groups. Use the paging controls or workspace link for more."
                    : value.count === 0
                      ? "No active attention items on this page."
                      : ""
                : "Loading attention items...");
        status.hidden = !status.textContent;
        setTabLabel(
            buttons.get(section.id)!,
            tabIcons[section.id],
            `${section.label} (${count})`,
        );
        const group = rbNode("section", undefined, "hub-inbox-overview-group");
        const heading = rbNode("div", undefined, "hub-inbox-overview-head");
        heading.append(
            rbNode("h3", `${section.label} (${count})`),
            rbIconButton(
                "fa-list",
                `View all ${section.label.toLowerCase()}`,
                () => {
                    select(section.id);
                    buttons.get(section.id)!.focus();
                },
            ),
        );
        group.append(heading);
        if (message) {
            const error = rbNode("p", message);
            error.setAttribute("role", "alert");
            group.append(error);
        }
        const items =
            value || message
                ? [
                      ...section.host.querySelectorAll<HTMLElement>(
                          ".hub-inbox-item",
                      ),
                  ]
                : [];
        for (const item of items.slice(0, 2)) {
            const card = cards.get(item);
            if (card) group.append(row(card));
        }
        if (!items.length && !message)
            group.append(
                rbNode(
                    "p",
                    counts.has(section.id)
                        ? "No attention items on this page."
                        : "Loading attention items...",
                ),
            );
        return group;
    }
    function render() {
        const restoreTabFocus = overview.contains(document.activeElement);
        const total = [...counts.values()].reduce(
            (sum, value) => sum + value.count,
            0,
        );
        const incomplete =
            counts.size !== sections.length ||
            errors.size > 0 ||
            [...counts.values()].some((value) => value.more);
        setTabLabel(
            buttons.get("all")!,
            tabIcons.all,
            counts.size
                ? `All (${total}${incomplete ? "+" : ""})`
                : "All (...)",
        );
        overview.replaceChildren(...sections.map(renderCategory));
        if (restoreTabFocus) buttons.get(selected)!.focus();
    }
    select("all");
    render();
    return {
        present: row,
        setCount(id: InboxCategory, count: number, more = false) {
            inspector.close();
            counts.set(id, { count, more });
            errors.delete(id);
            render();
        },
        fail(id: InboxCategory, error: unknown) {
            inspector.close();
            errors.set(
                id,
                error instanceof Error ? error.message : String(error),
            );
            render();
        },
        reset() {
            inspector.close();
            counts.clear();
            errors.clear();
            for (const section of sections)
                section.host
                    .querySelectorAll(".hub-inbox-item")
                    .forEach((item) => item.remove());
            select("all");
            render();
        },
        close: inspector.close,
    };
}
