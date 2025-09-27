// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Knowledge Card Renderer - UI generation components for knowledge display
 * Extracted from actionHandler.mts to provide modular knowledge visualization
 */

// Types and interfaces for knowledge rendering
export interface ProgressState {
    phase:
        | "initializing"
        | "content"
        | "basic"
        | "summary"
        | "analyzing"
        | "extracting"
        | "complete"
        | "error";
    percentage: number;
    currentItem?: string;
    startTime: number;
    lastUpdate: number;
    errors?: any[];
}

export interface ActiveKnowledgeExtraction {
    extractionId: string;
    url?: string;
    actionIO?: any | null; // Can be null for notification-based extraction
    dynamicDisplayId?: string | null;
    progressState?: ProgressState;
    aggregatedKnowledge: {
        entities: any[];
        topics: any[];
        relationships: any[];
    };
    lastUpdateTime: number;
}

export interface KnowledgeResult {
    entities?: any[];
    topics?: any[];
    relationships?: any[];
    actions?: Array<{
        subjectEntityName: any;
        verbs: any[];
        objectEntityName: any;
    }>;
}

/**
 * Generates detailed knowledge cards with entities, topics, and relationships
 * This is the main function for rendering knowledge extraction results
 */
export function generateDetailedKnowledgeCards(knowledgeResult: KnowledgeResult): string {
    const entities = knowledgeResult.entities || [];
    const topics = knowledgeResult.topics || [];
    let relationships = knowledgeResult.relationships || [];

    if (relationships.length === 0 && knowledgeResult.actions) {
        relationships =
            knowledgeResult.actions?.map(
                (action: {
                    subjectEntityName: any;
                    verbs: any[];
                    objectEntityName: any;
                }) => ({
                    from: action.subjectEntityName || "unknown",
                    relationship: action.verbs?.join(", ") || "related to",
                    to: action.objectEntityName || "unknown",
                    confidence: 0.8,
                }),
            ) || [];
    }

    let html = '<div style="margin-top: 12px;">';

    // Entities section
    if (entities.length > 0) {
        html += `
        <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; color: #495057; margin-bottom: 6px;"><i class="bi bi-tags"></i> Entities (${entities.length}):</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${entities
                    .slice(0, 10)
                    .map((e: any) => {
                        const name = e.name || e;
                        const type = e.type ? ` (${e.type})` : "";
                        const confidence = e.confidence
                            ? ` ${Math.round(e.confidence * 100)}%`
                            : "";
                        const entityUrl = `typeagent-browser://views/entityGraphView.html?entity=${encodeURIComponent(name)}`;
                        return `<a
                            href="${entityUrl}"
                            style="background: #e3f2fd; color: #1976d2; padding: 2px 6px;
                                   border-radius: 12px; font-size: 12px;
                                   text-decoration: none; display: inline-block;
                                   transition: background 0.2s, transform 0.1s;"
                            title="Click to view entity graph">
                            ${name}${type}${confidence}
                        </a>`;
                    })
                    .join("")}
                ${entities.length > 10 ? `<span style="color: #6c757d; font-style: italic; font-size: 12px;">+${entities.length - 10} more</span>` : ""}
            </div>
        </div>`;
    }

    // Topics section
    if (topics.length > 0) {
        html += `
        <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; color: #495057; margin-bottom: 6px;"><i class="bi bi-bookmark"></i> Topics (${topics.length}):</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${topics
                    .slice(0, 8)
                    .map((topic: any) => {
                        const name = topic.name || topic;
                        const topicUrl = `typeagent-browser://views/entityGraphView.html?topic=${encodeURIComponent(name)}`;
                        return `<a
                            href="${topicUrl}"
                            style="background: #fff3cd; color: #856404; padding: 2px 8px;
                                   border-radius: 12px; font-size: 12px;
                                   border: 1px solid #ffeaa7; text-decoration: none;
                                   display: inline-block; transition: background 0.2s;"
                            title="Click to view topic graph">
                            ${name}
                        </a>`;
                    })
                    .join("")}
                ${topics.length > 8 ? `<span style="color: #6c757d; font-style: italic; font-size: 12px;">+${topics.length - 8} more</span>` : ""}
            </div>
        </div>`;
    }

    // Relationships section
    if (relationships.length > 0) {
        html += `
        <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; color: #495057; margin-bottom: 6px;"><i class="bi bi-diagram-3"></i> Relationships (${relationships.length}):</div>
            <div style="font-size: 13px; color: #6c757d;">
                ${relationships
                    .slice(0, 5)
                    .map((r: any) => {
                        const source = r.source || r.from || "Unknown";
                        const target = r.target || r.to || "Unknown";
                        const relation =
                            r.relationship || r.relation || "relates to";
                        return `<div style="margin: 2px 0;"><strong>${source}</strong> → <em>${relation}</em> → <strong>${target}</strong></div>`;
                    })
                    .join("")}
                ${relationships.length > 5 ? `<div style="font-style: italic;">+${relationships.length - 5} more relationships</div>` : ""}
            </div>
        </div>`;
    }

    html += "</div>";
    return html;
}

/**
 * Generates a live preview of knowledge as it's being extracted
 * Used for real-time updates during knowledge extraction process
 */
export function generateLiveKnowledgePreview(
    aggregatedKnowledge: {
        entities: any[];
        topics: any[];
        relationships: any[];
    },
    phase: string,
): string {
    const { entities, topics, relationships } = aggregatedKnowledge;
    const hasKnowledge =
        entities.length > 0 || topics.length > 0 || relationships.length > 0;

    if (!hasKnowledge && phase !== "complete") {
        return `
        <div style="text-align: center; padding: 20px; color: #6c757d; font-style: italic;">
            <div style="font-size: 14px;">Analyzing page content...</div>
            <div style="font-size: 12px; margin-top: 4px;">Knowledge will appear as it's discovered</div>
        </div>`;
    }

    return `
    <!-- Entities Section -->
    <div class="knowledge-section" style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <i class="bi bi-tags" style="margin-right: 6px;"></i>
            <span style="font-weight: 600; color: #495057; font-size: 14px;">Entities</span>
            <span style="background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 10px; font-size: 11px; font-weight: bold; margin-left: 6px;">${entities.length}</span>
        </div>
        <div style="max-height: 120px; overflow-y: auto;">
            ${
                entities.length === 0
                    ? `<div style="color: #6c757d; font-size: 12px; font-style: italic;">None discovered yet</div>`
                    : entities
                          .slice(0, 15)
                          .map((entity) => {
                              const name = entity.name || entity;
                              const entityUrl = `typeagent-browser://views/entityGraphView.html?entity=${encodeURIComponent(name)}`;
                              return `<a href="${entityUrl}"
                                           style="display: inline-block; background: #e3f2fd; color: #1976d2;
                                                  padding: 4px 8px; border-radius: 12px; font-size: 11px;
                                                  font-weight: 500; margin: 2px; text-decoration: none;
                                                  transition: background 0.2s, transform 0.1s;"
                                           title="Click to view entity graph">
                                           ${name}
                                           </a>`;
                          })
                          .join("")
            }
            ${
                entities.length > 15
                    ? `<div style="color: #6c757d; font-size: 11px; margin-top: 4px;">+${entities.length - 15} more...</div>`
                    : ""
            }
        </div>
    </div>

    <!-- Topics Section -->
    <div class="knowledge-section" style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <i class="bi bi-bookmark" style="margin-right: 6px;"></i>
            <span style="font-weight: 600; color: #495057; font-size: 14px;">Topics</span>
            <span style="background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 10px; font-size: 11px; font-weight: bold; margin-left: 6px;">${topics.length}</span>
        </div>
        <div style="max-height: 120px; overflow-y: auto;">
            ${
                topics.length === 0
                    ? `<div style="color: #6c757d; font-size: 12px; font-style: italic;">None discovered yet</div>`
                    : topics
                          .slice(0, 12)
                          .map((topic) => {
                              const name = topic.name || topic;
                              const topicUrl = `typeagent-browser://views/entityGraphView.html?topic=${encodeURIComponent(name)}`;
                              return `<a href="${topicUrl}"
                                           style="display: inline-block; background: #fff3cd; color: #856404;
                                                  border: 1px solid #ffeaa7; padding: 4px 8px; border-radius: 12px;
                                                  font-size: 11px; font-weight: 500; margin: 2px; text-decoration: none;
                                                  transition: background 0.2s;"
                                           title="Click to view topic graph">
                                           ${name}
                                           </a>`;
                          })
                          .join("")
            }
            ${
                topics.length > 12
                    ? `<div style="color: #6c757d; font-size: 11px; margin-top: 4px;">+${topics.length - 12} more...</div>`
                    : ""
            }
        </div>
    </div>

    <!-- Relationships Section -->
    ${
        relationships.length > 0
            ? `
    <div class="knowledge-section" style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <i class="bi bi-diagram-3" style="margin-right: 6px;"></i>
            <span style="font-weight: 600; color: #495057; font-size: 14px;">Relationships</span>
            <span style="background: #e8f5e8; color: #2e7d2e; padding: 2px 6px; border-radius: 10px; font-size: 11px; font-weight: bold; margin-left: 6px;">${relationships.length}</span>
        </div>
        <div style="max-height: 80px; overflow-y: auto;">
            ${relationships
                .slice(0, 5)
                .map((r: any) => {
                    const source = r.source || r.from || "Unknown";
                    const target = r.target || r.to || "Unknown";
                    const relation =
                        r.relationship || r.relation || "relates to";
                    return `<div style="font-size: 12px; color: #6c757d; margin: 2px 0; padding: 2px 0;"><strong>${source}</strong> → <em>${relation}</em> → <strong>${target}</strong></div>`;
                })
                .join("")}
            ${
                relationships.length > 5
                    ? `<div style="color: #6c757d; font-size: 11px;">+${relationships.length - 5} more relationships</div>`
                    : ""
            }
        </div>
    </div>`
            : ""
    }`;
}

/**
 * Generates dynamic knowledge HTML with progress state
 * Combines progress indicators with live knowledge preview
 */
export function generateDynamicKnowledgeHtml(
    progressState: ProgressState,
    aggregatedKnowledge: {
        entities: any[];
        topics: any[];
        relationships: any[];
    },
): string {
    const { phase, currentItem } = progressState;

    return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
        <!-- Status Card -->
        <div style="margin: 8px 0; padding: 12px; background: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px; margin-bottom: 16px;">

            ${
                currentItem
                    ? `
            <div style="margin-top: 6px; font-size: 12px; color: #6c757d; font-style: italic;">
                ${currentItem.length > 60 ? currentItem.substring(0, 60) + "..." : currentItem}
            </div>`
                    : ""
            }
        </div>

        <!-- Live Knowledge Preview -->
        ${generateLiveKnowledgePreview(aggregatedKnowledge, phase)}


        ${
            phase === "error"
                ? `
        <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 12px; margin-top: 16px;">
            <div style="color: #721c24; font-weight: bold;">❌ Knowledge Extraction Failed</div>
        </div>`
                : ""
        }
    </div>`;
}

