// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createDiscoveryPageTranslator,
    HtmlFragments,
} from "../discovery/translator.mjs";
import { PageDescription } from "../discovery/schema/pageSummary.mjs";
import { UserActionsList } from "../discovery/schema/userActionsPool.mjs";
import { UnifiedActionsList } from "../discovery/schema/unifiedActions.mjs";
import { DetectedAction } from "./schema/knowledgeExtraction.mjs";
import { ExtractionMode } from "website-memory";

/**
 * ActionDetectionAdapter bridges knowledge extraction and discovery agent systems.
 * Orchestrates three-phase action detection process:
 * 1. Page Summary - get high-level actions from page analysis
 * 2. Candidate Actions - get detailed actions from known schemas
 * 3. Unified Actions - deduplicate and structure actions consistently
 */
export class ActionDetectionAdapter {
    private discoveryAgent: any = null;
    private isInitialized: boolean = false;

    constructor() {}

    /**
     * Main entry point: Detect actions for given HTML fragments using specified mode
     */
    async detectActions(
        htmlFragments: any[],
        mode: ExtractionMode,
        screenshots?: string[],
    ): Promise<DetectedAction[]> {
        try {
            // Only perform action detection for modes that support it
            if (mode !== "macros" && mode !== "full") {
                return [];
            }

            // Initialize discovery agent if needed
            await this.ensureDiscoveryAgent();

            if (!this.discoveryAgent) {
                console.warn(
                    "Discovery agent not available, skipping action detection",
                );
                return [];
            }

            // Convert HTML fragments to discovery agent format
            const discoveryFragments =
                this.convertToDiscoveryFormat(htmlFragments);

            if (discoveryFragments.length === 0) {
                console.warn("No valid HTML fragments for action detection");
                return [];
            }

            // Execute three-phase detection process

            const unifiedActions = await this.executeThreePhaseDetection(
                this.discoveryAgent,
                discoveryFragments,
                screenshots,
            );

            // Convert unified actions to knowledge extraction format
            return this.convertToKnowledgeFormat(unifiedActions);
        } catch (error) {
            console.error("Error in action detection:", error);
            // Graceful degradation - don't fail knowledge extraction
            return [];
        }
    }

    /**
     * Initialize discovery agent with lazy loading and error handling
     */
    private async ensureDiscoveryAgent(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            // Use GPT_4_O for consistency with discovery agent
            this.discoveryAgent =
                await createDiscoveryPageTranslator("GPT_4_O");
            this.isInitialized = true;
            console.log(
                "Discovery agent initialized successfully for action detection",
            );
        } catch (error) {
            console.warn("Failed to initialize discovery agent:", error);
            this.discoveryAgent = null;
            this.isInitialized = true; // Mark as attempted to avoid retries
        }
    }

    /**
     * Convert knowledge extraction HTML fragments to discovery agent format
     */
    private convertToDiscoveryFormat(htmlFragments: any[]): HtmlFragments[] {
        return htmlFragments
            .filter(
                (fragment) => fragment && (fragment.content || fragment.text),
            )
            .map((fragment, index) => ({
                frameId: fragment.frameId?.toString() || index.toString(),
                content: fragment.content || "",
                text: fragment.text || "",
                cssSelector: fragment.cssSelector,
            }));
    }

    /**
     * Execute the three-phase action detection process
     */
    private async executeThreePhaseDetection(
        agent: any,
        htmlFragments: HtmlFragments[],
        screenshots?: string[],
    ): Promise<UnifiedActionsList | null> {
        try {
            console.time("Three-phase action detection");

            // Phase 1: Get page summary with possible actions
            console.time("Phase 1: Page Summary");
            const pageSummaryResponse = await agent.getPageSummary(
                undefined, // userRequest
                htmlFragments,
                screenshots,
            );
            console.timeEnd("Phase 1: Page Summary");

            if (!pageSummaryResponse.success) {
                console.warn(
                    "Page summary failed:",
                    pageSummaryResponse.message,
                );
                return null;
            }

            const pageDescription = pageSummaryResponse.data as PageDescription;
            console.log(
                `Phase 1 complete: Found ${pageDescription.possibleUserAction?.length || 0} possible actions`,
            );

            // Phase 2: Get candidate actions from schemas
            console.time("Phase 2: Candidate Actions");
            const candidateActionsResponse =
                await agent.getCandidateUserActions(
                    undefined, // userRequest
                    htmlFragments,
                    screenshots,
                    JSON.stringify(pageDescription), // Pass page summary as context
                );
            console.timeEnd("Phase 2: Candidate Actions");

            if (!candidateActionsResponse.success) {
                console.warn(
                    "Candidate actions failed:",
                    candidateActionsResponse.message,
                );
                return null;
            }

            const candidateActions =
                candidateActionsResponse.data as UserActionsList;
            console.log(
                `Phase 2 complete: Found ${candidateActions.actions?.length || 0} candidate actions`,
            );

            // Phase 3: Unify and deduplicate actions

            // TODO: For now, only pass in the known actions list in the de-dupe step. The general possible
            //       actions list is currently too general. We'll need to narrow it down before it is useful
            console.time("Phase 3: Unified Actions");
            const unifiedActionsResponse = await agent.unifyUserActions(
                candidateActions,
                undefined,
                htmlFragments,
                screenshots,
            );
            console.timeEnd("Phase 3: Unified Actions");

            if (!unifiedActionsResponse.success) {
                console.warn(
                    "Action unification failed:",
                    unifiedActionsResponse.message,
                );
                return null;
            }

            const unifiedActions =
                unifiedActionsResponse.data as UnifiedActionsList;
            console.log(
                `Phase 3 complete: Unified ${unifiedActions.finalCount} actions from ${unifiedActions.originalCount} total`,
            );

            console.timeEnd("Three-phase action detection");
            return unifiedActions;
        } catch (error) {
            console.error("Error in three-phase action detection:", error);
            return null;
        }
    }

    /**
     * Convert unified actions to knowledge extraction DetectedAction format
     */
    private convertToKnowledgeFormat(
        unifiedActions: UnifiedActionsList | null,
    ): DetectedAction[] {
        if (!unifiedActions || !unifiedActions.actions) {
            return [];
        }

        return unifiedActions.actions.map((action) => ({
            type: action.verb || "action",
            element: action.directObject || "element",
            text:
                action.shortDescription ||
                `${action.verb} ${action.directObject}`,
            confidence: action.confidence || 0.8,
        }));
    }

    /**
     * Check if action detection is available (AI model ready)
     */
    isActionDetectionAvailable(): boolean {
        return this.isInitialized && this.discoveryAgent !== null;
    }

    /**
     * Get summary of action detection capabilities
     */
    getCapabilities() {
        return {
            available: this.isActionDetectionAvailable(),
            supportedModes: ["actions", "full"],
            phases: [
                "Page Summary Analysis",
                "Candidate Action Detection",
                "Unified Action Deduplication",
            ],
            aiModelRequired: true,
        };
    }
}
