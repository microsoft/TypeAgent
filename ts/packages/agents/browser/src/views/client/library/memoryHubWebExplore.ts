// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createExtensionService,
    DefaultAnalyticsServices,
} from "./knowledgeUtilities";
import { KnowledgeAnalyticsPanel } from "./knowledgeAnalyticsPanel";
import { EntityGraphView } from "./entityGraphView";
import { TopicGraphView } from "./topicGraphView";
import { WebExploreRoot } from "./memoryHubWebExploreRoot";
import analyticsTemplate from "./memoryHubWebExploreAnalytics.html?raw";
import entityTemplate from "./memoryHubWebExploreEntities.html?raw";
import topicTemplate from "./memoryHubWebExploreTopics.html?raw";
import "./memoryHubWebExplore.css";

export interface MemoryHubWebExploreRequest {
    view: "analytics" | "entities" | "topics";
    entity?: string;
    topic?: string;
}

export interface MemoryHubWebExploreOptions {
    onError: (error: unknown) => void;
    showNavigation?: boolean;
    onOpenSource?: (url: string) => void;
    onRouteChanged?: (request: MemoryHubWebExploreRequest) => void;
}

export function mountMemoryHubWebExplore(
    host: HTMLElement,
    options: MemoryHubWebExploreOptions,
): {
    show(request?: MemoryHubWebExploreRequest): Promise<void>;
    hide(): void;
    dispose(): void;
} {
    const root = document.createElement("section");
    root.className = "memory-web-explore";
    root.hidden = true;
    root.innerHTML = `<header>
        <nav aria-label="Web exploration"><button data-view="analytics">Reading analytics</button><button data-view="entities">Entity graph</button><button data-view="topics">Topic graph</button></nav></header>
        <p data-web-error role="alert" hidden></p><div data-web-content></div>`;
    host.append(root);
    root.querySelector<HTMLElement>("nav")!.hidden =
        options.showNavigation === false;
    const owner = new WebExploreRoot(root, options);
    const content = owner.element("[data-web-content]");
    let controller:
        | KnowledgeAnalyticsPanel
        | EntityGraphView
        | TopicGraphView
        | undefined;
    let disposed = false;
    let generation = 0;
    let lastRoute: MemoryHubWebExploreRequest | undefined;
    const service = createExtensionService();

    function routeChanged(request: MemoryHubWebExploreRequest): void {
        if (
            lastRoute?.view === request.view &&
            lastRoute.entity === request.entity &&
            lastRoute.topic === request.topic
        )
            return;
        lastRoute = { ...request };
        options.onRouteChanged?.(request);
    }

    function hide(): void {
        generation++;
        controller?.destroy();
        controller = undefined;
        root.hidden = true;
        content.replaceChildren();
    }

    async function show(request?: MemoryHubWebExploreRequest): Promise<void> {
        if (disposed) return;
        hide();
        const ticket = generation;
        root.hidden = false;
        owner.clearError();
        const selection = request ?? requestFromUrl();
        for (const button of root.querySelectorAll<HTMLButtonElement>(
            "button[data-view]",
        ))
            button.setAttribute(
                "aria-pressed",
                String(button.dataset.view === selection.view),
            );
        try {
            routeChanged(selection);
            const callbacks = {
                ...options,
                onRouteChanged: routeChanged,
                onNavigate: (next: MemoryHubWebExploreRequest) =>
                    void show(next),
            };
            switch (selection.view) {
                case "analytics": {
                    content.innerHTML = analyticsTemplate;
                    const panel = new KnowledgeAnalyticsPanel(
                        content,
                        new DefaultAnalyticsServices(service),
                        callbacks,
                    );
                    controller = panel;
                    await panel.initialize();
                    break;
                }
                case "entities": {
                    content.innerHTML = entityTemplate;
                    const graph = new EntityGraphView(
                        content,
                        service,
                        callbacks,
                    );
                    controller = graph;
                    await graph.show(selection.entity);
                    break;
                }
                case "topics": {
                    content.innerHTML = topicTemplate;
                    const graph = new TopicGraphView(
                        content,
                        service,
                        callbacks,
                    );
                    controller = graph;
                    await graph.show(selection.topic);
                    break;
                }
                default:
                    throw new Error("Unsupported web exploration view");
            }
        } catch (error) {
            if (ticket === generation && !disposed) owner.error(error);
        }
    }

    owner.listen(root, "click", (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>(
            "button[data-view]",
        );
        if (button?.dataset.view) {
            void show({
                view: button.dataset.view as MemoryHubWebExploreRequest["view"],
            });
        }
    });
    return {
        show,
        hide,
        dispose() {
            if (disposed) return;
            hide();
            disposed = true;
            owner.destroy();
            root.remove();
        },
    };
}

function requestFromUrl(): MemoryHubWebExploreRequest {
    const params = new URLSearchParams(location.search);
    if (params.get("mode") === "global") return { view: "entities" };
    if (params.get("entity"))
        return { view: "entities", entity: params.get("entity")! };
    if (params.get("topic"))
        return { view: "topics", topic: params.get("topic")! };
    return { view: "analytics" };
}
