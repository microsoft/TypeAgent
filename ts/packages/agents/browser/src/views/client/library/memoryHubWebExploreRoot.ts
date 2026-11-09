// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubWebExploreOptions,
    MemoryHubWebExploreRequest,
} from "./memoryHubWebExplore";

export interface WebExploreCallbacks extends MemoryHubWebExploreOptions {
    onNavigate: (request: MemoryHubWebExploreRequest) => void;
}

export class WebExploreRoot {
    private listeners = new AbortController();
    private generation = 0;
    private alive = true;

    constructor(
        readonly root: HTMLElement,
        readonly callbacks: MemoryHubWebExploreOptions,
    ) {}

    get signal(): AbortSignal {
        return this.listeners.signal;
    }

    element<T extends HTMLElement = HTMLElement>(selector: string): T {
        const value = this.root.querySelector<T>(selector);
        if (!value)
            throw new Error(`Web exploration template is missing ${selector}`);
        return value;
    }

    listen<K extends keyof HTMLElementEventMap>(
        element: HTMLElement,
        type: K,
        listener: (event: HTMLElementEventMap[K]) => void,
    ): void {
        element.addEventListener(type, listener, {
            signal: this.listeners.signal,
        });
    }

    begin(): number {
        return ++this.generation;
    }

    current(ticket: number): boolean {
        return this.alive && ticket === this.generation;
    }

    error(error: unknown): void {
        if (!this.alive) return;
        const alert =
            this.root.querySelector<HTMLElement>("[data-web-error]") ??
            this.root
                .closest(".memory-web-explore")
                ?.querySelector<HTMLElement>("[data-web-error]");
        if (alert) {
            alert.hidden = false;
            alert.textContent = `Web exploration unavailable: ${error instanceof Error ? error.message : String(error)}`;
        }
        this.callbacks.onError(error);
    }

    clearError(): void {
        const alert =
            this.root.querySelector<HTMLElement>("[data-web-error]") ??
            this.root
                .closest(".memory-web-explore")
                ?.querySelector<HTMLElement>("[data-web-error]");
        if (alert) {
            alert.hidden = true;
            alert.textContent = "";
        }
    }

    async run(action: () => void | Promise<void>): Promise<void> {
        try {
            await action();
        } catch (error) {
            this.error(error);
        }
    }

    destroy(): void {
        this.alive = false;
        this.generation++;
        this.listeners.abort();
    }
}

export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid web exploration service response");
    return value as Record<string, unknown>;
}

export function detailsFromResponse(value: unknown): Record<string, unknown> {
    const response = record(value);
    if (response.success !== true || !response.details)
        throw new Error(String(response.error ?? "Details are unavailable"));
    return record(response.details);
}

export interface WebGraphElement {
    data: Record<string, unknown> &
        ({ id: string } | { id?: string; source: string; target: string });
    position?: { x: number; y: number };
}

export function layoutFromResponse(value: unknown): {
    presetLayout: {
        elements: WebGraphElement[];
        metadata?: Record<string, unknown>;
    };
} {
    const response = record(value);
    if (response.error || response.success === false)
        throw new Error(String(response.error ?? "Graph request failed"));
    const layout = record(response.graphologyLayout);
    if (!Array.isArray(layout.elements))
        throw new Error("Graph layout elements are unavailable");
    const elements = layout.elements.map((value: unknown) => {
        const element = record(value);
        const data = record(element.data);
        let elementData: WebGraphElement["data"];
        if (data.source !== undefined || data.target !== undefined) {
            if (
                typeof data.source !== "string" ||
                !data.source ||
                typeof data.target !== "string" ||
                !data.target
            )
                throw new Error("Graph edge is missing valid endpoints");
            if (
                data.id !== undefined &&
                (typeof data.id !== "string" || !data.id)
            )
                throw new Error("Graph edge has an invalid id");
            elementData = {
                ...data,
                source: data.source,
                target: data.target,
                ...(data.id === undefined ? {} : { id: data.id }),
            };
        } else {
            if (typeof data.id !== "string" || !data.id)
                throw new Error("Graph node is missing its id");
            elementData = { ...data, id: data.id };
        }
        const result: WebGraphElement = { data: elementData };
        if (element.position !== undefined) {
            const position = record(element.position);
            if (
                typeof position.x !== "number" ||
                typeof position.y !== "number" ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y)
            )
                throw new Error("Graph element has invalid coordinates");
            result.position = { x: position.x, y: position.y };
        }
        return result;
    });
    return {
        presetLayout: {
            elements,
            metadata:
                response.metadata === undefined
                    ? undefined
                    : record(response.metadata),
        },
    };
}

