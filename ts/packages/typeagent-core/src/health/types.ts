// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type HealthSeverity = "info" | "warning" | "error";

export interface HealthEvidence {
    file?: string;
    range?: [number, number];
    message: string;
}

export interface HealthFixHint {
    kind: "code-action" | "command";
    payload: unknown;
}

export interface HealthFinding {
    ruleId: string;
    severity: HealthSeverity;
    agent: string;
    evidence: HealthEvidence;
    fixHint?: HealthFixHint;
}

export interface AgentFileRefs {
    packageDir: string;
    srcDir: string;
    manifestFile?: string;
    schemaFiles: string[];
    grammarFiles: string[];
    handlerFiles: string[];
}

export interface HealthContext {
    repoRoot: string;
    agent: string;
    files: AgentFileRefs;
    loadedActionTypes?: Record<string, string[]>;
    cacheSchemaHash?: string;
}

export interface HealthRule {
    id: string;
    description: string;
    check(ctx: HealthContext): Promise<HealthFinding[]>;
}

export interface HealthService {
    check(agent: string): Promise<HealthFinding[]>;
    rules(): HealthRule[];
}
