// Enhanced Entity Graph Visualizer Implementation
// Extends the basic EntityGraphVisualizer with rich interactive features

import { EntityGraphVisualizer } from "./entityGraphVisualizer.js";

export interface EntityPreview {
    name: string;
    type: string;
    confidence: number;
    relationshipCount: number;
    summary: string;
}

export interface RelationshipDetails {
    fromEntity: string;
    toEntity: string;
    relationshipType: string;
    strength: number;
    confidence: number;
    evidenceSources: string[];
    contextSnippets: string[];
}

export interface DiscoveryPath {
    pathId: string;
    description: string;
    entities: string[];
    pathType: "learning_journey" | "relationship_chain" | "topic_exploration";
    estimatedValue: number;
}

export interface EntitySuggestion {
    entity: string;
    reason: string;
    confidence: number;
    relationshipTypes: string[];
}

/**
 * Enhanced Entity Graph Visualizer with Interactive Features
 */
export class EnhancedEntityGraphVisualizer extends EntityGraphVisualizer {
    private selectedEntities: Set<string> = new Set();
    private previewContainer: HTMLElement | null = null;
    private relationshipPanel: HTMLElement | null = null;
    private discoveryPanel: HTMLElement | null = null;
    private isMultiSelectMode: boolean = false;
    private edgeClickCallback: ((edgeData: any) => void) | null = null;

    /**
     * Set up advanced interactions
     */
    setupAdvancedInteractions(): void {
        if (!this.cy) return;

        // Entity hover with relationship highlighting
        this.cy.on("mouseover", "node", (evt: any) => {
            this.highlightEntityNetwork(evt.target);
            this.showEntityPreview(evt.target);
        });

        this.cy.on("mouseout", "node", (evt: any) => {
            this.clearEntityHighlights();
            this.hideEntityPreview();
        });

        // Relationship exploration
        this.cy.on("tap", "edge", (evt: any) => {
            const edgeData = evt.target.data();
            if (this.edgeClickCallback) {
                this.edgeClickCallback(edgeData);
            }
            console.log("Edge clicked:", edgeData);
        });

        // Multi-selection for comparison (right-click)
        this.cy.on("cxttap", "node", (evt: any) => {
            evt.preventDefault();
            this.toggleEntitySelection(evt.target);
        });

        // Double-click for expansion - simplified for now
        this.cy.on("dblclick", "node", (evt: any) => {
            console.log("Double-click expansion for:", evt.target.data("name"));
        });
    }

    /**
     * Highlight entity network on hover
     */
    private highlightEntityNetwork(entity: any): void {
        if (!this.cy) return;

        // Dim all elements
        this.cy.elements().addClass("dimmed");

        // Highlight the selected entity
        entity.removeClass("dimmed").addClass("highlighted");

        // Highlight connected entities and edges
        const connectedEdges = entity.connectedEdges();
        const connectedNodes = connectedEdges.connectedNodes();

        connectedEdges.removeClass("dimmed").addClass("highlighted-edge");
        connectedNodes.removeClass("dimmed").addClass("highlighted-neighbor");
    }

    /**
     * Clear entity-specific highlights
     */
    private clearEntityHighlights(): void {
        if (!this.cy) return;

        this.cy
            .elements()
            .removeClass(
                "dimmed highlighted highlighted-edge highlighted-neighbor",
            );
    }

    /**
     * Show entity preview on hover
     */
    private showEntityPreview(entity: any): void {
        const entityData = entity.data();
        const preview = this.generateEntityPreview(entityData);

        if (!this.previewContainer) {
            this.createPreviewContainer();
        }

        if (this.previewContainer) {
            this.previewContainer.innerHTML = this.renderEntityPreview(preview);
            this.previewContainer.style.display = "block";

            // Position preview near cursor
            this.positionPreview(entity);
        }
    }

    /**
     * Hide entity preview
     */
    private hideEntityPreview(): void {
        if (this.previewContainer) {
            this.previewContainer.style.display = "none";
        }
    }

