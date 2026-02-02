// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Plan Serializer - Saves and loads execution plans to/from files
 */

import * as fs from "fs/promises";
import * as path from "path";
import { ExecutionPlan } from "./types.js";

export class PlanSerializer {
    /**
     * Save original plan (version 1) before execution
     */
    async saveOriginalPlan(
        plan: ExecutionPlan,
        outputDir: string,
    ): Promise<string> {
        const planDir = path.join(outputDir, plan.taskId);
        await fs.mkdir(planDir, { recursive: true });

        const filePath = path.join(planDir, "plan-original.json");

        await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf-8");

        console.log(`[PlanSerializer] Saved original plan to ${filePath}`);
        return filePath;
    }

    /**
     * Save revised plan after execution (version 2+)
     */
    async saveRevisedPlan(
        plan: ExecutionPlan,
        outputDir: string,
    ): Promise<string> {
        const planDir = path.join(outputDir, plan.taskId);
        await fs.mkdir(planDir, { recursive: true });

        const filePath = path.join(
            planDir,
            `plan-revised-v${plan.version}.json`,
        );

        await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf-8");

        console.log(
            `[PlanSerializer] Saved revised plan (v${plan.version}) to ${filePath}`,
        );
        return filePath;
    }

    /**
     * Save plan comparison (original vs revised)
     */
    async savePlanComparison(
        originalPlan: ExecutionPlan,
        revisedPlan: ExecutionPlan,
        outputDir: string,
    ): Promise<string> {
        const planDir = path.join(outputDir, originalPlan.taskId);
        await fs.mkdir(planDir, { recursive: true });

        const comparison = {
            taskId: originalPlan.taskId,
            comparisonDate: new Date().toISOString(),
            original: {
                version: originalPlan.version,
                steps: originalPlan.steps.length,
                variables: originalPlan.variables.length,
            },
            revised: {
                version: revisedPlan.version,
                steps: revisedPlan.steps.length,
                variables: revisedPlan.variables.length,
            },
            changes: this.computePlanDifferences(originalPlan, revisedPlan),
            originalPlan,
            revisedPlan,
        };

        const filePath = path.join(
            planDir,
            `plan-comparison-v${originalPlan.version}-to-v${revisedPlan.version}.json`,
        );

        await fs.writeFile(
            filePath,
            JSON.stringify(comparison, null, 2),
            "utf-8",
        );

        console.log(`[PlanSerializer] Saved plan comparison to ${filePath}`);
        return filePath;
    }

    /**
     * Load plan from file
     */
    async loadPlan(filePath: string): Promise<ExecutionPlan> {
        const content = await fs.readFile(filePath, "utf-8");
        const plan = JSON.parse(content) as ExecutionPlan;

        console.log(
            `[PlanSerializer] Loaded plan ${plan.planId} (v${plan.version}) from ${filePath}`,
        );

        return plan;
    }

    /**
     * Load latest plan version for a task
     */
    async loadLatestPlan(
        taskId: string,
        outputDir: string,
    ): Promise<ExecutionPlan | null> {
        const planDir = path.join(outputDir, taskId);

        try {
            const files = await fs.readdir(planDir);

            // Find all plan files
            const planFiles = files.filter(
                (f) => f.startsWith("plan-") && f.endsWith(".json"),
            );

            if (planFiles.length === 0) {
                return null;
            }

            // Sort by version (revised plans have higher versions)
            planFiles.sort((a, b) => {
                const versionA = this.extractVersionFromFilename(a);
                const versionB = this.extractVersionFromFilename(b);
                return versionB - versionA;
            });

            const latestFile = planFiles[0];
            return await this.loadPlan(path.join(planDir, latestFile));
        } catch (error) {
            console.warn(
                `[PlanSerializer] No plans found for task ${taskId}:`,
                error,
            );
            return null;
        }
    }

    /**
     * Save plan summary for reporting
     */
    async savePlanSummary(
        plan: ExecutionPlan,
        outputDir: string,
    ): Promise<string> {
        const planDir = path.join(outputDir, plan.taskId);
        await fs.mkdir(planDir, { recursive: true });

        const summary = {
            planId: plan.planId,
            taskId: plan.taskId,
            version: plan.version,
            createdAt: plan.createdAt,
            task: plan.task,
            goalState: {
                pageType: plan.goalState.expectedPageType,
                confidence: plan.goalState.confidence,
                keyElements: plan.goalState.expectedElements?.length || 0,
            },
            steps: plan.steps.map((step) => ({
                stepId: step.stepId,
                stepNumber: step.stepNumber,
                objective: step.objective,
                actions: step.actions.length,
                hasControlFlow: !!step.controlFlow,
                preconditions: step.preconditions.length,
            })),
            totalSteps: plan.steps.length,
            totalActions: plan.steps.reduce(
                (sum, step) => sum + step.actions.length,
                0,
            ),
            variables: plan.variables.length,
            execution: plan.execution
                ? {
                      status: plan.execution.status,
                      duration: plan.execution.duration,
                      corrections: plan.execution.corrections.length,
                      metrics: plan.execution.performanceMetrics,
                  }
                : null,
        };

        const filePath = path.join(
            planDir,
            `plan-summary-v${plan.version}.json`,
        );

        await fs.writeFile(filePath, JSON.stringify(summary, null, 2), "utf-8");

        console.log(`[PlanSerializer] Saved plan summary to ${filePath}`);
        return filePath;
    }

    /**
     * Compute differences between two plans
     */
    private computePlanDifferences(
        original: ExecutionPlan,
        revised: ExecutionPlan,
    ): any {
        return {
            stepsAdded: revised.steps.length - original.steps.length,
            variablesAdded:
                revised.variables.length - original.variables.length,
            stepChanges: this.compareSteps(original.steps, revised.steps),
            goalStateChanged:
                JSON.stringify(original.goalState) !==
                JSON.stringify(revised.goalState),
        };
    }

    /**
     * Compare steps between plans
     */
    private compareSteps(originalSteps: any[], revisedSteps: any[]): any[] {
        const changes: any[] = [];

        const maxLength = Math.max(originalSteps.length, revisedSteps.length);

        for (let i = 0; i < maxLength; i++) {
            const original = originalSteps[i];
            const revised = revisedSteps[i];

            if (!original && revised) {
                changes.push({
                    stepId: revised.stepId,
                    change: "added",
                    objective: revised.objective,
                });
            } else if (original && !revised) {
                changes.push({
                    stepId: original.stepId,
                    change: "removed",
                    objective: original.objective,
                });
            } else if (original && revised) {
                const stepChanges: string[] = [];

                if (original.objective !== revised.objective) {
                    stepChanges.push("objective");
                }
                if (original.actions.length !== revised.actions.length) {
                    stepChanges.push("actions");
                }
                if (
                    JSON.stringify(original.predictedState) !==
                    JSON.stringify(revised.predictedState)
                ) {
                    stepChanges.push("predictedState");
                }
                if (
                    JSON.stringify(original.preconditions) !==
                    JSON.stringify(revised.preconditions)
                ) {
                    stepChanges.push("preconditions");
                }

                if (stepChanges.length > 0) {
                    changes.push({
                        stepId: original.stepId,
                        change: "modified",
                        modifications: stepChanges,
                    });
                }
            }
        }

        return changes;
    }

    /**
     * Extract version number from filename
     */
    private extractVersionFromFilename(filename: string): number {
        if (filename === "plan-original.json") {
            return 1;
        }

        const match = filename.match(/plan-revised-v(\d+)\.json/);
        return match ? parseInt(match[1]) : 0;
    }
}
