// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type cytoscape from "cytoscape";
import { mountMemoryHubWebExplore } from "./memoryHubWebExplore";
import { invokeView } from "./viewClient";
import {
    downloadGraph,
    layoutFromResponse,
    renderSources,
} from "./memoryHubWebExploreRoot";

jest.mock("./memoryHubWebExplore.css", () => ({}));
jest.mock("./memoryKnowledgeCollection.css", () => ({}));
jest.mock(
    "./memoryHubWebExploreAnalytics.html?raw",
    () =>
        require("node:fs").readFileSync(
            require("node:path").resolve(
                __dirname,
                "memoryHubWebExploreAnalytics.html",
            ),
            "utf8",
        ),
    { virtual: true },
);
jest.mock(
    "./memoryHubWebExploreEntities.html?raw",
    () =>
        require("node:fs").readFileSync(
            require("node:path").resolve(
                __dirname,
                "memoryHubWebExploreEntities.html",
            ),
            "utf8",
        ),
    { virtual: true },
);
jest.mock(
    "./memoryHubWebExploreTopics.html?raw",
    () =>
        require("node:fs").readFileSync(
            require("node:path").resolve(
                __dirname,
                "memoryHubWebExploreTopics.html",
            ),
            "utf8",
        ),
    { virtual: true },
);
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));

const mockCores: cytoscape.Core[] = [];
jest.mock("cytoscape", () => {
    const actual = jest.requireActual("cytoscape");
    return {
        __esModule: true,
        default: (options: cytoscape.CytoscapeOptions) => {
            const core = actual({
                ...options,
                container: undefined,
                renderer: undefined,
                headless: true,
                styleEnabled: true,
            });
            mockCores.push(core);
            return core;
        },
    };
});

const invoke = invokeView as jest.Mock;
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubWebExplore>;
let onError: jest.Mock;
let onRouteChanged: jest.Mock;
let onOpenSource: jest.Mock;
let createObjectURL: jest.Mock;
let revokeObjectURL: jest.Mock;

const entityName = 'Worker "<img src=x onerror=alert(1)>';
const topicName = "Operations";

function graph(topics = false) {
    const data = topics
        ? {
              id: topicName,
              label: topicName,
              nodeType: "topic",
              level: 2,
              confidence: 1,
              keywords: ["ops"],
              color: "#667eea",
              size: 40,
          }
        : {
              id: entityName,
              name: entityName,
              type: "service",
              confidence: 1,
              color: "#667eea",
              size: 40,
          };
    return {
        graphologyLayout: {
            elements: [{ data, position: { x: 10, y: 20 } }],
            layoutDuration: 3,
            avgSpacing: 50,
            communityCount: 1,
        },
        metadata: { layer: "importance" },
    };
}

function analytics() {
    return {
        overview: {
            totalSites: 12,
            totalBookmarks: 8,
            totalHistory: 4,
            knowledgeExtracted: 10,
            topDomains: 1,
        },
        domains: {
            topDomains: [
                {
                    domain: "<img src=x onerror=alert(1)>",
                    count: 12,
                    percentage: 100,
                },
            ],
            totalSites: 12,
        },
        knowledge: {
            totalEntities: 7,
            totalTopics: 2,
            totalActions: 1,
            totalRelationships: 3,
            qualityDistribution: {
                highQuality: 80,
                mediumQuality: 15,
                lowQuality: 5,
            },
            extractionProgress: {
                entityProgress: 90,
                topicProgress: 50,
                actionProgress: 25,
            },
            recentEntities: [
                {
                    name: entityName,
                    type: "service",
                    fromPage: "https://example.com/worker",
                    extractedAt: "2026-10-01",
                },
            ],
            recentTopics: [
                {
                    name: topicName,
                    fromPage: "https://example.com/ops",
                    extractedAt: "2026-10-01",
                },
            ],
            recentRelationships: [
                {
                    from: entityName,
                    relationship: "reads",
                    to: "Queue",
                    confidence: 1,
                    fromPage: "https://example.com/worker",
                    extractedAt: "2026-10-01",
                },
            ],
        },
        activity: {
            trends: [{ date: "2026-10-01", visits: 4, bookmarks: 8 }],
            summary: {
                totalActivity: 12,
                peakDay: "2026-10-01",
                averagePerDay: 12,
                timeRange: "30d",
            },
            analytics: {
                extractionMetrics: {
                    totalExtractions: 12,
                    successRate: 100,
                    averageProcessingTime: 0,
                    modes: { content: 12 },
                },
                qualityReport: {
                    overallQuality: "excellent",
                    averageConfidence: 1,
                    totalItems: 12,
                    qualityDistribution: {
                        excellent: 12,
                        good: 0,
                        fair: 0,
                        poor: 0,
                    },
                },
            },
        },
    };
}

