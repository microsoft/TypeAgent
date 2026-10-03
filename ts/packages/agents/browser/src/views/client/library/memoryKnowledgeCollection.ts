// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgePage,
} from "@typeagent/browser-control-rpc/viewRpc";
import "./memoryKnowledgeCollection.css";

export const KNOWLEDGE_PREVIEW_SIZE = 6;
export const KNOWLEDGE_PAGE_SIZE = 24;
let nextId = 0;
type PageRequest = {
    offset: number;
    pageSize: number;
    query: string;
    sort: "name" | "mentions";
};
export type KnowledgeCollectionOptions = {
    title: string;
    items: MemoryHubKnowledgeItem[];
    total?: number;
    loadPage?: (request: PageRequest) => Promise<MemoryHubKnowledgePage>;
    onSelect?: (item: MemoryHubKnowledgeItem) => void;
    onError: (error: unknown) => void;
    itemClass?: string;
    renderSources?: (
        host: HTMLElement,
        item: MemoryHubKnowledgeItem,
        signal: AbortSignal,
    ) => void | (() => void);
};

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    className?: string,
) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(text: string) {
    const node = element("button", text);
    node.type = "button";
    return node;
}
function itemTitle(item: MemoryHubKnowledgeItem) {
    if (item.mentions === undefined) return item.title;
    return `${item.title} · ${item.mentions} mention${item.mentions === 1 ? "" : "s"}`;
}

