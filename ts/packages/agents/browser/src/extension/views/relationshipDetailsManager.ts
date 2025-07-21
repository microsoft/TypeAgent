// Relationship Details Implementation
// Detailed relationship information and analysis for entity graphs

export interface RelationshipDetails {
    fromEntity: string;
    toEntity: string;
    relationshipType: string;
    strength: number;
    confidence: number;
    evidenceSources: string[];
    contextSnippets: string[];
    firstObserved: string;
    lastObserved: string;
    frequency: number;
    direction: "bidirectional" | "unidirectional";
    temporalPattern?: "increasing" | "decreasing" | "stable" | "periodic";
}

export interface RelationshipMetrics {
    totalRelationships: number;
    averageStrength: number;
    strongestRelationship: RelationshipDetails;
    weakestRelationship: RelationshipDetails;
    relationshipTypes: { [type: string]: number };
    confidenceDistribution: { [range: string]: number };
}

export interface RelationshipComparison {
    relationship1: RelationshipDetails;
    relationship2: RelationshipDetails;
    similarities: string[];
    differences: string[];
    strengthDifference: number;
    confidenceDifference: number;
}

/**
 * Relationship Details Component
 * Handles detailed relationship analysis, visualization, and comparison
 */
export class RelationshipDetailsManager {
    private detailsPanel: HTMLElement | null = null;
    private comparisonPanel: HTMLElement | null = null;
    private currentRelationship: RelationshipDetails | null = null;
    private selectedRelationships: RelationshipDetails[] = [];
    private mockMode: boolean = true;

    constructor() {
        this.initializeRelationshipPanels();
        this.setupRelationshipEventHandlers();
    }

    /**
     * Initialize relationship detail panels
     */
    private initializeRelationshipPanels(): void {
        this.createDetailsPanel();
        this.createComparisonPanel();
        this.setupPanelControls();
    }

    /**
     * Create relationship details panel
     */
    private createDetailsPanel(): void {
        // Check if panel already exists
        this.detailsPanel = document.getElementById("relationshipDetailsPanel");

        if (!this.detailsPanel) {
            this.detailsPanel = document.createElement("div");
            this.detailsPanel.id = "relationshipDetailsPanel";
            this.detailsPanel.className = "relationship-details-panel";
            this.detailsPanel.innerHTML = `
                <div class="panel-header">
                    <h3>Relationship Details</h3>
                    <div class="panel-controls">
                        <button class="compare-btn" id="addToCompareBtn" disabled>
                            <i class="bi bi-plus-circle"></i> Compare
                        </button>
                        <button class="close-btn" id="closeDetailsBtn">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                </div>

                <div class="panel-content" id="relationshipDetailsContent">
                    <div class="empty-state">
                        <i class="bi bi-arrow-through-heart"></i>
                        <p>Click on a relationship edge to view details</p>
                    </div>
                </div>
            `;

            // Insert into content panel or create floating panel
            const contentPanel = document.getElementById("contentPanel");
            if (contentPanel) {
                contentPanel.appendChild(this.detailsPanel);
            } else {
                document.body.appendChild(this.detailsPanel);
                this.detailsPanel.style.cssText += `
                    position: fixed;
                    right: 20px;
                    top: 100px;
                    width: 400px;
                    max-height: 80vh;
                    overflow-y: auto;
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 1000;
                    display: none;
                `;
            }
        }
    }

