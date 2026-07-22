// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { KnowledgeStatus } from "../interfaces/searchTypes";

export class KnowledgeUtils {
    static renderKnowledgeBadges(knowledge?: KnowledgeStatus): string {
        if (!knowledge?.hasKnowledge) return "";

        const badges = [];

        if (knowledge.entityCount && knowledge.entityCount > 0) {
            badges.push(`
                <span class="knowledge-badge entity" title="${knowledge.entityCount} entities extracted">
                    <i class="bi bi-diagram-2"></i>
                    ${knowledge.entityCount} Entities
                </span>
            `);
        }

        if (knowledge.topicCount && knowledge.topicCount > 0) {
            badges.push(`
                <span class="knowledge-badge topic" title="${knowledge.topicCount} topics identified">
                    <i class="bi bi-tags"></i>
                    ${knowledge.topicCount} Topics
                </span>
            `);
        }

        if (knowledge.suggestionCount && knowledge.suggestionCount > 0) {
            badges.push(`
                <span class="knowledge-badge action" title="${knowledge.suggestionCount} actions detected">
                    <i class="bi bi-lightning"></i>
                    ${knowledge.suggestionCount} Actions
                </span>
            `);
        }

        if (knowledge.status === "extracted") {
            badges.push(`
                <span class="knowledge-badge extracted" title="Knowledge successfully extracted">
                    <i class="bi bi-check-circle"></i>
                    Extracted
                </span>
            `);
        }

        return badges.join("");
    }

    static renderConfidenceIndicator(confidence: number): string {
        const percentage = Math.round(confidence * 100);
        let color = "#dc3545"; // Red for low confidence

        if (confidence >= 0.7) {
            color = "#28a745"; // Green for high confidence
        } else if (confidence >= 0.4) {
            color = "#ffc107"; // Yellow for medium confidence
        }

        return `
            <div class="confidence-indicator" title="Confidence: ${percentage}%">
                <span class="text-muted small">Confidence:</span>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${percentage}%; background-color: ${color}"></div>
                </div>
                <span class="small">${percentage}%</span>
            </div>
        `;
    }

    static getKnowledgeTooltipContent(type: string): string {
        const tooltips = {
            entity: `
                <div class="tooltip-header">
                    <i class="bi bi-diagram-2"></i>
                    <strong>Entities Extracted</strong>
                </div>
                <div class="tooltip-content">
                    <p>Companies, technologies, people, and organizations identified in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Microsoft</span>
                        <span class="example-tag">TypeScript</span>
                        <span class="example-tag">React</span>
                    </div>
                </div>
            `,
            topic: `
                <div class="tooltip-header">
                    <i class="bi bi-tags"></i>
                    <strong>Topics Identified</strong>
                </div>
                <div class="tooltip-content">
                    <p>Main themes and subjects covered in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Web Development</span>
                        <span class="example-tag">Programming</span>
                        <span class="example-tag">Documentation</span>
                    </div>
                </div>
            `,
            action: `
                <div class="tooltip-header">
                    <i class="bi bi-lightning"></i>
                    <strong>Actions Detected</strong>
                </div>
                <div class="tooltip-content">
                    <p>Actionable items and next steps found in this content.</p>
                    <div class="tooltip-examples">
                        <span class="example-tag">Download</span>
                        <span class="example-tag">Install</span>
                        <span class="example-tag">Configure</span>
                    </div>
                </div>
            `,
            extracted: `
                <div class="tooltip-header">
                    <i class="bi bi-check-circle"></i>
                    <strong>Knowledge Extracted</strong>
                </div>
                <div class="tooltip-content">
                    <p>This content has been successfully processed and knowledge has been extracted.</p>
                    <div class="status-indicator success">
                        <i class="bi bi-check"></i>
                        Processing Complete
                    </div>
                </div>
            `,
        };

        return tooltips[type as keyof typeof tooltips] || "";
    }
}
