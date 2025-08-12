// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// EntitySidebar types and interfaces

interface EntityFacet {
    name: string;
    value: string;
}

interface EntityData {
    name: string;
    type: string;
    confidence: number;
    importance?: number;
    clusterGroup?: string;
}

/**
 * Entity Sidebar Component
 *
 * Displays detailed information about selected entities including
 * metrics, relationships, timeline, and related content.
 */
export class EntitySidebar {
    private container: HTMLElement;
    private currentEntity: any | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    /**
     * Load and display entity information
     */
    async loadEntity(
        entityData: EntityData | string,
        fullEntityData?: any,
    ): Promise<void> {
        // Clear existing data first to prevent stale data issues
        this.clearStaleData();

        this.currentEntity = fullEntityData || entityData;
        this.renderEntityHeader();
        this.renderEntityMetrics();
        this.renderEntityDetails();
        this.renderEntityTimeline();
    }

    /**
     * Clear stale data from sidebar before loading new entity
     */
    private clearStaleData(): void {
        // Clear domains list
        const domainsSection = document.getElementById("entityDomains");
        if (domainsSection) {
            const domainsList = domainsSection.querySelector(".domains-list");
            if (domainsList) {
                domainsList.innerHTML =
                    '<span class="empty-message">Loading...</span>';
            }
        }

        // Clear topics list
        const topicsSection = document.getElementById("entityTopics");
        if (topicsSection) {
            const topicsList = topicsSection.querySelector(".topics-list");
            if (topicsList) {
                topicsList.innerHTML =
                    '<span class="empty-message">Loading...</span>';
            }
        }

        // Clear facets list
        const facetsSection = document.getElementById("entityFacets");
        if (facetsSection) {
            const facetsList = facetsSection.querySelector(".facets-list");
            if (facetsList) {
                facetsList.innerHTML =
                    '<span class="empty-message">Loading...</span>';
            }
        }

        // Clear timeline
        const firstSeenEl = document.getElementById("entityFirstSeen");
        const lastSeenEl = document.getElementById("entityLastSeen");
        if (firstSeenEl) firstSeenEl.textContent = "Loading...";
        if (lastSeenEl) lastSeenEl.textContent = "Loading...";
    }

    /**
     * Clear the sidebar
     */
    clear(): void {
        this.currentEntity = null;
        this.renderEmptyState();
    }

    private renderEntityHeader(): void {
        if (!this.currentEntity) return;

        const iconEl = document.getElementById("entityIcon");
        const nameEl = document.getElementById("entityName");
        const typeEl = document.getElementById("entityType");
        const confidenceEl = document.getElementById("entityConfidence");

        // Handle entity name - could be name or entityName
        const entityName =
            this.currentEntity.name ||
            this.currentEntity.entityName ||
            "Unknown Entity";
        const entityType =
            this.currentEntity.type ||
            this.currentEntity.entityType ||
            "unknown";

        if (iconEl) {
            iconEl.className = `entity-icon entity-type-${entityType}`;
            iconEl.innerHTML = this.getEntityIcon(entityType);
        }

        if (nameEl) {
            nameEl.textContent = entityName;
        }

        if (typeEl) {
            typeEl.textContent = entityType;
            typeEl.className = `entity-type-badge entity-type-${entityType}`;
        }

        if (confidenceEl) {
            const confidence = this.currentEntity.confidence || 0.5;
            const confidencePercent = Math.round(confidence * 100);
            confidenceEl.innerHTML = `
                <i class="bi bi-shield-check"></i>
                Confidence: ${confidencePercent}%
            `;
        }
    }

    private renderEntityMetrics(): void {
        if (!this.currentEntity) return;

        const mentionsEl = document.getElementById("entityMentions");
        const relationshipsEl = document.getElementById("entityRelationships");
        const centralityEl = document.getElementById("entityCentrality");

        if (mentionsEl) {
            // Handle both mock structure and real entity structure
            const mentionCount =
                this.currentEntity.mentionCount ||
                this.currentEntity.frequency ||
                this.currentEntity.visitCount ||
                0;
            const mentionValue =
                mentionCount != null ? Number(mentionCount) : 0;
            mentionsEl.textContent = isNaN(mentionValue)
                ? "0"
                : mentionValue.toString();
        }

        if (relationshipsEl) {
            // Handle both mock structure and real entity structure
            let relationshipCount = 0;
            if (this.currentEntity.strongRelationships?.length) {
                relationshipCount =
                    this.currentEntity.strongRelationships.length;
            } else if (this.currentEntity.relationships?.length) {
                relationshipCount = this.currentEntity.relationships.length;
            } else if (Array.isArray(this.currentEntity.relationships)) {
                relationshipCount = this.currentEntity.relationships.length;
            }

            const relationshipValue =
                relationshipCount != null ? Number(relationshipCount) : 0;
            relationshipsEl.textContent = isNaN(relationshipValue)
                ? "0"
                : relationshipValue.toString();
        }

        if (centralityEl) {
            // Handle both mock structure and real entity structure
            const centrality =
                this.currentEntity.centrality ||
                this.currentEntity.confidence ||
                0;
            const centralityValue = centrality != null ? Number(centrality) : 0;
            const centralityPercent = Math.round(centralityValue * 100);
            centralityEl.textContent = isNaN(centralityPercent)
                ? "0%"
                : centralityPercent + "%";
        }
    }

