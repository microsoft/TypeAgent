// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as cheerio from "cheerio";

/**
 * Represents a detected action on a web page
 */
export interface DetectedAction {
    /** Schema.org action type (e.g., BuyAction, DownloadAction) */
    actionType: string;

    /** Human-readable action name */
    name: string;

    /** What the action operates on */
    target?: ActionTarget;

    /** Confidence score from 0.0 to 1.0 */
    confidence: number;

    /** CSS selectors for the action elements */
    selectors: string[];

    /** HTTP method for forms (GET, POST) */
    method?: string;

    /** Action URL if different from page URL */
    url?: string;

    /** Additional action-specific metadata */
    metadata?: { [key: string]: any };
}

/**
 * Represents the target of an action
 */
export interface ActionTarget {
    /** Schema.org type (Product, DigitalDocument, etc.) */
    type: string;

    /** Target name/title */
    name?: string;

    /** Target identifier (SKU, ID, etc.) */
    identifier?: string;

    /** Price information for commerce actions */
    price?: PriceSpecification;

    /** File format for download actions */
    fileFormat?: string;

    /** Additional target properties */
    properties?: { [key: string]: any };
}

/**
 * Price specification for commerce actions
 */
export interface PriceSpecification {
    /** Price value */
    value?: number;

    /** Currency code (USD, EUR, etc.) */
    currency?: string;

    /** Price as string (for complex pricing) */
    text?: string;
}

/**
 * Summary of all detected actions on a page
 */
export interface ActionSummary {
    /** Total number of actions found */
    totalActions: number;

    /** List of action types found */
    actionTypes: string[];

    /** Number of high-confidence actions (>0.8) */
    highConfidenceActions: number;

    /** Most likely primary action */
    primaryAction?: DetectedAction;

    /** Action distribution by type */
    actionDistribution?: { [actionType: string]: number };
}

/**
 * Action detection engine that extracts actionable elements from web pages
 */
export class ActionExtractor {
    private readonly userAgent =
        "Mozilla/5.0 (compatible; TypeAgent-ActionDetector/1.0)";

    constructor(
        private config?: {
            minConfidence?: number;
            maxActions?: number;
            timeout?: number;
        },
    ) {
        // Config will be used in full implementation
    }

    /**
     * Extract actions from HTML content
     */
    async extractActionsFromHtml(html: string): Promise<DetectedAction[]> {
        const $ = cheerio.load(html);

        const actions: DetectedAction[] = [
            ...this.extractFromStructuredData($),
            ...this.extractFromSemanticHTML($),
            ...this.extractFromForms($),
            ...this.extractFromPatterns($),
            ...this.extractFromButtons($),
        ];

        return this.deduplicateAndScore(actions);
    }

    /**
     * Extract actions from a URL
     */
    async extractActionsFromUrl(url: string): Promise<DetectedAction[]> {
        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": this.userAgent,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            });

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const html = await response.text();
            return this.extractActionsFromHtml(html);
        } catch (error) {
            console.warn(`Failed to extract actions from ${url}:`, error);
            return [];
        }
    }

    /**
     * Create action summary from detected actions
     */
    createActionSummary(actions: DetectedAction[]): ActionSummary {
        if (!actions || actions.length === 0) {
            return {
                totalActions: 0,
                actionTypes: [],
                highConfidenceActions: 0,
                actionDistribution: {},
            };
        }

        const actionTypes = [...new Set(actions.map((a) => a.actionType))];
        const highConfidenceActions = actions.filter(
            (a) => a.confidence > 0.8,
        ).length;
        const primaryAction = actions.sort(
            (a, b) => b.confidence - a.confidence,
        )[0];

        // Calculate action distribution
        const actionDistribution: { [actionType: string]: number } = {};
        actions.forEach((action) => {
            actionDistribution[action.actionType] =
                (actionDistribution[action.actionType] || 0) + 1;
        });

        return {
            totalActions: actions.length,
            actionTypes,
            highConfidenceActions,
            primaryAction,
            actionDistribution,
        };
    }

    // Implementation details would continue here...
    // For brevity, including just the essential structure

    private extractFromStructuredData($: cheerio.CheerioAPI): DetectedAction[] {
        return []; // Simplified for now
    }

    private extractFromSemanticHTML($: cheerio.CheerioAPI): DetectedAction[] {
        return []; // Simplified for now
    }

    private extractFromForms($: cheerio.CheerioAPI): DetectedAction[] {
        return []; // Simplified for now
    }

    private extractFromPatterns($: cheerio.CheerioAPI): DetectedAction[] {
        return []; // Simplified for now
    }

    private extractFromButtons($: cheerio.CheerioAPI): DetectedAction[] {
        return []; // Simplified for now
    }

    private deduplicateAndScore(actions: DetectedAction[]): DetectedAction[] {
        // Filter by minimum confidence and limit results
        const minConfidence = this.config?.minConfidence || 0.5;
        const maxActions = this.config?.maxActions || 50;

        return actions
            .filter((action) => action.confidence >= minConfidence)
            .slice(0, maxActions);
    }
}

/**
 * Default action extractor instance
 */
export const defaultActionExtractor = new ActionExtractor({
    minConfidence: 0.5,
    maxActions: 50,
});
