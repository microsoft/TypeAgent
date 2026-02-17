// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import { WorkflowPlan, PlanIndex, PlanIndexEntry } from "./types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:reasoning:planning");

/**
 * Manages workflow plan storage using sessionStorage
 */
export class PlanLibrary {
    private storage: Storage;
    private instanceStorage: Storage | undefined;

    constructor(storage: Storage, instanceStorage?: Storage) {
        this.storage = storage;
        this.instanceStorage = instanceStorage;
    }

    /**
     * Save plan to session storage
     */
    async savePlan(plan: WorkflowPlan): Promise<void> {
        try {
            // Save plan file
            const planPath = `reasoning/plans/${plan.planId}.json`;
            await this.storage.write(
                planPath,
                JSON.stringify(plan, null, 2),
                "utf8",
            );

            // Update index for fast lookup
            await this.updateIndex(plan);

            debug(`Saved plan: ${plan.planId}`);
        } catch (error) {
            console.error(`Failed to save plan ${plan.planId}:`, error);
            throw error;
        }
    }

    /**
     * Load plan by ID
     */
    async loadPlan(planId: string): Promise<WorkflowPlan | null> {
        try {
            const planPath = `reasoning/plans/${planId}.json`;

            if (!(await this.storage.exists(planPath))) {
                return null;
            }

            const content = await this.storage.read(planPath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            debug(`Failed to load plan ${planId}:`, error);
            return null;
        }
    }

    /**
     * Find matching plans by intent or keywords (with scores)
     */
    async findMatchingPlansWithScores(
        request: string,
        intent?: string,
    ): Promise<Array<{ plan: WorkflowPlan; score: number }>> {
        try {
            // Load index
            const index = await this.loadIndex();

            if (index.plans.length === 0) {
                debug("No plans in index");
                return [];
            }

            debug(`Total plans in index: ${index.plans.length}`);

            // Filter by intent if provided
            let candidatePlans = intent
                ? index.plans.filter((p) => p.intent === intent)
                : index.plans;

            if (candidatePlans.length === 0) {
                debug(`No plans found with intent: ${intent}`);
                return [];
            }

            debug(
                `Candidate plans after intent filter: ${candidatePlans.length}`,
            );

            // Rank by keyword match and usage stats
            const ranked = this.rankPlans(candidatePlans, request);

            debug(`Top 3 ranked plans:`);
            for (let i = 0; i < Math.min(3, ranked.length); i++) {
                const entry = ranked[i] as any;
                debug(
                    `  ${i + 1}. ${entry.planId} (${entry.intent}) - score: ${entry.score?.toFixed(3)}`,
                );
            }

            // Load full plan data for top matches (up to 3) and include scores
            const matches: Array<{ plan: WorkflowPlan; score: number }> = [];
            for (const entry of ranked.slice(0, 3)) {
                const plan = await this.loadPlan(entry.planId);
                if (plan) {
                    matches.push({
                        plan,
                        score: (entry as any).score || 0,
                    });
                }
            }

            debug(`Returning ${matches.length} candidate plans for validation`);
            return matches;
        } catch (error) {
            debug(`Failed to find matching plans:`, error);
            return [];
        }
    }

    /**
     * Find matching plans by intent or keywords
     */
    async findMatchingPlans(
        request: string,
        intent?: string,
    ): Promise<WorkflowPlan[]> {
        const results = await this.findMatchingPlansWithScores(request, intent);
        return results.map((r) => r.plan);
    }

    /**
     * Update plan usage stats
     */
    async updatePlanUsage(
        planId: string,
        success: boolean,
        duration: number,
    ): Promise<void> {
        try {
            const plan = await this.loadPlan(planId);
            if (!plan) return;

            // Check if plan is user-approved (immutable structure)
            if (plan.approval?.status === "approved") {
                debug(
                    `Plan ${planId} is user-approved, only updating usage stats`,
                );
            }

            // Initialize usage if not exists
            if (!plan.usage) {
                plan.usage = {
                    successCount: 0,
                    failureCount: 0,
                    lastUsed: new Date().toISOString(),
                    avgDuration: 0,
                };
            }

            // Initialize approval if not exists
            if (!plan.approval) {
                plan.approval = {
                    status: "auto",
                    reviewHistory: [],
                };
            }

            // Update usage stats
            if (success) {
                plan.usage.successCount++;
            } else {
                plan.usage.failureCount++;
            }

            const totalExecutions =
                plan.usage.successCount + plan.usage.failureCount;

            plan.usage.lastUsed = new Date().toISOString();
            plan.usage.avgDuration =
                (plan.usage.avgDuration * (totalExecutions - 1) + duration) /
                totalExecutions;

            // Mark for review after 3+ successful executions (if still auto)
            if (
                plan.approval.status === "auto" &&
                plan.usage.successCount >= 3 &&
                success
            ) {
                plan.approval.status = "pending_review";
                debug(`Plan ${planId} marked for user review`);
            }

            await this.savePlan(plan);

            debug(
                `Updated usage for plan ${planId}: ${success ? "success" : "failure"}`,
            );
        } catch (error) {
            console.error(`Failed to update plan usage:`, error);
        }
    }

    /**
     * Delete plan
     */
    async deletePlan(planId: string): Promise<void> {
        try {
            const planPath = `reasoning/plans/${planId}.json`;
            await this.storage.delete(planPath);

            // Update index to remove plan
            const index = await this.loadIndex();
            index.plans = index.plans.filter((p) => p.planId !== planId);
            await this.saveIndex(index);

            debug(`Deleted plan: ${planId}`);
        } catch (error) {
            console.error(`Failed to delete plan ${planId}:`, error);
        }
    }

    /**
     * List all plans
     */
    async listPlans(): Promise<PlanIndexEntry[]> {
        try {
            const index = await this.loadIndex();
            return index.plans;
        } catch (error) {
            debug(`Failed to list plans:`, error);
            return [];
        }
    }

    /**
     * Promote plan to instance storage (cross-session)
     */
    async promotePlanToInstance(planId: string): Promise<void> {
        if (!this.instanceStorage) {
            debug("Instance storage not available, cannot promote plan");
            return;
        }

        try {
            const plan = await this.loadPlan(planId);
            if (!plan) return;

            // Save to instance storage
            const instancePath = `reasoning/plans/${planId}.json`;
            await this.instanceStorage.write(
                instancePath,
                JSON.stringify(plan, null, 2),
                "utf8",
            );

            // Update instance index
            await this.updateInstanceIndex(plan);

            debug(`Promoted plan to instance storage: ${planId}`);
        } catch (error) {
            console.error(`Failed to promote plan:`, error);
        }
    }

    // Private helper methods

    /**
     * Load plan index for fast lookup
     */
    private async loadIndex(): Promise<PlanIndex> {
        try {
            const indexPath = "reasoning/plans/index.json";

            if (!(await this.storage.exists(indexPath))) {
                return { plans: [] };
            }

            const content = await this.storage.read(indexPath, "utf8");
            return JSON.parse(content);
        } catch (error) {
            debug(`Failed to load index:`, error);
            return { plans: [] };
        }
    }

    /**
     * Save plan index
     */
    private async saveIndex(index: PlanIndex): Promise<void> {
        try {
            await this.storage.write(
                "reasoning/plans/index.json",
                JSON.stringify(index, null, 2),
                "utf8",
            );
        } catch (error) {
            console.error(`Failed to save index:`, error);
        }
    }

    /**
     * Update index with new plan metadata
     */
    private async updateIndex(plan: WorkflowPlan): Promise<void> {
        try {
            const index = await this.loadIndex();

            // Remove old entry if exists
            index.plans = index.plans.filter((p) => p.planId !== plan.planId);

            const totalExecutions = plan.usage
                ? plan.usage.successCount + plan.usage.failureCount
                : 0;

            // Add new entry
            index.plans.push({
                planId: plan.planId,
                intent: plan.intent,
                description: plan.description,
                keywords: this.extractKeywords(plan.description),
                successRate: plan.usage
                    ? totalExecutions > 0
                        ? plan.usage.successCount / totalExecutions
                        : 0
                    : 0,
                lastUsed: plan.usage?.lastUsed || plan.createdAt,
                executionCount: totalExecutions,
                approvalStatus: plan.approval?.status || "auto",
            });

            // Save updated index
            await this.saveIndex(index);
        } catch (error) {
            console.error(`Failed to update index:`, error);
        }
    }

    /**
     * Update instance storage index
     */
    private async updateInstanceIndex(plan: WorkflowPlan): Promise<void> {
        if (!this.instanceStorage) return;

        try {
            // Similar to updateIndex but for instance storage
            const indexPath = "reasoning/plans/index.json";
            let index: PlanIndex = { plans: [] };

            if (await this.instanceStorage.exists(indexPath)) {
                const content = await this.instanceStorage.read(
                    indexPath,
                    "utf8",
                );
                index = JSON.parse(content);
            }

            // Remove old entry if exists
            index.plans = index.plans.filter((p) => p.planId !== plan.planId);

            const totalExecutions = plan.usage
                ? plan.usage.successCount + plan.usage.failureCount
                : 0;

            // Add new entry
            index.plans.push({
                planId: plan.planId,
                intent: plan.intent,
                description: plan.description,
                keywords: this.extractKeywords(plan.description),
                successRate: plan.usage
                    ? totalExecutions > 0
                        ? plan.usage.successCount / totalExecutions
                        : 0
                    : 0,
                lastUsed: plan.usage?.lastUsed || plan.createdAt,
                executionCount: totalExecutions,
                approvalStatus: plan.approval?.status || "auto",
            });

            // Save to instance storage
            await this.instanceStorage.write(
                indexPath,
                JSON.stringify(index, null, 2),
                "utf8",
            );
        } catch (error) {
            console.error(`Failed to update instance index:`, error);
        }
    }

    /**
     * Extract keywords from text for indexing
     */
    private extractKeywords(text: string): string[] {
        // Simple keyword extraction
        // Remove common words and keep meaningful terms
        const commonWords = new Set([
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
            "from",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
        ]);

        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, " ") // Remove punctuation
            .split(/\s+/)
            .filter((w) => w.length > 3 && !commonWords.has(w))
            .slice(0, 10);
    }