    private renderEntityDetails(): void {
        if (!this.currentEntity) return;

        this.renderFacets();
        this.renderDomains();
        this.renderTopics();
    }

    private renderFacets(): void {
        const facetsSection = document.getElementById("entityFacets");
        if (!facetsSection) return;

        const facetsList = facetsSection.querySelector(".facets-list");
        if (!facetsList) return;

        const facets = this.currentEntity.facets || [];

        // Fallback: if no facets but aliases exist, convert aliases to facets
        if (facets.length === 0 && this.currentEntity.aliases?.length > 0) {
            const aliasesAsFacets = this.currentEntity.aliases.map(
                (alias: string, index: number) => ({
                    name: index === 0 ? "Primary Alias" : `Alias ${index + 1}`,
                    value: alias,
                }),
            );

            const facetsHtml = aliasesAsFacets
                .map((facet: EntityFacet) => this.renderFacetItem(facet))
                .join("");

            facetsList.innerHTML = facetsHtml;
            return;
        }

        if (facets.length === 0) {
            facetsList.innerHTML =
                '<span class="empty-message">No facets</span>';
            return;
        }

        const facetsHtml = facets
            .map((facet: EntityFacet) => this.renderFacetItem(facet))
            .join("");

        facetsList.innerHTML = facetsHtml;
    }

    private renderFacetItem(facet: EntityFacet): string {
        const escapedName = this.escapeHtml(facet.name);
        const escapedValue = this.escapeHtml(facet.value);
        const formattedValue = this.formatFacetValue(facet);

        return `
            <div class="facet-item">
                <span class="facet-name">${escapedName}:</span>
                <span class="facet-value" title="${escapedValue}">${formattedValue}</span>
            </div>
        `;
    }

    private formatFacetValue(facet: EntityFacet): string {
        const value = facet.value;

        // Handle different value types
        if (this.isUrl(value)) {
            return `<a href="${value}" target="_blank" class="facet-link">${this.truncateText(value, 30)}</a>`;
        }

        if (this.isDate(value)) {
            return this.formatDate(value);
        }

        if (this.isNumber(value)) {
            return this.formatNumber(value);
        }

        // Default: truncate long text values
        return this.truncateText(this.escapeHtml(value), 50);
    }

    private isUrl(value: string): boolean {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    }

    private isDate(value: string): boolean {
        const date = new Date(value);
        return (
            !isNaN(date.getTime()) && value.match(/^\d{4}-\d{2}-\d{2}/) !== null
        );
    }

    private isNumber(value: string): boolean {
        return (
            !isNaN(Number(value)) &&
            !isNaN(parseFloat(value)) &&
            isFinite(Number(value))
        );
    }

    private formatNumber(value: string): string {
        const num = parseFloat(value);
        return num.toLocaleString();
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + "...";
    }

    private renderDomains(): void {
        const domainsSection = document.getElementById("entityDomains");
        if (!domainsSection) return;

        const domainsList = domainsSection.querySelector(".domains-list");
        if (!domainsList) return;

        // Handle case where dominantDomains might not exist in real entity data
        let domains =
            this.currentEntity.dominantDomains ||
            this.currentEntity.domains ||
            [];

        // If no domains, try to extract from URL if available
        if (domains.length === 0 && this.currentEntity.url) {
            try {
                const domain = new URL(this.currentEntity.url).hostname.replace(
                    "www.",
                    "",
                );
                domains = [domain];
            } catch (e) {
                // Skip invalid URLs
            }
        }

        if (domains.length === 0) {
            domainsList.innerHTML =
                '<span class="empty-message">No domains</span>';
            return;
        }

        const domainsHtml = domains
            .map(
                (domain: string) =>
                    `<span class="domain-tag">${this.escapeHtml(domain)}</span>`,
            )
            .join("");

        domainsList.innerHTML = domainsHtml;
    }

