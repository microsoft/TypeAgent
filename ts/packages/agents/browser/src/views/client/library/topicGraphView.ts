// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TopicGraphVisualizer } from "./topicGraphVisualizer";
import { GraphDataProviderImpl } from "./graphDataProvider";
import type { ViewService } from "./knowledgeUtilities";
import {
    WebExploreRoot,
    detailsFromResponse,
    layoutFromResponse,
    renderSources,
    downloadGraph,
    downloadImage,
    record,
    type WebExploreCallbacks,
    type WebGraphElement,
} from "./memoryHubWebExploreRoot";

export class TopicGraphView {
    private owner: WebExploreRoot;
    private visualizer: TopicGraphVisualizer;
    private provider: GraphDataProviderImpl;
    private elements: WebGraphElement[] = [];
    private selectedTopic: string | undefined;
    private detailGeneration = 0;
    private loadTicket = 0;

    constructor(
        root: HTMLElement,
        private service: ViewService,
        private callbacks: WebExploreCallbacks,
    ) {
        this.owner = new WebExploreRoot(root, callbacks);
        this.visualizer = new TopicGraphVisualizer(
            this.owner.element("#topicGraphContainer"),
        );
        this.provider = new GraphDataProviderImpl(service);
        this.visualizer.onTopicClick(
            (topic) =>
                void this.owner.run(() => this.select(topic.id, topic.name)),
        );
        this.setupControls();
    }

    private setupControls(): void {
        const actions: Record<string, () => void | Promise<void>> = {
            fitButton: () => this.visualizer.fitToView(),
            centerButton: () => this.visualizer.centerGraph(),
            topicZoomIn: () => this.visualizer.zoomBy(1.2),
            topicZoomOut: () => this.visualizer.zoomBy(1 / 1.2),
            exportButton: () =>
                downloadImage(
                    this.visualizer.exportAsImage(),
                    "topic-graph.png",
                ),
            exportJsonButton: () =>
                downloadGraph(this.elements, "topic-graph.json"),
            closeSidebar: () => this.closeSidebar(),
            topicGraphBreadcrumb: () => this.show(),
            retryButton: () => this.show(this.selectedTopic),
            searchButton: () => this.search(),
        };
        for (const [id, action] of Object.entries(actions)) {
            this.owner.listen(
                this.owner.element(`#${id}`),
                "click",
                () => void this.owner.run(action),
            );
        }
        this.owner.listen(
            this.owner.element("#topicSearch"),
            "input",
            () => void this.owner.run(() => this.search()),
        );
        this.owner.listen(
            this.owner.element("#topicSearch"),
            "keydown",
            (event) => {
                if (event.key === "Enter")
                    void this.owner.run(() => this.search());
            },
        );
        this.owner.listen(
            this.owner.element("#topicLevelFilter"),
            "input",
            () => {
                const value =
                    this.owner.element<HTMLInputElement>(
                        "#topicLevelFilter",
                    ).value;
                this.visualizer.filterByLevel(
                    value === "" ? undefined : Number(value),
                );
                this.updateStats();
            },
        );
    }

    async show(topic?: string): Promise<void> {
        const ticket = this.owner.begin();
        this.owner.clearError();
        this.loadTicket = ticket;
        this.detailGeneration++;
        this.selectedTopic = topic;
        this.owner.element<HTMLInputElement>("#topicSearch").value =
            topic ?? "";
        this.owner.element("#topicNameBreadcrumb").textContent =
            topic ?? "Global View";
        this.closeSidebar();
        this.owner.element("#loadingOverlay").hidden = false;
        this.owner.element("#errorOverlay").hidden = true;
        try {
            const response =
                await this.provider.getTopicImportanceLayoutData(500);
            if (!this.owner.current(ticket)) return;
            const layout = layoutFromResponse(response);
            this.elements = layout.presetLayout.elements;
            await this.visualizer.init(layout);
            if (!this.owner.current(ticket)) return;
            this.visualizer.resize();
            const level =
                this.owner.element<HTMLInputElement>("#topicLevelFilter").value;
            this.visualizer.filterByLevel(
                level === "" ? undefined : Number(level),
            );
            this.updateStats();
            this.callbacks.onRouteChanged?.({ view: "topics", topic });
            if (topic) {
                const found = this.visualizer
                    .searchTopics(topic)
                    .find(
                        (candidate) =>
                            candidate.name.toLowerCase() ===
                                topic.toLowerCase() || candidate.id === topic,
                    );
                if (!found)
                    throw new Error(
                        `Topic not found in the loaded graph: ${topic}`,
                    );
                await this.select(found.id, found.name);
            }
        } catch (error) {
            if (this.owner.current(ticket)) {
                this.owner.element("#errorOverlay").hidden = false;
                this.owner.element("#errorMessage").textContent =
                    error instanceof Error ? error.message : String(error);
                throw error;
            }
        } finally {
            if (this.owner.current(ticket))
                this.owner.element("#loadingOverlay").hidden = true;
        }
    }