/**
 * Helper function to update progress state in a consistent way
 * Used by progress event handlers to maintain consistent state
 */
export function updateExtractionProgressState(
    activeExtraction: ActiveKnowledgeExtraction,
    progress: any,
): void {
    if (!activeExtraction.progressState) {
        // Initialize progress state if it doesn't exist
        activeExtraction.progressState = {
            phase: "initializing",
            percentage: 0,
            startTime: Date.now(),
            lastUpdate: Date.now(),
            errors: [],
        };
    }

    // Calculate percentage based on phase and processed items
    let percentage = 0;
    if (progress.totalItems && progress.totalItems > 0) {
        percentage = Math.round(
            (progress.processedItems / progress.totalItems) * 100,
        );
    } else {
        // Fallback percentage based on phase
        const phasePercentages: Record<string, number> = {
            initializing: 5,
            content: 15,
            basic: 30,
            summary: 50,
            analyzing: 75,
            extracting: 90,
            complete: 100,
            error: 0,
        };
        percentage = phasePercentages[progress.phase] || 50;
    }

    // Update progress state
    activeExtraction.progressState.phase = progress.phase || "analyzing";
    activeExtraction.progressState.percentage = Math.min(
        100,
        Math.max(0, percentage),
    );
    activeExtraction.progressState.currentItem = progress.currentItem;
    activeExtraction.progressState.lastUpdate = Date.now();

    if (progress.errors && progress.errors.length > 0) {
        activeExtraction.progressState.errors = progress.errors;
    }
}