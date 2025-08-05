// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// EntitySidebar types and interfaces

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
        this.currentEntity = fullEntityData || entityData;
        this.renderEntityHeader();
        this.renderEntityMetrics();
        this.renderEntityDetails();
        this.renderEntityTimeline();
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

        this.renderAliases();
        this.renderDomains();
        this.renderTopics();
    }

    private renderAliases(): void {
        const aliasesSection = document.getElementById("entityAliases");
        if (!aliasesSection) return;

        const aliasesList = aliasesSection.querySelector(".aliases-list");
        if (!aliasesList) return;

        // Handle case where aliases might not exist in real entity data
        const aliases = this.currentEntity.aliases || [];

        if (aliases.length === 0) {
            aliasesList.innerHTML =
                '<span class="empty-message">No aliases</span>';
            return;
        }

        const aliasesHtml = aliases
            .map(
                (alias: string) =>
                    `<span class="alias-tag">${this.escapeHtml(alias)}</span>`,
            )
            .join("");

        aliasesList.innerHTML = aliasesHtml;
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
        const aliasesSection = document.getElementById("entityAliases");
        const domainsSection = document.getElementById("entityDomains");
        const topicsSection = document.getElementById("entityTopics");

        if (aliasesSection) {
            const aliasesList = aliasesSection.querySelector(".aliases-list");
            if (aliasesList)
                aliasesList.innerHTML =
                    '<span class="empty-message">No aliases</span>';
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
