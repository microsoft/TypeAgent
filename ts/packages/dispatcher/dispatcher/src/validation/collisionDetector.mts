// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CollisionDetectionResult,
    CollisionInfo,
    TestUtterance,
} from "./types.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:validation:collision");

export interface CollisionDetectorConfig {
    currentAgent: string;
    agentGrammarRegistry: any; // AgentGrammarRegistry from actionGrammar
}

export class CollisionDetector {
    constructor(private config: CollisionDetectorConfig) {}

    async detectCollisions(
        patterns: string[],
        actionName: string,
    ): Promise<CollisionDetectionResult> {
        const collisions: CollisionInfo[] = [];

        const testUtterances = this.generateTestUtterances(patterns, actionName);
        debug(`Generated ${testUtterances.length} test utterances`);

        const registeredAgents =
            this.config.agentGrammarRegistry.getAllAgentIds();
        debug(`Testing against ${registeredAgents.length} agents`);

        for (const otherAgent of registeredAgents) {
            if (otherAgent === this.config.currentAgent) {
                continue;
            }

            const agentCollisions = await this.testAgainstAgent(
                otherAgent,
                testUtterances,
            );
            collisions.push(...agentCollisions);
        }

        return {
            hasCollisions: collisions.length > 0,
            collisions,
            severity: this.classifySeverity(collisions),
        };
    }

    private async testAgainstAgent(
        agentName: string,
        testUtterances: TestUtterance[],
    ): Promise<CollisionInfo[]> {
        const collisions: CollisionInfo[] = [];

        // Test against agent's grammar (includes static + dynamic rules)
        const agentGrammar =
            this.config.agentGrammarRegistry.getAgent(agentName);
        if (!agentGrammar) {
            return collisions;
        }

        debug(`Agent ${agentName}: testing against grammar (static + dynamic)`);

        for (const utterance of testUtterances) {
            const matchResult = agentGrammar.match(utterance.text);
            if (matchResult && matchResult.match) {
                collisions.push({
                    pattern: utterance.sourcePattern,
                    collidingAgent: agentName,
                    collidingAction: matchResult.actionName || "unknown",
                    testUtterance: utterance.text,
                    matchConfidence: matchResult.confidence || 1.0,
                });
            }
        }

        return collisions;
    }

    private generateTestUtterances(
        patterns: string[],
        actionName: string,
    ): TestUtterance[] {
        const utterances: TestUtterance[] = [];

        for (const pattern of patterns) {
            const examples = this.patternToExamples(pattern);
            for (const example of examples) {
                utterances.push({
                    text: example,
                    sourcePattern: pattern,
                    expectedAction: actionName,
                    isCommon: true,
                });
            }
        }

        return utterances;
    }

    private patternToExamples(pattern: string): string[] {
        const examples: string[] = [];

        let example = pattern.replace(/\$\([^)]+\)/g, (match) => {
            const parts = match.match(/\$\((\w+):(\w+)\)/);
            if (parts) {
                const [, paramName, paramType] = parts;
                return this.getExampleValue(paramName, paramType);
            }
            return "value";
        });

        examples.push(example);

        let exampleWithArticle = pattern.replace(/\$\([^)]+\)/g, (match) => {
            const parts = match.match(/\$\((\w+):(\w+)\)/);
            if (parts) {
                const [, paramName, paramType] = parts;
                return `the ${this.getExampleValue(paramName, paramType)}`;
            }
            return "the value";
        });
        if (exampleWithArticle !== example) {
            examples.push(exampleWithArticle);
        }

        return examples;
    }

    private getExampleValue(paramName: string, paramType: string): string {
        if (paramType === "wildcard" || paramType === "path") {
            if (paramName.includes("file")) return "test.txt";
            if (paramName.includes("dir") || paramName.includes("path"))
                return "documents";
            if (paramName.includes("script")) return "script.ps1";
        }
        if (paramType === "number") return "5";
        if (paramType === "boolean") return "true";

        return paramName;
    }

    private classifySeverity(
        collisions: CollisionInfo[],
    ): "critical" | "warning" | "info" {
        if (collisions.length === 0) return "info";

        const highConfidence = collisions.filter(
            (c) => c.matchConfidence > 0.9,
        );
        if (highConfidence.length > 0) return "critical";

        const mediumConfidence = collisions.filter(
            (c) => c.matchConfidence > 0.7,
        );
        if (mediumConfidence.length > 3) return "warning";

        return "info";
    }
}
