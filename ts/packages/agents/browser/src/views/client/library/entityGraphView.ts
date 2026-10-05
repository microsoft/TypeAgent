// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EntityGraphVisualizer } from "./entityGraphVisualizer";
import { EntitySidebar } from "./entitySidebar";
import { GraphDataProviderImpl } from "./graphDataProvider";
import type { ViewService } from "./knowledgeUtilities";
import {
    WebExploreRoot,
    detailsFromResponse,
    layoutFromResponse,
    renderSources,
    downloadGraph,
    downloadImage,
    type WebExploreCallbacks,
    type WebGraphElement,
} from "./memoryHubWebExploreRoot";

export class EntityGraphView {
    private owner: WebExploreRoot;
    private visualizer: EntityGraphVisualizer;
    private sidebar: EntitySidebar;
    private provider: GraphDataProviderImpl;
    private initialized = false;
    private selection: string | undefined;
    private history: (string | undefined)[] = [];
    private historyIndex = -1;
    private elements: WebGraphElement[] = [];

    constructor(
        root: HTMLElement,
        private service: ViewService,
        private callbacks: WebExploreCallbacks,
    ) {
        this.owner = new WebExploreRoot(root, callbacks);
        this.visualizer = new EntityGraphVisualizer(
            this.owner.element("#cytoscape-container"),
        );
        this.sidebar = new EntitySidebar(this.owner.element("#entitySidebar"));
        this.provider = new GraphDataProviderImpl(service);
        this.visualizer.setGraphDataProvider(this.provider);
        this.visualizer.onEntityClick((entity) => {
            void this.owner.run(() => this.show(entity.name));
        });
        this.setupControls();
    }

    private setupControls(): void {
        const actions: Record<string, () => void | Promise<void>> = {
            zoomInBtn: () => this.visualizer.zoomIn(),
            zoomOutBtn: () => this.visualizer.zoomOut(),
            fitBtn: () => this.visualizer.fitToView(),
            reLayoutBtn: () => this.visualizer.reRunLayout(),
            debugViewportBtn: () => this.visualizer.debugLogViewportNodes(),
            screenshotBtn: () =>
                downloadImage(
                    this.visualizer.takeScreenshot(),
                    "entity-graph.png",
                ),
            exportBtn: () =>
                downloadGraph(
                    this.visualizer.exportGraph(),
                    "entity-graph.json",
                ),
            entityGraphBreadcrumb: () => this.show(),
            entityBack: () => this.navigateHistory(-1),
            entityForward: () => this.navigateHistory(1),
            entitySearchButton: () => this.search(),
            closeEntitySidebar: () => this.closeSidebar(),
            closePanelBtn: () => {
                this.owner.element("#contentPanel").hidden = true;
                this.visualizer.resize();
            },
        };
        for (const [id, action] of Object.entries(actions)) {
            this.owner.listen(
                this.owner.element(`#${id}`),
                "click",
                () => void this.owner.run(action),
            );
        }
        this.owner.listen(
            this.owner.element("#entitySearchInput"),
            "keydown",
            (event) => {
                if (event.key === "Enter")
                    void this.owner.run(() => this.search());
            },
        );
        this.owner.listen(
            this.owner.element("#entitySearchInput"),
            "input",
            () => this.suggest(),
        );
        this.owner.listen(
            this.owner.element("#entityTypeFilter"),
            "input",
            () => this.filter(),
        );
        this.owner.listen(
            this.owner.element("#entityTopics"),
            "click",
            (event) => {
                const topic = (event.target as Element).closest<HTMLElement>(
                    ".topic-tag",
                )?.textContent;
                if (topic) this.callbacks.onNavigate({ view: "topics", topic });
            },
        );
    }

    async show(entity?: string, addHistory = true): Promise<void> {
        const ticket = this.owner.begin();
        this.owner.clearError();
        this.selection = entity;
        this.owner.element("#graphLoading").hidden = false;
        this.owner.element("#graphEmpty").hidden = true;
        this.closeSidebar();
        if (addHistory) {
            this.history.splice(this.historyIndex + 1);
            this.history.push(entity);
            this.historyIndex = this.history.length - 1;
        }
        this.updateNavigation();
        try {
            const response = entity
                ? await this.provider.getEntityNeighborhoodLayoutDataOptimized(
                      entity,
                      2,
                      1000,
                  )
                : await this.provider.getGlobalImportanceLayer(5000);
            if (!this.owner.current(ticket)) return;
            const layout = layoutFromResponse(response);
            if (!this.initialized) {
                await this.visualizer.initialize();
                this.initialized = true;
            }
            if (!this.owner.current(ticket)) return;
            this.elements = layout.presetLayout.elements;
            await this.visualizer.loadGlobalGraph(layout);
            if (!this.owner.current(ticket)) return;
            this.owner.element("#graphEmpty").hidden =
                this.elements.length !== 0;
            this.visualizer.resize();
            this.filter();
            this.callbacks.onRouteChanged?.({ view: "entities", entity });
            if (entity) {
                this.visualizer.focusOnEntityNode(entity);
                await this.loadDetails(entity, ticket);
            }
        } catch (error) {
            if (this.owner.current(ticket)) {
                this.visualizer.clearGraph();
                throw error;
            }
        } finally {
            if (this.owner.current(ticket))
                this.owner.element("#graphLoading").hidden = true;
        }
    }