function respond(operation: string) {
    switch (operation) {
        case "getAnalyticsData":
            return analytics();
        case "getGlobalImportanceLayer":
        case "getEntityNeighborhoodLayoutData":
            return graph();
        case "getTopicImportanceLayer":
            return graph(true);
        case "getEntityDetails":
            return {
                success: true,
                details: {
                    name: entityName,
                    type: "service",
                    confidence: 1,
                    count: 7,
                    degree: 3,
                    topicAffinity: [topicName],
                    websites: [
                        "https://example.com/worker",
                        "javascript:alert(1)",
                    ],
                    firstSeen: "2026-09-01",
                    lastSeen: "2026-10-01",
                },
            };
        case "getTopicDetails":
            return {
                success: true,
                details: {
                    topicId: topicName,
                    topicName,
                    level: 2,
                    confidence: 1,
                    keywords: ["ops"],
                    entityReferences: [entityName],
                    firstSeen: "2026-09-01",
                    lastSeen: "2026-10-01",
                },
            };
        case "getTopicTimelines":
            return {
                success: true,
                timelines: [
                    {
                        topicName,
                        activities: [
                            {
                                url: "https://example.com/ops",
                                title: "Operations source",
                                timestamp: "2026-10-01",
                                activityType: "visit",
                                domain: "example.com",
                                relevance: 1,
                            },
                        ],
                    },
                ],
            };
        case "searchWebMemories":
            return {
                websites: [
                    {
                        url: "https://example.com/worker",
                        title: "Worker source",
                        domain: "example.com",
                        source: "history",
                        snippet: "<img src=x> handles operations",
                    },
                ],
                answer: "Worker handles operations",
                answerSources: [
                    {
                        url: "https://example.com/worker",
                        title: "Worker source",
                        relevance: 1,
                    },
                ],
            };
        default:
            throw new Error(`Unsupported operation: ${operation}`);
    }
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
    const value = host.querySelector<T>(selector);
    if (!value) throw new Error(`Missing ${selector}`);
    return value;
}

function click(id: string): void {
    element<HTMLButtonElement>(`#${id}`).click();
}

async function settle(): Promise<void> {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

beforeEach(() => {
    invoke
        .mockReset()
        .mockImplementation(async (operation: string) => respond(operation));
    mockCores.length = 0;
    onError = jest.fn();
    onRouteChanged = jest.fn();
    onOpenSource = jest.fn();
    createObjectURL = jest.fn(() => "blob:graph");
    revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeObjectURL,
    });
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => {},
    );
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "time").mockImplementation(() => {});
    jest.spyOn(console, "timeEnd").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.append(host);
    mounted = mountMemoryHubWebExplore(host, {
        onError,
        onRouteChanged,
        onOpenSource,
    });
});

afterEach(() => {
    mounted.dispose();
    host.remove();
    window.history.replaceState({}, "", "/");
    jest.restoreAllMocks();
});