export function mountKnowledgeCollection(
    host: HTMLElement,
    options: KnowledgeCollectionOptions,
) {
    const root = element("section", undefined, "knowledge-collection");
    const heading = element("h3", options.title);
    const toggle = button(`View all ${options.title.toLowerCase()}`);
    const header = element("div", undefined, "knowledge-collection-header");
    header.append(heading, toggle);
    const form = element("form", undefined, "knowledge-filters");
    form.hidden = true;
    const label = element("label", `Filter ${options.title.toLowerCase()}`);
    const queryInput = element("input");
    queryInput.type = "search";
    queryInput.maxLength = 512;
    queryInput.placeholder = "Filter by name or type…";
    label.append(queryInput);
    const sortLabel = element("label", "Sort");
    const sortInput = element("select");
    for (const [value, text] of [
        ["mentions", "Most mentions"],
        ["name", "Name"],
    ]) {
        const option = element("option", text);
        option.value = value;
        sortInput.append(option);
    }
    sortLabel.append(sortInput);
    const apply = button("Apply filter");
    apply.type = "submit";
    form.append(label, sortLabel, apply);
    const status = element("p", undefined, "knowledge-collection-status");
    status.setAttribute("role", "status");
    const warning = element("p", undefined, "knowledge-collection-warning");
    warning.hidden = true;
    const grid = element("div", undefined, "knowledge-cards");
    grid.id = `knowledge-collection-${++nextId}`;
    grid.tabIndex = 0;
    grid.setAttribute("role", "region");
    grid.setAttribute("aria-label", options.title);
    toggle.setAttribute("aria-controls", grid.id);
    const pagination = element("div", undefined, "knowledge-pagination");
    const previous = button("Previous");
    const next = button("Next");
    const pageLabel = element("span");
    previous.setAttribute("aria-label", `${options.title} previous page`);
    next.setAttribute("aria-label", `${options.title} next page`);
    pagination.append(previous, pageLabel, next);
    root.append(header, form, status, warning, grid, pagination);
    host.append(root);
    const listeners = new AbortController();
    let rowListeners = new AbortController();
    let rowDisposers: Array<() => void> = [];
    let expanded = false;
    let disposed = false;
    let generation = 0;
    let offset = 0;
    let query = "";
    let sort: "name" | "mentions" = "mentions";
    let total = options.total ?? options.items.length;
    let loading = false;

    function controls() {
        root.dataset.expanded = String(expanded);
        toggle.textContent = expanded
            ? "Back to preview"
            : `View all ${options.title.toLowerCase()}`;
        toggle.setAttribute("aria-expanded", String(expanded));
        form.hidden = !expanded;
        pagination.hidden = !expanded;
        previous.disabled = loading || offset === 0;
        next.disabled = loading || offset + KNOWLEDGE_PAGE_SIZE >= total;
        pageLabel.textContent = `Page ${Math.floor(offset / KNOWLEDGE_PAGE_SIZE) + 1} of ${Math.max(1, Math.ceil(total / KNOWLEDGE_PAGE_SIZE))}`;
    }
    function render(items: MemoryHubKnowledgeItem[]) {
        clearRows();
        rowListeners = new AbortController();
        grid.replaceChildren();
        for (const item of items) {
            const card = element(
                "article",
                undefined,
                "knowledge-item analytics-recent-item",
            );
            const title = element(
                options.onSelect ? "button" : "h4",
                itemTitle(item),
                `knowledge-item-title ${options.itemClass ?? ""}`,
            );
            if (title instanceof HTMLButtonElement) {
                title.type = "button";
                title.addEventListener(
                    "click",
                    () => options.onSelect?.(item),
                    { signal: rowListeners.signal },
                );
            }
            card.append(title);
            if (item.subtitle)
                card.append(element("p", item.subtitle, "knowledge-item-meta"));
            if (item.sources.length)
                card.append(
                    element(
                        "p",
                        `${item.sources.length} contributing source${item.sources.length === 1 ? "" : "s"}`,
                        "knowledge-item-meta",
                    ),
                );
            const disposeSources = options.renderSources?.(
                card,
                item,
                rowListeners.signal,
            );
            if (disposeSources) rowDisposers.push(disposeSources);
            grid.append(card);
        }
        if (!items.length)
            grid.append(
                element(
                    "p",
                    expanded
                        ? warning.hidden
                            ? "No matching items."
                            : "Knowledge unavailable or incomplete."
                        : "No entries returned.",
                    "knowledge-empty",
                ),
            );
        grid.scrollTop = 0;
        status.textContent = statusText(items.length);
        controls();
    }
    function statusText(length: number) {
        if (!expanded) return `Previewing ${length} of ${total} items`;
        const start = length ? offset + 1 : 0;
        const end = length ? offset + length : 0;
        return `${start}–${end} of ${total} matching items${warning.hidden ? "" : " · partial results"}`;
    }
    function preview() {
        warning.hidden = true;
        render(options.items.slice(0, KNOWLEDGE_PREVIEW_SIZE));
    }
    function clearRows() {
        rowListeners.abort();
        rowDisposers.forEach((dispose) => dispose());
        rowDisposers = [];
    }
    async function load() {
        const ticket = ++generation;
        loading = true;
        status.textContent = "Loading knowledge…";
        warning.hidden = true;
        grid.setAttribute("aria-busy", "true");
        grid.replaceChildren();
        clearRows();
        controls();
        try {
            const page = options.loadPage
                ? await options.loadPage({
                      offset,
                      pageSize: KNOWLEDGE_PAGE_SIZE,
                      query,
                      sort,
                  })
                : localPage();
            if (disposed || ticket !== generation) return;
            if (
                !Number.isSafeInteger(page.total) ||
                page.total < 0 ||
                !Array.isArray(page.items) ||
                page.items.length > KNOWLEDGE_PAGE_SIZE ||
                !Array.isArray(page.errors)
            )
                throw new Error("Invalid knowledge page response.");
            total = page.total;
            if (offset > 0 && offset >= total) {
                offset = total
                    ? Math.floor((total - 1) / KNOWLEDGE_PAGE_SIZE) *
                      KNOWLEDGE_PAGE_SIZE
                    : 0;
                if (total) {
                    await load();
                    return;
                }
            }
            warning.hidden = !page.errors.length;
            warning.textContent = page.errors.length
                ? `Partial results: ${page.errors.map((error) => `${error.corpusId}: ${error.message}`).join("; ")}`
                : "";
            loading = false;
            render(page.items);
        } catch (error) {
            if (disposed || ticket !== generation) return;
            loading = false;
            status.textContent = `Knowledge unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
            controls();
        } finally {
            if (!disposed && ticket === generation)
                grid.removeAttribute("aria-busy");
        }
    }
    function localPage(): MemoryHubKnowledgePage {
        const matches = options.items.filter((item) =>
            `${item.title} ${item.subtitle ?? ""}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
        );
        matches.sort(
            (a, b) =>
                (sort === "mentions"
                    ? (b.mentions ?? 0) - (a.mentions ?? 0)
                    : 0) ||
                a.title.localeCompare(b.title) ||
                a.id.localeCompare(b.id),
        );
        return {
            items: matches.slice(offset, offset + KNOWLEDGE_PAGE_SIZE),
            total: matches.length,
            errors: [],
        };
    }
    toggle.addEventListener(
        "click",
        () => {
            expanded = !expanded;
            generation++;
            offset = 0;
            if (expanded) void load();
            else {
                loading = false;
                total = options.total ?? options.items.length;
                grid.removeAttribute("aria-busy");
                preview();
            }
        },
        { signal: listeners.signal },
    );
    form.addEventListener(
        "submit",
        (event) => {
            event.preventDefault();
            query = queryInput.value.trim();
            sort = sortInput.value === "name" ? "name" : "mentions";
            offset = 0;
            void load();
        },
        { signal: listeners.signal },
    );
    previous.addEventListener(
        "click",
        () => {
            offset = Math.max(0, offset - KNOWLEDGE_PAGE_SIZE);
            void load();
        },
        { signal: listeners.signal },
    );
    next.addEventListener(
        "click",
        () => {
            offset += KNOWLEDGE_PAGE_SIZE;
            void load();
        },
        { signal: listeners.signal },
    );
    preview();
    return {
        dispose() {
            disposed = true;
            generation++;
            listeners.abort();
            clearRows();
            root.remove();
        },
    };
}