    private async loadDetails(entity: string, ticket: number): Promise<void> {
        const [response, content] = await Promise.all([
            this.service.getEntityDetails(entity),
            this.service.searchWebMemories(entity, {}),
        ]);
        if (!this.owner.current(ticket)) return;
        const details = detailsFromResponse(response);
        if (
            typeof details.name !== "string" ||
            typeof details.type !== "string" ||
            typeof details.confidence !== "number" ||
            !Number.isFinite(details.confidence) ||
            typeof details.count !== "number" ||
            !Number.isFinite(details.count)
        )
            throw new Error(
                "Entity details are missing valid name, type, confidence or mention count",
            );
        await this.sidebar.loadEntity(
            {
                name: details.name,
                type: details.type,
                confidence: details.confidence,
            },
            { ...details, mentionCount: details.count },
        );
        if (!this.owner.current(ticket)) return;
        this.owner.element("#entityRelationships").textContent = String(
            details.degree ?? "-",
        );
        this.owner.element("#entitySidebar").hidden = false;
        this.owner.element("#contentPanel").hidden = false;
        const snippets = this.owner.element("#contextSnippets");
        snippets.replaceChildren();
        for (const website of content.websites) {
            if (!website.snippet) continue;
            const snippet = document.createElement("div");
            renderSources(
                snippet,
                [website],
                this.callbacks,
                this.owner.signal,
            );
            const text = document.createElement("p");
            text.textContent = website.snippet;
            snippets.append(snippet, text);
        }
        if (!snippets.childElementCount)
            snippets.textContent =
                "No matching context snippets were returned.";
        renderSources(
            this.owner.element("#relatedWebsites"),
            details.websites ?? details.sources,
            this.callbacks,
            this.owner.signal,
        );
        this.owner.element("#importanceScore").textContent = String(
            details.importance ?? "-",
        );
        this.owner.element("#clusterGroup").textContent = String(
            details.clusterGroup ?? "-",
        );
        this.owner.element("#coOccurrences").textContent = String(
            details.degree ?? "-",
        );
        this.visualizer.resize();
    }

    private async search(): Promise<void> {
        const query = this.owner
            .element<HTMLInputElement>("#entitySearchInput")
            .value.trim();
        if (query) await this.show(query);
    }

    private suggest(): void {
        const query = this.owner
            .element<HTMLInputElement>("#entitySearchInput")
            .value.trim();
        const container = this.owner.element("#entitySearchSuggestions");
        container.replaceChildren();
        if (!query) return;
        for (const entity of this.visualizer
            .searchEntities(query)
            .slice(0, 12)) {
            const button = document.createElement("button");
            button.textContent = entity.name;
            this.owner.listen(
                button,
                "click",
                () => void this.owner.run(() => this.show(entity.name)),
            );
            container.append(button);
        }
    }

    private filter(): void {
        const type = this.owner
            .element<HTMLInputElement>("#entityTypeFilter")
            .value.trim()
            .toLowerCase();
        this.visualizer.filterByType(type);
    }

    private async navigateHistory(delta: number): Promise<void> {
        const index = this.historyIndex + delta;
        if (index < 0 || index >= this.history.length) return;
        this.historyIndex = index;
        await this.show(this.history[index], false);
    }

    private updateNavigation(): void {
        this.owner.element("#entityNameBreadcrumb").textContent =
            this.selection ?? "Global View";
        this.owner.element<HTMLButtonElement>("#entityBack").disabled =
            this.historyIndex <= 0;
        this.owner.element<HTMLButtonElement>("#entityForward").disabled =
            this.historyIndex >= this.history.length - 1;
    }

    private closeSidebar(): void {
        this.owner.element("#entitySidebar").hidden = true;
        this.owner.element("#contentPanel").hidden = true;
        this.visualizer.resize();
    }

    destroy(): void {
        this.owner.destroy();
        this.visualizer.destroy();
        this.sidebar.clear();
        this.elements = [];
    }
}