test.each(["entities", "topics"] as const)(
    "%s accepts the Graphology converter's edges without explicit ids",
    async (view) => {
        const response = graph(view === "topics");
        const node = response.graphologyLayout.elements[0];
        const peerId = `${node.data.id}-peer`;
        invoke.mockResolvedValueOnce({
            ...response,
            graphologyLayout: {
                ...response.graphologyLayout,
                elements: [
                    node,
                    {
                        data: { ...node.data, id: peerId },
                        position: { x: 210, y: 80 },
                    },
                    {
                        data: {
                            source: node.data.id,
                            target: peerId,
                            type: "related",
                            confidence: 1,
                        },
                    },
                ],
            },
        });
        await mounted.show({ view });
        expect(onError).not.toHaveBeenCalled();
        expect(mockCores[0].nodes()).toHaveLength(2);
        expect(mockCores[0].edges()).toHaveLength(1);
        expect(mockCores[0].edges()[0].source().id()).toBe(node.data.id);
        expect(mockCores[0].edges()[0].target().id()).toBe(peerId);
        expect(mockCores[0].getElementById(peerId).position()).toEqual({
            x: 210,
            y: 80,
        });
        expect(mockCores[0].minZoom()).toBe(0.05);
    },
);

test("malformed Graphology edge endpoints are explicit errors", async () => {
    const response = graph();
    invoke.mockResolvedValueOnce({
        ...response,
        graphologyLayout: {
            ...response.graphologyLayout,
            elements: [{ data: { source: entityName, target: 3 } }],
        },
    });
    await mounted.show({ view: "entities" });
    expect(onError).toHaveBeenCalled();
    expect(host.textContent).toContain("Graph edge is missing valid endpoints");
});

test("the Hub can own view navigation without duplicate component controls", async () => {
    mounted.dispose();
    mounted = mountMemoryHubWebExplore(host, {
        onError,
        showNavigation: false,
    });
    await mounted.show({ view: "entities" });
    expect(
        element<HTMLElement>('nav[aria-label="Web exploration"]').hidden,
    ).toBe(true);
    expect(
        element('button[data-view="entities"]').getAttribute("aria-pressed"),
    ).toBe("true");
    expect(invoke).not.toHaveBeenCalledWith(
        "getTopicImportanceLayer",
        expect.anything(),
    );
});

test("real analytics response preserves browsing, domain, content insights and Hub drilldown", async () => {
    await mounted.show();
    expect(invoke).toHaveBeenCalledWith("getAnalyticsData", {
        timeRange: "30d",
        includeQuality: true,
        includeProgress: true,
        topDomainsLimit: 10,
        activityGranularity: "day",
    });
    expect(element("#totalWebsites").textContent).toBe("12");
    expect(element("#totalActionsMetric").textContent).toBe("3");
    expect(element("#topDomains").textContent).toBe("1");
    expect(host.querySelector("#activityCharts")).toBeNull();
    expect(host.textContent).not.toContain("Activity Trends");
    expect(element("#knowledgeInsights").textContent).toContain("90%");
    expect(element("#topDomainsList").textContent).toContain("<img");
    expect(host.querySelector("img")).toBeNull();
    const source = element<HTMLAnchorElement>("#recentEntitiesList a");
    const sourceRow = source.closest(".analytics-recent-item");
    expect(sourceRow?.querySelector(".entity-pill")?.textContent).toContain(
        entityName,
    );
    expect(source.closest('[role="button"]')).toBeNull();
    const routesBeforeSource = onRouteChanged.mock.calls.length;
    source.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(onOpenSource).toHaveBeenCalledWith("https://example.com/worker");
    expect(onRouteChanged).toHaveBeenCalledTimes(routesBeforeSource);
    element<HTMLButtonElement>(".entity-pill").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("getEntityNeighborhoodLayoutData", {
        entityId: entityName,
        depth: 2,
        maxNodes: 1000,
    });
    expect(onRouteChanged).toHaveBeenCalledWith({
        view: "entities",
        entity: entityName,
    });
    expect(host.textContent).toContain("Fixed lens: TypeAgent Browser Memory");
    expect(host.querySelector("iframe")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
});

test("Reading analytics View all uses paged browser knowledge rather than its recent preview", async () => {
    await mounted.show({ view: "analytics" });
    expect(
        invoke.mock.calls.some(([method]) => method === "memoryHubKnowledge"),
    ).toBe(false);
    invoke.mockResolvedValueOnce({
        items: [
            {
                id: "late",
                title: "Late entity",
                sources: [{ corpusId: "browser", sourceId: "retained" }],
            },
        ],
        total: 3000,
        errors: [],
    });
    const container = element("#recentEntitiesList");
    container
        .querySelector<HTMLButtonElement>(
            ".knowledge-collection-header button",
        )!
        .click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubKnowledge", {
        kind: "entities",
        browserOnly: true,
        offset: 0,
        pageSize: 24,
        query: "",
        sort: "mentions",
    });
    expect(container.textContent).toContain("3000 matching items");
    expect(container.textContent).toContain("Late entity");
    const details = container.querySelector<HTMLDetailsElement>("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    expect(container.querySelector<HTMLAnchorElement>("a")!.hash).toBe(
        "#/library/browser/retained",
    );
    expect(host.querySelector("#activityCharts")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    const detachedSource = container.querySelector<HTMLAnchorElement>("a")!;
    mounted.hide();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    detachedSource.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
});

