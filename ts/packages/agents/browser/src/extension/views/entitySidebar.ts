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
    private mockMode: boolean = true;

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
        this.currentEntity =
            fullEntityData || this.createMockEntityData(entityData);
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

    /**
     * Set mock mode
     */
    setMockMode(enabled: boolean): void {
        this.mockMode = enabled;
    }

    private renderEntityHeader(): void {
        if (!this.currentEntity) return;

        const iconEl = document.getElementById("entityIcon");
        const nameEl = document.getElementById("entityName");
        const typeEl = document.getElementById("entityType");
        const confidenceEl = document.getElementById("entityConfidence");

        if (iconEl) {
            iconEl.className = `entity-icon entity-type-${this.currentEntity.type}`;
            iconEl.innerHTML = this.getEntityIcon(this.currentEntity.type);
        }

        if (nameEl) {
            nameEl.textContent = this.currentEntity.name;
        }

        if (typeEl) {
            typeEl.textContent = this.currentEntity.type;
            typeEl.className = `entity-type-badge entity-type-${this.currentEntity.type}`;
        }

        if (confidenceEl) {
            const confidence = Math.round(this.currentEntity.confidence * 100);
            confidenceEl.innerHTML = `
                <i class="bi bi-shield-check"></i>
                Confidence: ${confidence}%
            `;
        }
    }

    private renderEntityMetrics(): void {
        if (!this.currentEntity) return;

        const mentionsEl = document.getElementById("entityMentions");
        const relationshipsEl = document.getElementById("entityRelationships");
        const centralityEl = document.getElementById("entityCentrality");

        if (mentionsEl) {
            mentionsEl.textContent = this.currentEntity.mentionCount.toString();
        }

        if (relationshipsEl) {
            const relationshipCount =
                this.currentEntity.strongRelationships?.length || 0;
            relationshipsEl.textContent = relationshipCount.toString();
        }

        if (centralityEl) {
            const centrality = this.currentEntity.centrality || 0;
            centralityEl.textContent = Math.round(centrality * 100) + "%";
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
        if (!aliasesSection || !this.currentEntity.aliases) return;

        const aliasesList = aliasesSection.querySelector(".aliases-list");
        if (!aliasesList) return;

        if (this.currentEntity.aliases.length === 0) {
            aliasesList.innerHTML =
                '<span class="empty-message">No aliases</span>';
            return;
        }

        const aliasesHtml = this.currentEntity.aliases
            .map(
                (alias: string) =>
                    `<span class="alias-tag">${this.escapeHtml(alias)}</span>`,
            )
            .join("");

        aliasesList.innerHTML = aliasesHtml;
    }

    private renderDomains(): void {
        const domainsSection = document.getElementById("entityDomains");
        if (!domainsSection || !this.currentEntity.dominantDomains) return;

        const domainsList = domainsSection.querySelector(".domains-list");
        if (!domainsList) return;

        if (this.currentEntity.dominantDomains.length === 0) {
            domainsList.innerHTML =
                '<span class="empty-message">No domains</span>';
            return;
        }

        const domainsHtml = this.currentEntity.dominantDomains
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
            firstSeenEl.textContent = this.formatDate(
                this.currentEntity.firstSeen,
            );
        }

        if (lastSeenEl) {
            lastSeenEl.textContent = this.formatDate(
                this.currentEntity.lastSeen,
            );
        }
    }

    private renderRelatedEntities(): void {
        const relatedEntitiesList = document.getElementById(
            "relatedEntitiesList",
        );
        if (!relatedEntitiesList || !this.currentEntity.strongRelationships)
            return;

        if (this.currentEntity.strongRelationships.length === 0) {
            relatedEntitiesList.innerHTML =
                '<div class="empty-message">No related entities</div>';
            return;
        }

        const relatedHtml = this.currentEntity.strongRelationships
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
        const strengthClass = this.getRelationshipStrengthClass(
            relationship.strength,
        );
        const strengthPercentage = Math.round(relationship.strength * 100);

        return `
            <div class="related-entity-item" data-entity="${this.escapeHtml(relationship.relatedEntity)}">
                <div class="related-entity-icon">
                    <i class="bi bi-diagram-2"></i>
                </div>
                <div class="related-entity-info">
                    <div class="related-entity-name">${this.escapeHtml(relationship.relatedEntity)}</div>
                    <div class="related-entity-type">${this.escapeHtml(relationship.relationshipType)}</div>
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
        if (!filterSelect || !this.currentEntity.strongRelationships) return;

        // Get unique relationship types
        const relationshipTypes = new Set<string>(
            this.currentEntity.strongRelationships.map(
                (rel: any) => rel.relationshipType,
            ),
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

    private createMockEntityData(nodeData: EntityData | string): any {
        // Create enhanced mock data based on the node data
        const name = typeof nodeData === "string" ? nodeData : nodeData.name;
        const type =
            typeof nodeData === "string" ? "organization" : nodeData.type;
        const confidence =
            typeof nodeData === "string" ? 0.8 : nodeData.confidence;

        const mockData = {
            name: name,
            type: type,
            confidence: confidence,
            mentionCount: Math.floor(Math.random() * 100) + 10,
            centrality: confidence || 0.5,
            importance:
                typeof nodeData === "object" && nodeData.importance
                    ? nodeData.importance
                    : 0.5,
            clusterGroup:
                typeof nodeData === "object" && nodeData.clusterGroup
                    ? nodeData.clusterGroup
                    : "general",
            aliases: this.generateMockAliases(name, type),
            dominantDomains: this.generateMockDomains(type),
            topicAffinity: this.generateMockTopics(type),
            firstSeen: this.generateMockDate(-90), // 3 months ago
            lastSeen: this.generateMockDate(-1), // Yesterday
            strongRelationships: this.generateMockRelationships(name, type),
        };

        return mockData;
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

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
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

        if (!relatedEntitiesList || !this.currentEntity?.strongRelationships)
            return;

        const relationshipTypeFilter_value =
            relationshipTypeFilter?.value || "";
        const entityTypeFilter_value = entityTypeFilter?.value || "";

        let filteredRelationships = this.currentEntity.strongRelationships;

        // Filter by relationship type
        if (relationshipTypeFilter_value) {
            filteredRelationships = filteredRelationships.filter(
                (rel: any) =>
                    rel.relationshipType === relationshipTypeFilter_value,
            );
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
