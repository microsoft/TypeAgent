// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Website } from "../interfaces/searchTypes";
import { KnowledgeUtils } from "./knowledgeUtils";

export class RenderingHelpers {
    static highlightMatch(text: string, query: string): string {
        if (!query) return text;
        const regex = new RegExp(`(${query})`, "gi");
        return text.replace(regex, "<strong>$1</strong>");
    }

    static getSuggestionIcon(type: string): string {
        switch (type) {
            case "recent":
                return "bi-clock-history";
            case "entity":
                return "bi-diagram-2";
            case "topic":
                return "bi-tags";
            case "domain":
                return "bi-globe";
            default:
                return "bi-search";
        }
    }

    static renderSuggestionMetadata(suggestion: any): string {
        if (!suggestion.metadata) return "";

        const { count, lastUsed, source } = suggestion.metadata;

        if (count) {
            return `<small class="text-muted">${count} results</small>`;
        }
        if (lastUsed) {
            return `<small class="text-muted">${lastUsed}</small>`;
        }
        if (source) {
            return `<small class="text-muted">from ${source}</small>`;
        }
        return "";
    }

    static createTooltip(content: string, element: HTMLElement): void {
        const tooltip = document.createElement("div");
        tooltip.className = "knowledge-tooltip";
        tooltip.innerHTML = content;

        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        tooltip.style.position = "fixed";
        tooltip.style.top = `${rect.bottom + 8}px`;
        tooltip.style.left = `${rect.left}px`;
        tooltip.style.zIndex = "9999";

        setTimeout(() => {
            tooltip.remove();
        }, 3000);

        const removeTooltip = (e: Event) => {
            if (!tooltip.contains(e.target as Node)) {
                tooltip.remove();
                document.removeEventListener("click", removeTooltip);
            }
        };

        setTimeout(() => {
            document.addEventListener("click", removeTooltip);
        }, 100);
    }

    static showConnectionRequired(container: HTMLElement): void {
        if (container) {
            container.innerHTML = `
                <div class="connection-required">
                    <i class="bi bi-wifi-off"></i>
                    <h3>Connection Required</h3>
                    <p>This feature requires an active connection to the TypeAgent service.</p>
                    <button class="btn btn-primary" data-action="reconnect">
                        <i class="bi bi-arrow-repeat"></i> Reconnect
                    </button>
                </div>
            `;
        }
    }

    static showError(container: HTMLElement, message: string): void {
        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    <i class="bi bi-exclamation-triangle"></i>
                    <h3>Error</h3>
                    <p>${message}</p>
                    <button class="btn btn-primary" onclick="window.location.reload()">
                        <i class="bi bi-arrow-repeat"></i> Retry
                    </button>
                </div>
            `;
        }
    }

    static showLoading(
        container: HTMLElement,
        message: string = "Loading...",
    ): void {
        if (container) {
            container.innerHTML = `
                <div class="text-center p-4">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">${message}</span>
                    </div>
                    <p class="mt-3 mb-0">${message}</p>
                </div>
            `;
        }
    }

    static showEmpty(
        container: HTMLElement,
        icon: string,
        title: string,
        message: string,
    ): void {
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi ${icon}"></i>
                    <h6>${title}</h6>
                    <p>${message}</p>
                </div>
            `;
        }
    }
}