test("real entity visualizer selection, controls, filtering, navigation and sanitized export", async () => {
    await mounted.show({ view: "entities" });
    const core = mockCores[0];
    expect(core.nodes()).toHaveLength(1);
    expect(core.getElementById(entityName).position()).toEqual({
        x: 10,
        y: 20,
    });
    expect(invoke).toHaveBeenCalledWith("getGlobalImportanceLayer", {
        maxNodes: 5000,
        includeConnectivity: true,
    });
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "getTopicImportanceLayer",
        ),
    ).toBe(false);
    core.getElementById(entityName).emit("tap");
    await settle();
    expect(element("#entityMentions").textContent).toBe("7");
    expect(element("#entityRelationships").textContent).toBe("3");
    expect(element("#entityName").textContent).toBe(entityName);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    const zoom = core.zoom();
    click("zoomInBtn");
    expect(core.zoom()).toBeGreaterThan(zoom);
    const filter = element<HTMLInputElement>("#entityTypeFilter");
    filter.value = "other";
    filter.dispatchEvent(new Event("input"));
    expect(core.nodes()[0].style("display")).toBe("none");
    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    expect(core.nodes()[0].style("display")).toBe("element");
    click("exportBtn");
    await settle();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:graph");
    click("entityBack");
    await settle();
    expect(element("#entityNameBreadcrumb").textContent).toBe("Global View");
    click("entityForward");
    await settle();
    expect(element("#entityNameBreadcrumb").textContent).toBe(entityName);
    element(".topic-tag").click();
    await settle();
    expect(onRouteChanged).toHaveBeenCalledWith({
        view: "topics",
        topic: topicName,
    });
    expect(onError).not.toHaveBeenCalled();
});

test("topic URL query selection uses actual visualizer labels, details and entity drilldown", async () => {
    window.history.replaceState(
        {},
        "",
        `/?topic=${encodeURIComponent(topicName)}`,
    );
    await mounted.show();
    expect(element("#sidebarContent").textContent).toContain(topicName);
    expect(element("#maxDepth").textContent).toBe("2");
    expect(element(".topic-sources").textContent).toContain(
        "Operations source",
    );
    const core = mockCores[0];
    expect(core.getElementById(topicName).position()).toEqual({ x: 10, y: 20 });
    expect(invoke).toHaveBeenCalledWith(
        "getTopicImportanceLayer",
        expect.objectContaining({ maxNodes: 500 }),
    );
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "getGlobalImportanceLayer",
        ),
    ).toBe(false);
    expect(core.getElementById(topicName).hasClass("selected")).toBe(true);
    const filter = element<HTMLInputElement>("#topicLevelFilter");
    filter.value = "3";
    filter.dispatchEvent(new Event("input"));
    expect(element("#visibleTopics").textContent).toBe("0");
    element(".entity-item").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("getEntityDetails", { entityName });
    expect(onError).not.toHaveBeenCalled();
});

test("entity URL selection and suggestions stay in the Hub rather than opening a standalone shell", async () => {
    window.history.replaceState(
        {},
        "",
        `/?entity=${encodeURIComponent(entityName)}`,
    );
    await mounted.show();
    expect(element("#contextSnippets").textContent).toContain(
        "<img src=x> handles operations",
    );
    const input = element<HTMLInputElement>("#entitySearchInput");
    input.value = "Worker";
    input.dispatchEvent(new Event("input"));
    expect(element("#entitySearchSuggestions button").textContent).toBe(
        entityName,
    );
    expect(location.pathname).toBe("/");
    expect(host.querySelector('a[href*="GraphView.html"]')).toBeNull();
});

