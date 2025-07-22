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
        this.renderRelatedEntities();
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
            const relationshipCount =
                this.currentEntity.strongRelationships?.length ||
                this.currentEntity.relationships?.length ||
                0;
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
        const domains =
            this.currentEntity.dominantDomains ||
            this.currentEntity.domains ||
            [];

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
            firstSeenEl.textContent = this.formatDate(firstSeen);
        }

        if (lastSeenEl) {
            // Handle various possible date field names from real entity data
            const lastSeen =
                this.currentEntity.lastSeen ||
                this.currentEntity.lastVisit ||
                this.currentEntity.lastVisited ||
                this.currentEntity.updatedAt;
            lastSeenEl.textContent = this.formatDate(lastSeen);
        }
    }

    private renderRelatedEntities(): void {
        const relatedEntitiesList = document.getElementById(
            "relatedEntitiesList",
        );
        if (!relatedEntitiesList) return;

        // Handle various relationship field names from real entity data
        const relationships =
            this.currentEntity?.strongRelationships ||
            this.currentEntity?.relationships ||
            this.currentEntity?.relatedEntities ||
            [];

        if (!relationships || relationships.length === 0) {
            relatedEntitiesList.innerHTML =
                '<div class="empty-message">No related entities</div>';
            return;
        }

        const relatedHtml = relationships
            .sort((a: any, b: any) => b.strength - a.strength)
            .slice(0, 10) // Show top 10 relationships
            .map((rel: any) => this.renderRelatedEntityItem(rel))
            .join("");

        relatedEntitiesList.innerHTML = relatedHtml;

        // Add click handlers
        relatedEntitiesList
            .querySelectorAll(".related-entity-item")
            .forEach((item) => {
                item.addEventListener("click", () => {
                    const entityName = item.getAttribute("data-entity");
                    if (entityName) {
                        this.onRelatedEntityClick(entityName);
                    }
                });
            });

        // Update relationship type filter
        this.updateRelationshipTypeFilter();
    }

    private renderRelatedEntityItem(relationship: any): string {
        const strength =
            relationship.strength || relationship.confidence || 0.5;
        const strengthClass = this.getRelationshipStrengthClass(strength);
        const strengthPercentage = Math.round(strength * 100);
        const entityName =
            relationship.relatedEntity ||
            relationship.name ||
            relationship.entity ||
            "Unknown";
        const relationshipType =
            relationship.relationshipType || relationship.type || "related_to";

        return `
            <div class="related-entity-item" data-entity="${this.escapeHtml(entityName)}">
                <div class="related-entity-icon">
                    <i class="bi bi-diagram-2"></i>
                </div>
                <div class="related-entity-info">
                    <div class="related-entity-name">${this.escapeHtml(entityName)}</div>
                    <div class="related-entity-type">${this.escapeHtml(relationshipType)}</div>
                </div>
                <div class="related-entity-strength ${strengthClass}">
                    ${strengthPercentage}%
                </div>
            </div>
        `;
    }

    private updateRelationshipTypeFilter(): void {
        const filterSelect = document.getElementById(
            "relationshipTypeFilter",
        ) as HTMLSelectElement;
        if (!filterSelect) return;

        // Handle various relationship field names from real entity data
        const relationships =
            this.currentEntity?.strongRelationships ||
            this.currentEntity?.relationships ||
            this.currentEntity?.relatedEntities ||
            [];

        if (!relationships || relationships.length === 0) return;

        // Get unique relationship types
        const relationshipTypes = new Set<string>(
            relationships
                .map(
                    (rel: any) =>
                        rel.relationshipType || rel.type || "related_to",
                )
                .filter((type: string) => type && type.trim()),
        );

        // Clear existing options (except "All Relationships")
        while (filterSelect.children.length > 1) {
            filterSelect.removeChild(filterSelect.lastChild!);
        }

        // Add relationship type options
        Array.from(relationshipTypes).forEach((type: string) => {
            const option = document.createElement("option");
            option.value = type;
            option.textContent = this.formatRelationshipType(type);
            filterSelect.appendChild(option);
        });
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
        const relatedEntitiesList = document.getElementById(
            "relatedEntitiesList",
        );

        if (nameEl) nameEl.textContent = "Select an Entity";
        if (typeEl) typeEl.textContent = "";
        if (confidenceEl) confidenceEl.textContent = "";
        if (mentionsEl) mentionsEl.textContent = "-";
        if (relationshipsEl) relationshipsEl.textContent = "-";
        if (centralityEl) centralityEl.textContent = "-";
        if (firstSeenEl) firstSeenEl.textContent = "-";
        if (lastSeenEl) lastSeenEl.textContent = "-";

        if (relatedEntitiesList) {
            relatedEntitiesList.innerHTML =
                '<div class="empty-message">Select an entity to see related items</div>';
        }

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

    private generateMockAliases(name: string, type: string): string[] {
        const aliases: string[] = [];

        if (type === "technology") {
            if (name === "React") {
                aliases.push("React.js", "ReactJS");
            } else if (name === "Next.js") {
                aliases.push("NextJS", "Next");
            } else if (name === "TypeScript") {
                aliases.push("TS");
            }
        } else if (type === "organization") {
            if (name === "Facebook") {
                aliases.push("Meta", "Meta Platforms");
            } else if (name === "Apple") {
                aliases.push("Apple Inc.", "AAPL");
            }
        } else if (type === "person") {
            if (name === "Satya Nadella") {
                aliases.push("@satyanadella", "Satya Narayana Nadella");
            }
        }

        return aliases;
    }

    private generateMockDomains(type: string): string[] {
        const domainMap: { [key: string]: string[] } = {
            technology: [
                "github.com",
                "stackoverflow.com",
                "docs.microsoft.com",
            ],
            organization: [
                "linkedin.com",
                "techcrunch.com",
                "bloomberg.com",
                "cnbc.com",
            ],
            person: ["linkedin.com", "wikipedia.org"],
            product: ["productHunt.com", "techreview.com", "wired.com"],
        };

        return domainMap[type] || ["example.com"];
    }

    private generateMockTopics(type: string): string[] {
        const topicMap: { [key: string]: string[] } = {
            technology: [
                "software development",
                "web development",
                "programming",
            ],
            organization: ["business", "technology", "innovation"],
            person: ["leadership", "entrepreneurship", "technology"],
            product: ["consumer electronics", "technology", "design"],
        };

        return topicMap[type] || ["general"];
    }

    private generateMockDate(daysAgo: number): string {
        const date = new Date();
        date.setDate(date.getDate() + daysAgo);
        return date.toISOString();
    }

    private generateMockRelationships(
        entityName: string,
        entityType: string,
    ): any[] {
        // Generate contextual mock relationships based on entity
        const relationships: any[] = [];

        if (entityName === "React") {
            relationships.push(
                {
                    relatedEntity: "Facebook",
                    relationshipType: "created_by",
                    strength: 0.9,
                    confidence: 0.95,
                },
                {
                    relatedEntity: "Next.js",
                    relationshipType: "framework_for",
                    strength: 0.8,
                    confidence: 0.9,
                },
                {
                    relatedEntity: "TypeScript",
                    relationshipType: "commonly_used_with",
                    strength: 0.7,
                    confidence: 0.85,
                },
            );
        } else if (entityName === "Microsoft") {
            relationships.push(
                {
                    relatedEntity: "Satya Nadella",
                    relationshipType: "led_by",
                    strength: 0.9,
                    confidence: 0.95,
                },
                {
                    relatedEntity: "Azure",
                    relationshipType: "develops",
                    strength: 0.95,
                    confidence: 0.98,
                },
                {
                    relatedEntity: "Office365",
                    relationshipType: "develops",
                    strength: 0.6,
                    confidence: 0.8,
                },
            );
        } else {
            // Generate generic relationships
            relationships.push(
                {
                    relatedEntity: "Related Entity 1",
                    relationshipType: "related_to",
                    strength: 0.6,
                    confidence: 0.7,
                },
                {
                    relatedEntity: "Related Entity 2",
                    relationshipType: "connected_to",
                    strength: 0.4,
                    confidence: 0.6,
                },
            );
        }

        return relationships;
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

    private onRelatedEntityClick(entityName: string): void {
        // Emit custom event for entity navigation
        const event = new CustomEvent("entityNavigate", {
            detail: { entityName },
        });
        this.container.dispatchEvent(event);
    }

    /**
     * Set up entity type and relationship filters
     */
    setupFilters(onFilterChange?: (filters: any) => void): void {
        const relationshipTypeFilter = document.getElementById(
            "relationshipTypeFilter",
        ) as HTMLSelectElement;
        const entityTypeFilter = document.getElementById(
            "entityTypeFilter",
        ) as HTMLSelectElement;

        if (relationshipTypeFilter) {
            relationshipTypeFilter.addEventListener("change", () => {
                this.applyRelatedEntitiesFilter();
                if (onFilterChange) {
                    onFilterChange({
                        relationshipType: relationshipTypeFilter.value,
                        entityType: entityTypeFilter?.value,
                    });
                }
            });
        }

        if (entityTypeFilter) {
            entityTypeFilter.addEventListener("change", () => {
                this.applyRelatedEntitiesFilter();
                if (onFilterChange) {
                    onFilterChange({
                        relationshipType: relationshipTypeFilter?.value,
                        entityType: entityTypeFilter.value,
                    });
                }
            });
        }
    }

    private applyRelatedEntitiesFilter(): void {
        const relationshipTypeFilter = document.getElementById(
            "relationshipTypeFilter",
        ) as HTMLSelectElement;
        const entityTypeFilter = document.getElementById(
            "entityTypeFilter",
        ) as HTMLSelectElement;
        const relatedEntitiesList = document.getElementById(
            "relatedEntitiesList",
        );

        if (!relatedEntitiesList) return;

        // Handle various relationship field names from real entity data
        const relationships =
            this.currentEntity?.strongRelationships ||
            this.currentEntity?.relationships ||
            this.currentEntity?.relatedEntities ||
            [];

        if (!relationships || relationships.length === 0) return;

        const relationshipTypeFilter_value =
            relationshipTypeFilter?.value || "";
        const entityTypeFilter_value = entityTypeFilter?.value || "";

        let filteredRelationships = relationships;

        // Filter by relationship type
        if (relationshipTypeFilter_value) {
            filteredRelationships = filteredRelationships.filter((rel: any) => {
                const relType =
                    rel.relationshipType || rel.type || "related_to";
                return relType === relationshipTypeFilter_value;
            });
        }

        // For entity type filtering, we'd need more data about the related entities
        // This would be implemented in Phase 4 with real data

        // Re-render with filtered relationships
        if (filteredRelationships.length === 0) {
            relatedEntitiesList.innerHTML =
                '<div class="empty-message">No matching relationships</div>';
        } else {
            const relatedHtml = filteredRelationships
                .sort((a: any, b: any) => b.strength - a.strength)
                .slice(0, 10)
                .map((rel: any) => this.renderRelatedEntityItem(rel))
                .join("");

            relatedEntitiesList.innerHTML = relatedHtml;

            // Re-add click handlers
            relatedEntitiesList
                .querySelectorAll(".related-entity-item")
                .forEach((item) => {
                    item.addEventListener("click", () => {
                        const entityName = item.getAttribute("data-entity");
                        if (entityName) {
                            this.onRelatedEntityClick(entityName);
                        }
                    });
                });
        }
    }
}