    /**
     * Create relationship comparison panel
     */
    private createComparisonPanel(): void {
        this.comparisonPanel = document.createElement("div");
        this.comparisonPanel.id = "relationshipComparisonPanel";
        this.comparisonPanel.className = "relationship-comparison-panel";
        this.comparisonPanel.innerHTML = `
            <div class="panel-header">
                <h3>Relationship Comparison</h3>
                <div class="panel-controls">
                    <span class="comparison-count" id="comparisonCount">0 relationships</span>
                    <button class="clear-btn" id="clearComparisonBtn">
                        <i class="bi bi-trash"></i> Clear
                    </button>
                    <button class="close-btn" id="closeComparisonBtn">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            </div>

            <div class="panel-content" id="comparisonContent">
                <div class="empty-state">
                    <i class="bi bi-diagram-2"></i>
                    <p>Add relationships to compare their properties</p>
                </div>
            </div>
        `;

        // Position as floating panel
        this.comparisonPanel.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 20px;
            width: 500px;
            max-height: 60vh;
            overflow-y: auto;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            display: none;
        `;

        document.body.appendChild(this.comparisonPanel);
    }

    /**
     * Set up panel controls
     */
    private setupPanelControls(): void {
        // Details panel controls
        const closeDetailsBtn = document.getElementById("closeDetailsBtn");
        const addToCompareBtn = document.getElementById("addToCompareBtn");

        if (closeDetailsBtn) {
            closeDetailsBtn.addEventListener("click", () =>
                this.hideDetailsPanel(),
            );
        }

        if (addToCompareBtn) {
            addToCompareBtn.addEventListener("click", () =>
                this.addCurrentRelationshipToComparison(),
            );
        }

        // Comparison panel controls
        const closeComparisonBtn =
            document.getElementById("closeComparisonBtn");
        const clearComparisonBtn =
            document.getElementById("clearComparisonBtn");

        if (closeComparisonBtn) {
            closeComparisonBtn.addEventListener("click", () =>
                this.hideComparisonPanel(),
            );
        }

        if (clearComparisonBtn) {
            clearComparisonBtn.addEventListener("click", () =>
                this.clearComparison(),
            );
        }
    }

    /**
     * Set up relationship event handlers
     */
    private setupRelationshipEventHandlers(): void {
        // Listen for edge clicks in the graph
        document.addEventListener("edgeClick", (e: any) => {
            const edgeData = e.detail;
            this.showRelationshipDetails(edgeData);
        });

        // Listen for edge hover events
        document.addEventListener("edgeHover", (e: any) => {
            const edgeData = e.detail;
            this.showRelationshipPreview(edgeData);
        });

        // Listen for edge hover end
        document.addEventListener("edgeHoverEnd", () => {
            this.hideRelationshipPreview();
        });
    }

    /**
     * Show relationship details
     */
    async showRelationshipDetails(edgeData: any): Promise<void> {
        try {
            // Generate detailed relationship data
            const relationshipDetails =
                await this.generateRelationshipDetails(edgeData);
            this.currentRelationship = relationshipDetails;

            // Render details
            this.renderRelationshipDetails(relationshipDetails);

            // Show panel
            this.showDetailsPanel();

            // Update controls
            this.updateDetailsPanelControls();
        } catch (error) {
            console.error("Failed to show relationship details:", error);
        }
    }

    /**
     * Generate detailed relationship data
     */
    private async generateRelationshipDetails(
        edgeData: any,
    ): Promise<RelationshipDetails> {
        if (this.mockMode) {
            return this.generateMockRelationshipDetails(edgeData);
        } else {
            return this.generateRealRelationshipDetails(edgeData);
        }
    }

    /**
     * Generate mock relationship details
     */
    private generateMockRelationshipDetails(
        edgeData: any,
    ): RelationshipDetails {
        const relationshipTypes = {
            CEO_of: {
                evidenceSources: [
                    "Company website",
                    "SEC filings",
                    "News articles",
                ],
                contextSnippets: [
                    "Appointed as CEO in 2008",
                    "Leading the company's strategic vision",
                    "Reported quarterly earnings calls",
                ],
            },
            founder_of: {
                evidenceSources: [
                    "Company registration",
                    "Founder interviews",
                    "Press releases",
                ],
                contextSnippets: [
                    "Co-founded the company in 2002",
                    "Initial seed funding of $6.5M",
                    "Vision for sustainable transportation",
                ],
            },
            developed: {
                evidenceSources: [
                    "Technical documentation",
                    "Patent filings",
                    "Developer blogs",
                ],
                contextSnippets: [
                    "Led development team for 3 years",
                    "Implemented key features and architecture",
                    "Open-sourced components in 2021",
                ],
            },
            created: {
                evidenceSources: [
                    "Product announcements",
                    "Blog posts",
                    "Technical papers",
                ],
                contextSnippets: [
                    "Launched as beta in 2022",
                    "Built using transformer architecture",
                    "Trained on diverse text corpus",
                ],
            },
        };

        const typeData = relationshipTypes[
            edgeData.type as keyof typeof relationshipTypes
        ] || {
            evidenceSources: ["Web search", "Database records"],
            contextSnippets: [
                "General relationship observed",
                "Multiple occurrences found",
            ],
        };

        return {
            fromEntity: edgeData.source,
            toEntity: edgeData.target,
            relationshipType: edgeData.type,
            strength: edgeData.strength || 0.7,
            confidence: Math.random() * 0.3 + 0.7, // 0.7 to 1.0
            evidenceSources: typeData.evidenceSources,
            contextSnippets: typeData.contextSnippets,
            firstObserved: this.generateRandomDate(-365), // Up to 1 year ago
            lastObserved: this.generateRandomDate(-7), // Up to 1 week ago
            frequency: Math.floor(Math.random() * 50) + 5, // 5-55 occurrences
            direction: Math.random() > 0.3 ? "unidirectional" : "bidirectional",
            temporalPattern: ["increasing", "stable", "decreasing"][
                Math.floor(Math.random() * 3)
            ] as any,
        };
    }

    /**
     * Generate real relationship details (placeholder)
     */
    private async generateRealRelationshipDetails(
        edgeData: any,
    ): Promise<RelationshipDetails> {
        // This would integrate with real relationship data
        console.log("Real relationship details for:", edgeData);
        return this.generateMockRelationshipDetails(edgeData);
    }

    /**
     * Render relationship details
     */
    private renderRelationshipDetails(details: RelationshipDetails): void {
        const content = document.getElementById("relationshipDetailsContent");
        if (!content) return;

        content.innerHTML = `
            <div class="relationship-details">
                <!-- Relationship Header -->
                <div class="relationship-header">
                    <div class="relationship-entities">
                        <span class="entity-name from-entity">${this.escapeHtml(details.fromEntity)}</span>
                        <div class="relationship-arrow">
                            ${details.direction === "bidirectional" ? "↔" : "→"}
                            <span class="relationship-type">${this.formatRelationshipType(details.relationshipType)}</span>
                        </div>
                        <span class="entity-name to-entity">${this.escapeHtml(details.toEntity)}</span>
                    </div>
                </div>

                <!-- Relationship Metrics -->
                <div class="relationship-metrics">
                    <div class="metric-grid">
                        <div class="metric-item">
                            <span class="metric-label">Strength</span>
                            <div class="metric-value">
                                <div class="strength-bar">
                                    <div class="strength-fill" style="width: ${details.strength * 100}%"></div>
                                </div>
                                <span class="strength-text">${Math.round(details.strength * 100)}%</span>
                            </div>
                        </div>
                        <div class="metric-item">
                            <span class="metric-label">Confidence</span>
                            <div class="metric-value">
                                <div class="confidence-indicator confidence-${this.getConfidenceLevel(details.confidence)}">
                                    ${Math.round(details.confidence * 100)}%
                                </div>
                            </div>
                        </div>
                        <div class="metric-item">
                            <span class="metric-label">Frequency</span>
                            <div class="metric-value">${details.frequency} times</div>
                        </div>
                        <div class="metric-item">
                            <span class="metric-label">Pattern</span>
                            <div class="metric-value">
                                <span class="temporal-pattern pattern-${details.temporalPattern}">
                                    ${this.formatTemporalPattern(details.temporalPattern)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Timeline -->
                <div class="relationship-timeline">
                    <h4>Timeline</h4>
                    <div class="timeline-items">
                        <div class="timeline-item">
                            <span class="timeline-label">First Observed:</span>
                            <span class="timeline-value">${this.formatDate(details.firstObserved)}</span>
                        </div>
                        <div class="timeline-item">
                            <span class="timeline-label">Last Observed:</span>
                            <span class="timeline-value">${this.formatDate(details.lastObserved)}</span>
                        </div>
                        <div class="timeline-item">
                            <span class="timeline-label">Duration:</span>
                            <span class="timeline-value">${this.calculateDuration(details.firstObserved, details.lastObserved)}</span>
                        </div>
                    </div>
                </div>

                <!-- Evidence Sources -->
                <div class="evidence-sources">
                    <h4>Evidence Sources</h4>
                    <div class="sources-list">
                        ${details.evidenceSources
                            .map(
                                (source) => `
                            <div class="source-item">
                                <i class="bi bi-link-45deg"></i>
                                <span class="source-text">${this.escapeHtml(source)}</span>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>

                <!-- Context Snippets -->
                <div class="context-snippets">
                    <h4>Context</h4>
                    <div class="snippets-list">
                        ${details.contextSnippets
                            .map(
                                (snippet) => `
                            <div class="snippet-item">
                                <i class="bi bi-quote"></i>
                                <span class="snippet-text">${this.escapeHtml(snippet)}</span>
                            </div>
                        `,
                            )
                            .join("")}
                    </div>
                </div>

                <!-- Relationship Actions -->
                <div class="relationship-actions">
                    <button class="btn btn-outline-primary btn-sm" onclick="this.exploreRelationship('${details.fromEntity}', '${details.toEntity}')">
                        <i class="bi bi-diagram-3"></i> Explore Network
                    </button>
                    <button class="btn btn-outline-secondary btn-sm" onclick="this.findSimilarRelationships('${details.relationshipType}')">
                        <i class="bi bi-search"></i> Find Similar
                    </button>
                    <button class="btn btn-outline-info btn-sm" onclick="this.exportRelationship()">
                        <i class="bi bi-download"></i> Export
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Show relationship preview (hover tooltip)
     */
    private showRelationshipPreview(edgeData: any): void {
        const preview = this.getOrCreatePreviewTooltip();

        preview.innerHTML = `
            <div class="relationship-preview">
                <div class="preview-header">
                    <span class="from-entity">${this.escapeHtml(edgeData.source)}</span>
                    <span class="relationship-type">${this.formatRelationshipType(edgeData.type)}</span>
                    <span class="to-entity">${this.escapeHtml(edgeData.target)}</span>
                </div>
                <div class="preview-metrics">
                    <span class="strength">Strength: ${Math.round((edgeData.strength || 0.7) * 100)}%</span>
                    <span class="click-hint">Click for details</span>
                </div>
            </div>
        `;

        // Position tooltip (this would be positioned based on mouse/edge position)
        preview.style.display = "block";
    }

    /**
     * Hide relationship preview
     */
    private hideRelationshipPreview(): void {
        const preview = document.getElementById("relationship-preview-tooltip");
        if (preview) {
            preview.style.display = "none";
        }
    }

    /**
     * Get or create preview tooltip
     */
    private getOrCreatePreviewTooltip(): HTMLElement {
        let tooltip = document.getElementById("relationship-preview-tooltip");
        if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = "relationship-preview-tooltip";
            tooltip.className = "relationship-preview-tooltip";
            tooltip.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 12px;
                border-radius: 6px;
                font-size: 12px;
                z-index: 2000;
                pointer-events: none;
                display: none;
                max-width: 300px;
            `;
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    /**
     * Add current relationship to comparison
     */
    private addCurrentRelationshipToComparison(): void {
        if (!this.currentRelationship) return;

        // Check if already in comparison
        const exists = this.selectedRelationships.some(
            (rel) =>
                rel.fromEntity === this.currentRelationship!.fromEntity &&
                rel.toEntity === this.currentRelationship!.toEntity &&
                rel.relationshipType ===
                    this.currentRelationship!.relationshipType,
        );

        if (!exists) {
            this.selectedRelationships.push(this.currentRelationship);
            this.updateComparisonPanel();
            this.showComparisonPanel();
        }
    }

    /**
     * Update comparison panel
     */
    private updateComparisonPanel(): void {
        const content = document.getElementById("comparisonContent");
        const countElement = document.getElementById("comparisonCount");

        if (countElement) {
            countElement.textContent = `${this.selectedRelationships.length} relationships`;
        }

        if (!content) return;

        if (this.selectedRelationships.length === 0) {
            content.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-diagram-2"></i>
                    <p>Add relationships to compare their properties</p>
                </div>
            `;
            return;
        }

        if (this.selectedRelationships.length === 1) {
            content.innerHTML = `
                <div class="single-relationship">
                    <p>Add another relationship to compare</p>
                    ${this.renderComparisonRelationshipItem(this.selectedRelationships[0], 0)}
                </div>
            `;
            return;
        }

        // Generate comparison
        const comparison = this.generateRelationshipComparison(
            this.selectedRelationships[0],
            this.selectedRelationships[1],
        );

        content.innerHTML = this.renderRelationshipComparison(comparison);
    }

    /**
     * Render single relationship item for comparison
     */
    private renderComparisonRelationshipItem(
        relationship: RelationshipDetails,
        index: number,
    ): string {
        return `
            <div class="comparison-relationship-item">
                <div class="relationship-summary">
                    <span class="from-entity">${this.escapeHtml(relationship.fromEntity)}</span>
                    <span class="relationship-type">${this.formatRelationshipType(relationship.relationshipType)}</span>
                    <span class="to-entity">${this.escapeHtml(relationship.toEntity)}</span>
                </div>
                <div class="relationship-metrics-mini">
                    <span class="strength">Strength: ${Math.round(relationship.strength * 100)}%</span>
                    <span class="confidence">Confidence: ${Math.round(relationship.confidence * 100)}%</span>
                </div>
                <button class="remove-btn" onclick="this.removeFromComparison(${index})">
                    <i class="bi bi-x"></i>
                </button>
            </div>
        `;
    }

    /**
     * Generate relationship comparison
     */
    private generateRelationshipComparison(
        rel1: RelationshipDetails,
        rel2: RelationshipDetails,
    ): RelationshipComparison {
        const similarities: string[] = [];
        const differences: string[] = [];

        // Check for similarities
        if (rel1.relationshipType === rel2.relationshipType) {
            similarities.push("Same relationship type");
        } else {
            differences.push(
                `Different types: ${rel1.relationshipType} vs ${rel2.relationshipType}`,
            );
        }

        if (rel1.direction === rel2.direction) {
            similarities.push("Same direction");
        } else {
            differences.push(
                `Different directions: ${rel1.direction} vs ${rel2.direction}`,
            );
        }

        if (Math.abs(rel1.strength - rel2.strength) < 0.1) {
            similarities.push("Similar strength");
        } else {
            differences.push(
                `Different strengths: ${Math.round(rel1.strength * 100)}% vs ${Math.round(rel2.strength * 100)}%`,
            );
        }

        if (rel1.temporalPattern === rel2.temporalPattern) {
            similarities.push("Same temporal pattern");
        } else {
            differences.push(
                `Different patterns: ${rel1.temporalPattern} vs ${rel2.temporalPattern}`,
            );
        }

        return {
            relationship1: rel1,
            relationship2: rel2,
            similarities,
            differences,
            strengthDifference: rel2.strength - rel1.strength,
            confidenceDifference: rel2.confidence - rel1.confidence,
        };
    }

    /**
     * Render relationship comparison
     */
    private renderRelationshipComparison(
        comparison: RelationshipComparison,
    ): string {
        return `
            <div class="relationship-comparison">
                <!-- Compared Relationships -->
                <div class="compared-relationships">
                    <div class="relationship-column">
                        <h5>Relationship 1</h5>
                        ${this.renderComparisonRelationshipItem(comparison.relationship1, 0)}
                    </div>
                    <div class="relationship-column">
                        <h5>Relationship 2</h5>
                        ${this.renderComparisonRelationshipItem(comparison.relationship2, 1)}
                    </div>
                </div>

                <!-- Comparison Analysis -->
                <div class="comparison-analysis">
                    <div class="comparison-section">
                        <h6>Similarities</h6>
                        <ul class="similarity-list">
                            ${comparison.similarities.map((sim) => `<li class="similarity-item">${sim}</li>`).join("")}
                        </ul>
                    </div>

                    <div class="comparison-section">
                        <h6>Differences</h6>
                        <ul class="difference-list">
                            ${comparison.differences.map((diff) => `<li class="difference-item">${diff}</li>`).join("")}
                        </ul>
                    </div>

                    <div class="comparison-metrics">
                        <div class="metric-comparison">
                            <span class="metric-label">Strength Difference:</span>
                            <span class="metric-value ${comparison.strengthDifference >= 0 ? "positive" : "negative"}">
                                ${comparison.strengthDifference >= 0 ? "+" : ""}${Math.round(comparison.strengthDifference * 100)}%
                            </span>
                        </div>
                        <div class="metric-comparison">
                            <span class="metric-label">Confidence Difference:</span>
                            <span class="metric-value ${comparison.confidenceDifference >= 0 ? "positive" : "negative"}">
                                ${comparison.confidenceDifference >= 0 ? "+" : ""}${Math.round(comparison.confidenceDifference * 100)}%
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Show details panel
     */
    private showDetailsPanel(): void {
        if (this.detailsPanel) {
            this.detailsPanel.style.display = "block";
        }
    }

    /**
     * Hide details panel
     */
    private hideDetailsPanel(): void {
        if (this.detailsPanel) {
            this.detailsPanel.style.display = "none";
        }
        this.currentRelationship = null;
    }

    /**
     * Show comparison panel
     */
    private showComparisonPanel(): void {
        if (this.comparisonPanel) {
            this.comparisonPanel.style.display = "block";
        }
    }

    /**
     * Hide comparison panel
     */
    private hideComparisonPanel(): void {
        if (this.comparisonPanel) {
            this.comparisonPanel.style.display = "none";
        }
    }

    /**
     * Clear comparison
     */
    private clearComparison(): void {
        this.selectedRelationships = [];
        this.updateComparisonPanel();
    }

    /**
     * Update details panel controls
     */
    private updateDetailsPanelControls(): void {
        const addToCompareBtn = document.getElementById(
            "addToCompareBtn",
        ) as HTMLButtonElement;
        if (addToCompareBtn) {
            addToCompareBtn.disabled = !this.currentRelationship;
        }
    }

    // Utility methods
    private generateRandomDate(daysAgo: number): string {
        const date = new Date();
        date.setDate(date.getDate() + daysAgo);
        return date.toISOString();
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    private calculateDuration(startDate: string, endDate: string): string {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 30) {
            return `${diffDays} days`;
        } else if (diffDays < 365) {
            return `${Math.round(diffDays / 30)} months`;
        } else {
            return `${Math.round(diffDays / 365)} years`;
        }
    }

    private formatRelationshipType(type: string): string {
        return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    }

    private formatTemporalPattern(pattern?: string): string {
        if (!pattern) return "Unknown";

        const patterns: { [key: string]: string } = {
            increasing: "📈 Increasing",
            decreasing: "📉 Decreasing",
            stable: "➡️ Stable",
            periodic: "🔄 Periodic",
        };

        return patterns[pattern] || pattern;
    }

    private getConfidenceLevel(confidence: number): string {
        if (confidence >= 0.8) return "high";
        if (confidence >= 0.6) return "medium";
        return "low";
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Set mock mode
     */
    setMockMode(enabled: boolean): void {
        this.mockMode = enabled;
    }

    /**
     * Get current relationship
     */
    getCurrentRelationship(): RelationshipDetails | null {
        return this.currentRelationship;
    }

    /**
     * Get selected relationships for comparison
     */
    getSelectedRelationships(): RelationshipDetails[] {
        return [...this.selectedRelationships];
    }

    /**
     * Remove relationship from comparison
     */
    removeFromComparison(index: number): void {
        this.selectedRelationships.splice(index, 1);
        this.updateComparisonPanel();

        if (this.selectedRelationships.length === 0) {
            this.hideComparisonPanel();
        }
    }
}