test("legacy global mode overrides an entity URL selection", async () => {
    window.history.replaceState(
        {},
        "",
        `/?mode=global&entity=${encodeURIComponent(entityName)}`,
    );
    await mounted.show();
    expect(element("#entityNameBreadcrumb").textContent).toBe("Global View");
    expect(invoke.mock.calls.map((call) => call[0])).not.toContain(
        "getEntityDetails",
    );
});

test("details failures render explicit errors and failed entity selection removes the stale graph", async () => {
    invoke.mockImplementation(async (name: string) =>
        name === "getEntityDetails"
            ? { success: false, error: "Entity detail unavailable" }
            : respond(name),
    );
    await mounted.show({ view: "entities", entity: entityName });
    expect(element("[data-web-error]").textContent).toContain(
        "Entity detail unavailable",
    );
    expect(mockCores[0].nodes()).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
});

test.each(["entities", "topics"] as const)(
    "malformed %s details cannot masquerade as empty success",
    async (view) => {
        invoke.mockImplementation(async (operation: string) =>
            operation === "getEntityDetails" || operation === "getTopicDetails"
                ? { success: true, details: {} }
                : respond(operation),
        );
        await mounted.show({ view, entity: entityName, topic: topicName });
        expect(element("[data-web-error]").textContent).toContain(
            "details are missing valid",
        );
        expect(onError).toHaveBeenCalledTimes(1);
    },
);

test("programmatically unsupported views and headless image exports surface errors", async () => {
    // @ts-expect-error Exercise runtime callers that do not obey the typed contract.
    await mounted.show({ view: "unsupported" });
    expect(element("[data-web-error]").textContent).toContain(
        "Unsupported web exploration view",
    );
    await mounted.show({ view: "topics" });
    click("exportButton");
    await settle();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(element("[data-web-error]").hidden).toBe(false);
});

test.each([
    "getAnalyticsData",
    "getGlobalImportanceLayer",
    "getTopicImportanceLayer",
])(
    "unsupported or unavailable %s is an explicit error, never fake empty success",
    async (operation) => {
        invoke.mockImplementation(async (name: string) => {
            if (name === operation)
                throw new Error("Operation unsupported or service offline");
            return respond(name);
        });
        const view =
            operation === "getAnalyticsData"
                ? "analytics"
                : operation === "getGlobalImportanceLayer"
                  ? "entities"
                  : "topics";
        await mounted.show({ view });
        expect(element("[data-web-error]").textContent).toContain(
            "unsupported or service offline",
        );
        expect(element("[data-web-error]").hidden).toBe(false);
        expect(onError).toHaveBeenCalledTimes(1);
        if (view === "analytics")
            expect(element("#totalWebsites").textContent).toBe("-");
    },
);

test("malformed layouts and analytics never render success-shaped zeros", async () => {
    expect(() => layoutFromResponse({ graphologyLayout: {} })).toThrow(
        "elements",
    );
    invoke.mockResolvedValueOnce({ overview: { totalSites: "0" } });
    await mounted.show();
    expect(onError).toHaveBeenCalled();
    expect(element("#totalWebsites").textContent).toBe("-");
    expect(element("#analyticsEmptyState").hidden).toBe(true);
});

test("backend failure metrics are explicit errors even when overview looks like healthy zero counts", async () => {
    const response = analytics();
    invoke.mockResolvedValueOnce({
        ...response,
        overview: {
            totalSites: 0,
            totalBookmarks: 0,
            totalHistory: 0,
            knowledgeExtracted: 0,
        },
        analytics: { extractionMetrics: null, qualityReport: null },
    });
    await mounted.show();
    expect(element("[data-web-error]").textContent).toContain("service failed");
    expect(element("#totalWebsites").textContent).toBe("-");
    expect(onError).toHaveBeenCalledTimes(1);
});