    /**
     * Rank plans by relevance to request
     */
    private rankPlans(
        plans: PlanIndexEntry[],
        request: string,
    ): PlanIndexEntry[] {
        const requestWords = new Set(
            request
                .toLowerCase()
                .replace(/[^\w\s]/g, " ") // Remove punctuation
                .split(/\s+/)
                .filter((w) => w.length > 3),
        );

        return plans
            .map((plan) => {
                // Keyword match score
                const matchingKeywords = plan.keywords.filter((k) =>
                    requestWords.has(k),
                );
                const keywordScore =
                    matchingKeywords.length / Math.max(plan.keywords.length, 1);

                // Success rate weight (only if enough data)
                const successWeight =
                    plan.executionCount >= 3 ? plan.successRate : 0.5;

                // Recency score (decay over time)
                const daysSinceUse =
                    (Date.now() - new Date(plan.lastUsed).getTime()) /
                    (1000 * 60 * 60 * 24);
                const recencyScore = Math.exp(-daysSinceUse / 30); // 30-day half-life

                // Approval boost
                let approvalBoost = 0;
                switch (plan.approvalStatus) {
                    case "approved":
                        approvalBoost = 0.3; // Significant boost for user-approved
                        break;
                    case "reviewed":
                        approvalBoost = 0.1; // Small boost for reviewed
                        break;
                    case "pending_review":
                        approvalBoost = 0.05; // Tiny boost for pending
                        break;
                    case "auto":
                    default:
                        approvalBoost = 0;
                }

                // Combined score (keyword: 40%, success: 25%, recency: 15%, approval: 20%)
                const score =
                    keywordScore * 0.4 +
                    successWeight * 0.25 +
                    recencyScore * 0.15 +
                    approvalBoost;

                return { ...plan, score };
            })
            .sort((a: any, b: any) => b.score - a.score);
    }
}