    /**
     * Create preview container
     */
    private createPreviewContainer(): void {
        this.previewContainer = document.createElement("div");
        this.previewContainer.className = "entity-preview-tooltip";
        this.previewContainer.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            max-width: 300px;
            font-size: 14px;
            display: none;
        `;

        document.body.appendChild(this.previewContainer);
    }

    /**
     * Position preview near entity
     */
    private positionPreview(entity: any): void {
        if (!this.previewContainer || !this.cy) return;

        const renderedPosition = entity.renderedPosition();
        const containerRect = this.cy.container().getBoundingClientRect();

        const x = containerRect.left + renderedPosition.x + 20;
        const y = containerRect.top + renderedPosition.y - 10;

        this.previewContainer.style.left = `${x}px`;
        this.previewContainer.style.top = `${y}px`;
    }

    /**
     * Generate entity preview data
     */
    private generateEntityPreview(entityData: any): EntityPreview {
        return {
            name: entityData.name,
            type: entityData.type,
            confidence: entityData.confidence || 0.8,
            relationshipCount: this.getEntityRelationshipCount(entityData.name),
            summary: `${entityData.type} entity with ${this.getEntityRelationshipCount(entityData.name)} connections`,
        };
    }

    /**
     * Render entity preview HTML
     */
    private renderEntityPreview(preview: EntityPreview): string {
        return `
            <div class="entity-preview">
                <div class="entity-preview-header">
                    <div class="entity-preview-icon entity-type-${preview.type}"></div>
                    <div class="entity-preview-info">
                        <div class="entity-preview-name">${preview.name}</div>
                        <div class="entity-preview-type">${preview.type}</div>
                    </div>
                </div>
                <div class="entity-preview-metrics">
                    <div class="metric-item">
                        <span class="metric-label">Confidence:</span>
                        <span class="metric-value">${Math.round(preview.confidence * 100)}%</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">Connections:</span>
                        <span class="metric-value">${preview.relationshipCount}</span>
                    </div>
                </div>
                <div class="entity-preview-summary">${preview.summary}</div>
            </div>
        `;
    }

    /**
     * Get relationship count for entity
     */
    private getEntityRelationshipCount(entityName: string): number {
        if (!this.cy) return 0;

        const entity = this.cy.getElementById(entityName);
        return entity.connectedEdges().length;
    }

    /**
     * Toggle entity selection for comparison
     */
    private toggleEntitySelection(entity: any): void {
        const entityName = entity.data("name");

        if (this.selectedEntities.has(entityName)) {
            this.selectedEntities.delete(entityName);
            entity.removeClass("selected");
        } else {
            this.selectedEntities.add(entityName);
            entity.addClass("selected");
        }

        this.updateSelectionUI();
    }

    /**
     * Update selection UI
     */
    private updateSelectionUI(): void {
        const count = this.selectedEntities.size;

        // Dispatch event for UI updates
        const event = new CustomEvent("selectionChanged", {
            detail: {
                selectedCount: count,
                selectedEntities: Array.from(this.selectedEntities),
            },
        });
        document.dispatchEvent(event);
    }

    /**
     * Clear all selections
     */
    clearSelections(): void {
        this.selectedEntities.clear();
        if (this.cy) {
            this.cy.nodes().removeClass("selected");
        }
        this.updateSelectionUI();
    }

    /**
     * Get selected entities
     */
    getSelectedEntities(): string[] {
        return Array.from(this.selectedEntities);
    }

    /**
     * Focus on specific entity
     */
    focusOnEntity(entityName: string): void {
        if (!this.cy) return;

        const entity = this.cy.getElementById(entityName);
        if (entity.length) {
            this.cy.center(entity);
            this.cy.fit(entity, 200);

            // Temporarily highlight
            entity.addClass("focused");
            setTimeout(() => {
                entity.removeClass("focused");
            }, 2000);
        }
    }

    /**
     * Override parent class methods to add enhanced styling
     */
    protected getDefaultStyles(): any[] {
        const baseStyles = super.getDefaultStyles();

        // Add enhanced styles for interactive features
        const enhancedStyles = [
            // Hover and selection states
            {
                selector: "node.highlighted",
                style: {
                    "border-width": 4,
                    "border-color": "#007acc",
                    "z-index": 999,
                },
            },
            {
                selector: "node.highlighted-neighbor",
                style: {
                    "border-width": 2,
                    "border-color": "#4dabf7",
                    opacity: 1,
                },
            },
            {
                selector: "node.selected",
                style: {
                    "border-width": 3,
                    "border-color": "#ff6b35",
                    "border-style": "dashed",
                },
            },
            {
                selector: "node.focused",
                style: {
                    "border-width": 4,
                    "border-color": "#28a745",
                    "z-index": 999,
                },
            },
            {
                selector: "node.dimmed",
                style: {
                    opacity: 0.3,
                },
            },
            {
                selector: "edge.highlighted-edge",
                style: {
                    "line-color": "#007acc",
                    "target-arrow-color": "#007acc",
                    width: 4,
                    opacity: 1,
                    "z-index": 999,
                },
            },
            {
                selector: "edge.dimmed",
                style: {
                    opacity: 0.2,
                },
            },
        ];

        return [...baseStyles, ...enhancedStyles];
    }

    /**
     * Initialize enhanced features
     */
    async initialize(): Promise<void> {
        await super.initialize();
        this.setupAdvancedInteractions();
        this.setupEnhancedEventHandlers();
    }

    /**
     * Set up enhanced event handlers
     */
    private setupEnhancedEventHandlers(): void {
        // Listen for external events
        document.addEventListener("focusEntity", (e: any) => {
            this.focusOnEntity(e.detail.entityName);
        });

        document.addEventListener("clearSelections", () => {
            this.clearSelections();
        });
    }

    /**
     * Set edge click callback
     */
    onEdgeClick(callback: (edgeData: any) => void): void {
        this.edgeClickCallback = callback;
    }

    /**
     * Add elements to the graph (for multi-hop expansion)
     */
    async addElements(data: {
        entities: any[];
        relationships: any[];
    }): Promise<void> {
        if (!this.cy) return;

        const newElements: any[] = [];

        // Add new entities (check if they don't already exist)
        data.entities.forEach((entity) => {
            if (this.cy.getElementById(entity.name).length === 0) {
                newElements.push({
                    group: "nodes",
                    data: {
                        id: entity.name,
                        name: entity.name,
                        type: entity.type,
                        confidence: entity.confidence,
                    },
                });
            }
        });

        // Add new relationships
        data.relationships.forEach((rel) => {
            const edgeId = `${rel.from}-${rel.to}`;
            if (this.cy.getElementById(edgeId).length === 0) {
                newElements.push({
                    group: "edges",
                    data: {
                        id: edgeId,
                        source: rel.from,
                        target: rel.to,
                        type: rel.type,
                        strength: rel.strength,
                    },
                });
            }
        });

        // Add new elements to graph
        if (newElements.length > 0) {
            this.cy.add(newElements);
        }
    }

    /**
     * Remove connected elements (for collapse functionality)
     */
    async removeConnectedElements(centerEntity: string): Promise<void> {
        if (!this.cy) return;

        const centerNode = this.cy.getElementById(centerEntity);
        if (centerNode.length === 0) return;

        // Get connected elements that should be removed
        const connectedEdges = centerNode.connectedEdges();
        const connectedNodes = connectedEdges.connectedNodes();

        // Remove nodes that have degree 1 (only connected to center)
        const nodesToRemove = connectedNodes.filter(
            (node: any) => node.degree() === 1,
        );
        const edgesToRemove = nodesToRemove.connectedEdges();

        // Remove elements
        this.cy.remove(nodesToRemove);
        this.cy.remove(edgesToRemove);
    }

    /**
     * Reset graph to initial state
     */
    async reset(): Promise<void> {
        if (!this.cy) return;

        this.cy.elements().remove();
        this.clearSelections();
    }

    /**
     * Apply layout
     */
    applyCurrentLayout(): void {
        this.changeLayout(this.getCurrentLayout());
    }
    destroy(): void {
        // Clean up created elements
        if (this.previewContainer) {
            this.previewContainer.remove();
            this.previewContainer = null;
        }

        // Clear selections
        this.clearSelections();

        // Call parent cleanup
        super.destroy();
    }
}