    private async search(): Promise<void> {
        const query = this.owner
            .element<HTMLInputElement>("#topicSearch")
            .value.trim();
        const topics = query ? this.visualizer.searchTopics(query) : [];
        this.visualizer.highlightSearchResults(topics.map((topic) => topic.id));
        this.owner.element("#notificationBody").textContent = query
            ? `${topics.length} matching topics in the loaded graph`
            : "";
        const exact = topics.find(
            (topic) => topic.name.toLowerCase() === query.toLowerCase(),
        );
        if (exact) await this.select(exact.id, exact.name);
    }

    private async select(id: string, name: string): Promise<void> {
        const ticket = ++this.detailGeneration;
        this.owner.clearError();
        const load = this.loadTicket;
        this.selectedTopic = name;
        this.visualizer.selectTopic(id);
        this.visualizer.focusOnTopic(id);
        this.owner.element("#topicNameBreadcrumb").textContent = name;
        this.owner.element("#topicSidebar").classList.remove("collapsed");
        const content = this.owner.element("#sidebarContent");
        content.textContent = "Loading topic details...";
        this.visualizer.resize();
        this.callbacks.onRouteChanged?.({ view: "topics", topic: name });
        try {
            const [response, timelineResponse] = await Promise.all([
                this.service.getTopicDetails(name),
                this.service.getTopicTimelines({
                    topicNames: [name],
                    maxTimelineEntries: 15,
                    includeRelatedTopics: false,
                }),
            ]);
            if (!this.owner.current(load) || ticket !== this.detailGeneration)
                return;
            const details = detailsFromResponse(response);
            if (
                typeof details.topicName !== "string" ||
                typeof details.level !== "number" ||
                !Number.isFinite(details.level) ||
                typeof details.confidence !== "number" ||
                !Number.isFinite(details.confidence) ||
                !Array.isArray(details.keywords) ||
                !Array.isArray(details.entityReferences)
            )
                throw new Error(
                    "Topic details are missing valid name, level, confidence, keywords or entity references",
                );
            content.replaceChildren();
            this.addText(content, "Topic", details.topicName);
            this.addText(content, "Level", details.level);
            this.addText(content, "Confidence", details.confidence);
            this.addText(content, "First Seen", details.firstSeen);
            this.addText(content, "Last Seen", details.lastSeen);
            this.addText(
                content,
                "Keywords",
                Array.isArray(details.keywords)
                    ? details.keywords.join(", ")
                    : undefined,
            );
            this.addRelatedEntities(content, details.entityReferences);
            const sources = document.createElement("div");
            sources.className = "topic-sources";
            if (!timelineResponse.success)
                throw new Error(
                    timelineResponse.error ??
                        "Topic contributing sources are unavailable",
                );
            const sourceValues = timelineResponse.timelines.flatMap((value) => {
                const timeline = record(value);
                if (!Array.isArray(timeline.activities))
                    throw new Error(
                        "Topic timeline activities are unavailable",
                    );
                return timeline.activities.map((activity: unknown) =>
                    record(activity),
                );
            });
            renderSources(
                sources,
                sourceValues,
                this.callbacks,
                this.owner.signal,
            );
            content.append(sources);
        } catch (error) {
            if (!this.owner.current(load) || ticket !== this.detailGeneration)
                return;
            content.textContent = `Topic details unavailable: ${error instanceof Error ? error.message : String(error)}`;
            this.owner.error(error);
        }
    }

    private addText(
        container: HTMLElement,
        label: string,
        value: unknown,
    ): void {
        const line = document.createElement("p");
        line.textContent = `${label}: ${value ?? "-"}`;
        container.append(line);
    }

    private addRelatedEntities(container: HTMLElement, values: unknown): void {
        if (!Array.isArray(values)) return;
        for (const value of values) {
            if (typeof value !== "string")
                throw new Error("Invalid related entity");
            const button = document.createElement("button");
            button.textContent = value;
            button.className = "entity-item";
            this.owner.listen(button, "click", () =>
                this.callbacks.onNavigate({ view: "entities", entity: value }),
            );
            container.append(button);
        }
    }

    private updateStats(): void {
        const stats = this.visualizer.getGraphStats();
        if (!stats) throw new Error("Topic graph statistics are unavailable");
        this.owner.element("#totalTopics").textContent = String(
            stats.totalTopics,
        );
        this.owner.element("#visibleTopics").textContent = String(
            stats.visibleTopics,
        );
        this.owner.element("#maxDepth").textContent = String(stats.maxDepth);
    }

    private closeSidebar(): void {
        this.detailGeneration++;
        this.owner.element("#topicSidebar").classList.add("collapsed");
        this.visualizer.resize();
    }

    destroy(): void {
        this.owner.destroy();
        this.detailGeneration++;
        this.visualizer.dispose();
        this.elements = [];
    }
}