export function safeWebUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const url = new URL(value);
        if (url.protocol === "https:" || url.protocol === "http:")
            return url.href;
    } catch {
        // Invalid URLs are displayed as text, never navigated.
    }

    return undefined;
}

export function escapeWebText(value: unknown): string {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character]!,
    );
}

export function validateAnalyticsResponse(value: unknown): void {
    const data = record(value);
    const overview = record(data.overview);
    if (
        overview.topDomains !== undefined &&
        (typeof overview.topDomains !== "number" ||
            !Number.isFinite(overview.topDomains))
    )
        throw new Error("Analytics domain count is invalid");
    for (const key of [
        "totalSites",
        "totalBookmarks",
        "totalHistory",
        "knowledgeExtracted",
    ]) {
        if (
            typeof overview[key] !== "number" ||
            !Number.isFinite(overview[key])
        )
            throw new Error(`Analytics overview is missing ${key}`);
    }
    const knowledge = record(data.knowledge);
    for (const key of [
        "totalEntities",
        "totalTopics",
        "totalActions",
        "totalRelationships",
    ]) {
        if (typeof knowledge[key] !== "number")
            throw new Error(`Analytics knowledge is missing ${key}`);
    }
    if (
        !Array.isArray(record(data.domains).topDomains) ||
        !Array.isArray(record(data.activity).trends)
    )
        throw new Error("Analytics domain or activity data is unavailable");
    if (data.analytics !== undefined) {
        const diagnostics = record(data.analytics);
        if (
            diagnostics.extractionMetrics === null ||
            diagnostics.qualityReport === null
        )
            throw new Error(
                "Browser memory analytics service failed to load extraction or quality data",
            );
    }
    validateAnalyticsNumbers(data);
}

const numericAnalyticsFields = new Set([
    "totalSites",
    "totalBookmarks",
    "totalHistory",
    "knowledgeExtracted",
    "visits",
    "bookmarks",
    "totalActivity",
    "averagePerDay",
    "count",
    "percentage",
    "totalEntities",
    "totalTopics",
    "totalActions",
    "totalRelationships",
    "entityProgress",
    "topicProgress",
    "actionProgress",
    "highQuality",
    "mediumQuality",
    "lowQuality",
    "confidence",
    "value",
    "change",
]);

function validateAnalyticsNumbers(value: unknown): void {
    if (Array.isArray(value)) {
        value.forEach(validateAnalyticsNumbers);
    } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
            if (
                numericAnalyticsFields.has(key) &&
                (typeof child !== "number" || !Number.isFinite(child))
            )
                throw new Error(
                    `Analytics field ${key} is not a finite number`,
                );
            validateAnalyticsNumbers(child);
        }
    }
}

export function renderSources(
    container: HTMLElement,
    values: unknown,
    callbacks: MemoryHubWebExploreOptions,
    signal?: AbortSignal,
): void {
    container.replaceChildren();
    if (!Array.isArray(values)) return;
    for (const value of values) {
        const source =
            typeof value === "string"
                ? { url: value, title: value }
                : record(value);
        const url = safeWebUrl(source.url ?? source.fromPage);
        const label = String(
            source.title ?? source.url ?? source.fromPage ?? "Source",
        );
        if (!url) {
            const text = document.createElement("span");
            text.textContent = label;
            container.append(text);
            continue;
        }
        const link = document.createElement("a");
        link.textContent = label;
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        if (callbacks.onOpenSource)
            link.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                    callbacks.onOpenSource!(url);
                },
                { signal },
            );
        container.append(link);
    }
}

export function downloadGraph(value: unknown, filename: string): void {
    if (!value) throw new Error("Graph data is unavailable for export");
    // JSON remains data even when an exported label is later embedded in HTML.
    const json = JSON.stringify(value, null, 2)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");
    const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
    );
    try {
        downloadImage(url, filename);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function downloadImage(url: string, filename: string): void {
    if (
        !url.startsWith("blob:") &&
        !url.startsWith("data:image/png") &&
        !url.startsWith("data:image/jpeg")
    )
        throw new Error("Graph image is unavailable for export");
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
}