    private renderTopics(): void {
        const topicsSection = document.getElementById("entityTopics");
        if (!topicsSection || !this.currentEntity.topicAffinity) return;

        const topicsList = topicsSection.querySelector(".topics-list");
        if (!topicsList) return;

        if (this.currentEntity.topicAffinity.length === 0) {
            topicsList.innerHTML =
                '<span class="empty-message">No topics</span>';
            return;
        }

        const topicsHtml = this.currentEntity.topicAffinity
            .map(
                (topic: string) =>
                    `<span class="topic-tag">${this.escapeHtml(topic)}</span>`,
            )
            .join("");

        topicsList.innerHTML = topicsHtml;
    }

    private renderEntityTimeline(): void {
        if (!this.currentEntity) return;

        const firstSeenEl = document.getElementById("entityFirstSeen");
        const lastSeenEl = document.getElementById("entityLastSeen");

        if (firstSeenEl) {
            // Handle various possible date field names from real entity data
            const firstSeen =
                this.currentEntity.firstSeen ||
                this.currentEntity.firstVisit ||
                this.currentEntity.dateAdded ||
                this.currentEntity.createdAt;

            if (firstSeen) {
                firstSeenEl.textContent = this.formatDate(firstSeen);
            } else {
                firstSeenEl.textContent = "-";
            }
        }

        if (lastSeenEl) {
            // Handle various possible date field names from real entity data
            const lastSeen =
                this.currentEntity.lastSeen ||
                this.currentEntity.lastVisit ||
                this.currentEntity.lastVisited ||
                this.currentEntity.updatedAt;

            if (lastSeen) {
                lastSeenEl.textContent = this.formatDate(lastSeen);
            } else {
                lastSeenEl.textContent = "-";
            }
        }
    }

    private renderEmptyState(): void {
        const nameEl = document.getElementById("entityName");
        const typeEl = document.getElementById("entityType");
        const confidenceEl = document.getElementById("entityConfidence");
        const mentionsEl = document.getElementById("entityMentions");
        const relationshipsEl = document.getElementById("entityRelationships");
        const centralityEl = document.getElementById("entityCentrality");
        const firstSeenEl = document.getElementById("entityFirstSeen");
        const lastSeenEl = document.getElementById("entityLastSeen");

        if (nameEl) nameEl.textContent = "Select an Entity";
        if (typeEl) typeEl.textContent = "";
        if (confidenceEl) confidenceEl.textContent = "";
        if (mentionsEl) mentionsEl.textContent = "-";
        if (relationshipsEl) relationshipsEl.textContent = "-";
        if (centralityEl) centralityEl.textContent = "-";
        if (firstSeenEl) firstSeenEl.textContent = "-";
        if (lastSeenEl) lastSeenEl.textContent = "-";

        // Clear details sections
        const facetsSection = document.getElementById("entityFacets");
        const domainsSection = document.getElementById("entityDomains");
        const topicsSection = document.getElementById("entityTopics");

        if (facetsSection) {
            const facetsList = facetsSection.querySelector(".facets-list");
            if (facetsList)
                facetsList.innerHTML =
                    '<span class="empty-message">No facets</span>';
        }

        if (domainsSection) {
            const domainsList = domainsSection.querySelector(".domains-list");
            if (domainsList)
                domainsList.innerHTML =
                    '<span class="empty-message">No domains</span>';
        }

        if (topicsSection) {
            const topicsList = topicsSection.querySelector(".topics-list");
            if (topicsList)
                topicsList.innerHTML =
                    '<span class="empty-message">No topics</span>';
        }

        // Reset icon
        const iconEl = document.getElementById("entityIcon");
        if (iconEl) {
            iconEl.className = "entity-icon";
            iconEl.innerHTML = '<i class="bi bi-diagram-2"></i>';
        }
    }

    private getEntityIcon(type: string): string {
        const iconMap: { [key: string]: string } = {
            person: '<i class="bi bi-person"></i>',
            organization: '<i class="bi bi-building"></i>',
            product: '<i class="bi bi-box"></i>',
            concept: '<i class="bi bi-lightbulb"></i>',
            location: '<i class="bi bi-geo"></i>',
            technology: '<i class="bi bi-cpu"></i>',
            event: '<i class="bi bi-calendar-event"></i>',
            document: '<i class="bi bi-file-text"></i>',
            website: '<i class="bi bi-globe"></i>',
            topic: '<i class="bi bi-tag"></i>',
            related_entity: '<i class="bi bi-link-45deg"></i>',
        };

        return iconMap[type] || '<i class="bi bi-diagram-2"></i>';
    }

    private getRelationshipStrengthClass(strength: number): string {
        if (strength >= 0.7) return "relationship-strength-high";
        if (strength >= 0.4) return "relationship-strength-medium";
        return "relationship-strength-low";
    }

    private formatRelationshipType(type: string): string {
        return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    }

    private formatDate(dateString: string | undefined | null): string {
        if (!dateString) {
            return "-";
        }
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return "-";
            }
            return date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return "-";
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}
