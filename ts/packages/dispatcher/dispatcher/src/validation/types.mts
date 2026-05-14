// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Internal types for grammar validation implementation.
 * These types are used only within the dispatcher validation service.
 *
 * Note: GrammarValidationRequest and GrammarValidationResult are defined
 * in @typeagent/agent-sdk as the public API for agents.
 */

export interface PatternValidationResult {
    pattern: string;
    commonnessScore: number; // 1-5 scale
    reasoning: string;
    recommendation: "accept" | "revise" | "reject";
    suggestions?: string[];
}

export interface CollisionInfo {
    pattern: string;
    collidingAgent: string;
    collidingAction: string;
    testUtterance: string;
    matchConfidence: number;
}

export interface CollisionDetectionResult {
    hasCollisions: boolean;
    collisions: CollisionInfo[];
    severity: "critical" | "warning" | "info";
}

export interface ValidationResult {
    approved: boolean;
    patterns: string[];
    warnings?: string[];
    errors?: string[];
    suggestions?: string[];
}

export interface TestUtterance {
    text: string;
    sourcePattern: string;
    expectedAction: string;
    isCommon: boolean;
}

export interface RefinementResult {
    originalPattern: string;
    refinedPattern: string;
    improvementReason: string;
    newScore: number;
}

export interface StoredPattern {
    actionName: string;
    pattern: string;
    source: "reasoning" | "manual" | "seed";
}

export interface ActionDefinition {
    actionName: string;
    description: string;
    patterns: string[];
    parameters: Record<string, ParameterDefinition>;
}

export interface ParameterDefinition {
    type: "string" | "number" | "boolean" | "path";
    required?: boolean;
    default?: unknown;
    description?: string;
}
