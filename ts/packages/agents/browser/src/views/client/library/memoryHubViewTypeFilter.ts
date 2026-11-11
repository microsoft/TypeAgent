// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewKind } from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { menuButton, setTabLabel, type MenuItem } from "./memoryHubUi";

export type ViewTypeOption = {
    kind?: ViewKind;
    label: string;
    icon: string;
};

export async function findPopulatedViewKinds(
    corpusIds: string[],
    kinds: ViewKind[],
    knownKinds: ReadonlySet<ViewKind>,
): Promise<Set<ViewKind>> {
    const found = await Promise.all(
        kinds.map(async (kind) => {
            if (knownKinds.has(kind)) return kind;
            const pages = await Promise.all(
                corpusIds.map((corpusId) =>
                    invokeMemory("memoryListViewSummaries", {
                        corpusId,
                        kind,
                        includeDrafts: true,
                        pageSize: 1,
                    }),
                ),
            );
            return pages.some((page) =>
                page.items.some((view) => view.content.kind === kind),
            )
                ? kind
                : undefined;
        }),
    );
    return new Set(
        found.filter((kind): kind is ViewKind => kind !== undefined),
    );
}

export function createViewTypeFilter(
    options: ViewTypeOption[],
    populated: ReadonlySet<ViewKind>,
    initialKind: ViewKind | undefined,
    onSelect: (kind: ViewKind | undefined) => void,
) {
    const element = document.createElement("div");
    element.className = "hub-tabs hub-view-type-tabs";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Filter view type");
    let selected = initialKind;
    const items: MenuItem[] = [];
    const overflow = menuButton(
        "More view types",
        items,
        "fa-ellipsis-vertical",
    );
    const trigger = overflow.querySelector<HTMLButtonElement>("button")!;
    const tabs = options
        .filter((option) => !option.kind || populated.has(option.kind))
        .map((option) => {
            const button = document.createElement("button");
            button.type = "button";
            setTabLabel(button, option.icon, option.label);
            button.setAttribute(
                "aria-pressed",
                String(option.kind === selected),
            );
            button.onclick = () => select(option.kind);
            element.append(button);
            return { option, button };
        });
    element.append(overflow);

    function select(kind: ViewKind | undefined): void {
        selected = kind;
        for (const tab of tabs)
            tab.button.setAttribute(
                "aria-pressed",
                String(tab.option.kind === kind),
            );
        layout();
        (
            tabs.find((tab) => tab.option.kind === kind && !tab.button.hidden)
                ?.button ?? trigger
        ).focus();
        onSelect(kind);
    }

    function closeMenu(): void {
        if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
    }

    function layout(): void {
        const active = document.activeElement;
        const menuFocused = overflow.contains(active);
        closeMenu();
        for (const tab of tabs) tab.button.hidden = false;
        overflow.hidden = false;
        const width = element.getBoundingClientRect().width;
        const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
        const widths = new Map(
            tabs.map((tab) => [tab, tab.button.getBoundingClientRect().width]),
        );
        const required = [...widths.values()].reduce(
            (sum, value) => sum + value + gap,
            -gap,
        );
        const needsMenu = options.length > tabs.length || required > width;
        let remaining =
            width -
            (needsMenu ? overflow.getBoundingClientRect().width + gap : 0);
        const priority = [
            ...tabs.filter((tab) => !tab.option.kind),
            ...tabs.filter(
                (tab) => tab.option.kind && tab.option.kind === selected,
            ),
            ...tabs.filter(
                (tab) => tab.option.kind && tab.option.kind !== selected,
            ),
        ];
        for (const tab of priority) {
            const size = widths.get(tab)!;
            tab.button.hidden = width > 0 && size > remaining;
            if (!tab.button.hidden) remaining -= size + gap;
        }
        const visible = new Set(
            tabs.filter((tab) => !tab.button.hidden).map((tab) => tab.option),
        );
        items.splice(
            0,
            items.length,
            ...options
                .filter((option) => !visible.has(option))
                .map((option) => ({
                    label: option.label,
                    icon: option.icon,
                    checked: option.kind === selected,
                    action: () => select(option.kind),
                })),
        );
        overflow.hidden = !items.length;
        const selectedInMenu = items.find((item) => item.checked);
        const label = selectedInMenu
            ? `More view types, ${selectedInMenu.label} selected`
            : "More view types";
        trigger.setAttribute("aria-label", label);
        trigger.title = label;
        trigger.setAttribute("aria-pressed", String(!!selectedInMenu));
        if (
            menuFocused ||
            tabs.some((tab) => tab.button === active && tab.button.hidden)
        )
            (overflow.hidden
                ? (
                      tabs.find(
                          (tab) =>
                              tab.option.kind === selected &&
                              !tab.button.hidden,
                      ) ?? tabs.find((tab) => !tab.button.hidden)
                  )?.button
                : trigger
            )?.focus();
    }

    function navigateMenu(event: KeyboardEvent): void {
        const entries = [
            ...overflow.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
            ),
        ];
        if (
            !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
            (!entries.length && event.target !== trigger)
        )
            return;
        event.preventDefault();
        if (!entries.length) {
            trigger.click();
            if (event.key === "ArrowUp" || event.key === "End")
                overflow
                    .querySelector<HTMLButtonElement>(
                        '[role="menuitemradio"]:last-child',
                    )
                    ?.focus();
            return;
        }
        const current = entries.findIndex(
            (entry) => entry === document.activeElement,
        );
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? entries.length - 1
                  : (current +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        entries.length) %
                    entries.length;
        entries[next].focus();
    }
    overflow.addEventListener("keydown", navigateMenu);
    const observer =
        typeof ResizeObserver === "undefined"
            ? undefined
            : new ResizeObserver(layout);
    observer?.observe(element);
    if (!observer) window.addEventListener("resize", layout);
    document.fonts?.addEventListener("loadingdone", layout);
    return {
        element,
        layout,
        dispose() {
            closeMenu();
            observer?.disconnect();
            window.removeEventListener("resize", layout);
            document.fonts?.removeEventListener("loadingdone", layout);
        },
    };
}