test("healthy empty responses display real zeros, while retries clear prior errors", async () => {
    invoke.mockRejectedValueOnce(new Error("offline"));
    await mounted.show();
    expect(element("[data-web-error]").hidden).toBe(false);
    invoke.mockResolvedValueOnce({
        ...analytics(),
        overview: {
            totalSites: 0,
            totalBookmarks: 0,
            totalHistory: 0,
            knowledgeExtracted: 0,
        },
        knowledge: {
            totalEntities: 0,
            totalTopics: 0,
            totalActions: 0,
            totalRelationships: 0,
        },
        activity: {
            trends: [],
            summary: {
                totalActivity: 0,
                averagePerDay: 0,
                peakDay: null,
                timeRange: "30d",
            },
        },
        domains: { topDomains: [], totalSites: 0 },
    });
    element<HTMLButtonElement>("[data-analytics-refresh]").click();
    await settle();
    expect(element("#totalWebsites").textContent).toBe("0");
    expect(element("#totalEntitiesMetric").textContent).toBe("0");
    expect(element("#analyticsEmptyState").hidden).toBe(false);
    expect(element("[data-web-error]").hidden).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
});

test("route callbacks do not duplicate initial selection or perform global browser navigation", async () => {
    await mounted.show({ view: "topics", topic: topicName });
    expect(onRouteChanged.mock.calls).toEqual([
        [{ view: "topics", topic: topicName }],
    ]);
    expect(location.search).toBe("");
});

test("hide and dispose ignore late responses and release actual graph cores and DOM handlers", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const pending = mounted.show({ view: "entities" });
    mounted.hide();
    resolve(graph());
    await pending;
    expect(mockCores).toHaveLength(0);
    await mounted.show({ view: "entities" });
    const button = element<HTMLButtonElement>("#entitySearchButton");
    const core = mockCores[0];
    mounted.dispose();
    expect(core.destroyed()).toBe(true);
    const calls = invoke.mock.calls.length;
    button.click();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(calls);
    await mounted.show();
    expect(host.children).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
});

test("a slow previous lens cannot overwrite a newer analytics mount or report a stale error", async () => {
    let reject!: (reason: Error) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((_resolve, fail) => {
                reject = fail;
            }),
    );
    const pending = mounted.show({ view: "entities" });
    await mounted.show({ view: "analytics" });
    reject(new Error("old graph offline"));
    await pending;
    expect(element("#totalWebsites").textContent).toBe("12");
    expect(element("[data-web-error]").hidden).toBe(true);
    expect(onError).not.toHaveBeenCalled();
});

test("late entity details cannot mutate a different lens, and detached source links are inert after hide", async () => {
    let finish!: (response: unknown) => void;
    invoke.mockImplementation(async (operation: string) => {
        if (operation === "getEntityDetails")
            return new Promise((resolve) => {
                finish = resolve;
            });
        return respond(operation);
    });
    const pending = mounted.show({ view: "entities", entity: entityName });
    await settle();
    await mounted.show({ view: "analytics" });
    finish(respond("getEntityDetails"));
    await pending;
    expect(element("#totalWebsites").textContent).toBe("12");
    const source = element<HTMLAnchorElement>("#recentEntitiesList a");
    mounted.hide();
    source.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
});

test("owned roots do not query or react to colliding Hub IDs", async () => {
    const collision = document.createElement("div");
    collision.innerHTML =
        '<span id="totalWebsites">Hub totals</span><button id="fitBtn">Hub Fit</button>';
    document.body.prepend(collision);
    try {
        await mounted.show();
        expect(collision.textContent).toContain("Hub totals");
        expect(element("#totalWebsites").textContent).toBe("12");
        collision.querySelector<HTMLButtonElement>("button")!.click();
        expect(onError).not.toHaveBeenCalled();
    } finally {
        collision.remove();
    }
});

test("JSON export escapes untrusted text and source URLs reject executable schemes", async () => {
    downloadGraph({ label: "<script>&" }, "graph.json");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsText(blob);
    });
    expect(text).toContain("\\u003cscript\\u003e\\u0026");
    const container = document.createElement("div");
    renderSources(
        container,
        [
            { title: "<img>", url: 'javascript:alert("x")' },
            { title: '"quoted"', url: "https://example.com" },
        ],
        { onError },
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toContain("<img>");
    expect(container.querySelector("img")).toBeNull();
});
