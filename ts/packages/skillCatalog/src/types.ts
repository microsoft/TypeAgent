// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    Grammar,
    GrammarJson,
    GrammarMatchResult,
} from "@typeagent/action-grammar";

export type SkillScope = "builtin" | "user" | "project" | "package";
export type CatalogState =
    | "draft"
    | "validated"
    | "approved"
    | "active"
    | "disabled"
    | "archived";

export interface SkillIdentity {
    readonly scope: SkillScope;
    readonly origin: string;
    readonly name: string;
}

export interface SkillFileInput {
    path: string;
    content: string | Uint8Array;
}

export interface SkillFileManifest {
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
}

export interface SkillPackageInput {
    identity: SkillIdentity;
    displayName?: string;
    description?: string;
    schemaFingerprint: string;
    files: readonly SkillFileInput[];
}

export interface SkillRevision {
    readonly identity: SkillIdentity;
    readonly qualifiedName: string;
    readonly revision: string;
    readonly displayName: string;
    readonly description: string;
    readonly schemaFingerprint: string;
    readonly manifest: readonly SkillFileManifest[];
    readonly createdAt: string;
}

export interface CatalogEntry {
    readonly revision: SkillRevision;
    readonly state: CatalogState;
    readonly active: boolean;
}

export interface CatalogSearchQuery {
    text: string;
    scopes?: readonly SkillScope[];
    limit?: number;
}

export interface CatalogSearchResult {
    entry: CatalogEntry;
    score: number;
    source: "exact" | "semantic";
}

export interface SemanticSkillSearch {
    search(
        query: CatalogSearchQuery,
        candidates: readonly CatalogEntry[],
    ): Promise<readonly CatalogSearchResult[]>;
}

export interface InstanceStorage {
    read(path: string): Promise<Uint8Array>;
    read(path: string, encoding: "utf8" | "base64"): Promise<string>;
    write(
        path: string,
        data: string,
        encoding?: "utf8" | "base64",
    ): Promise<void>;
    write(path: string, data: Uint8Array): Promise<void>;
    list(
        path: string,
        options?: { dirs?: boolean; fullPath?: boolean },
    ): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    delete(path: string): Promise<void>;
}

export type GrammarRuleSource =
    | "package"
    | "generated"
    | "userCorrection"
    | "contextOverlay";

export interface SkillGrammarRule {
    readonly id: string;
    readonly skill: SkillIdentity;
    readonly skillRevision: string;
    readonly schemaFingerprint: string;
    readonly source: GrammarRuleSource;
    readonly grammar: GrammarJson;
}

export interface CompiledSkillGrammarRule
    extends Omit<SkillGrammarRule, "grammar"> {
    readonly grammar: Grammar;
}

export interface RoutingSnapshot {
    readonly id: string;
    readonly createdAt: string;
    readonly rules: readonly CompiledSkillGrammarRule[];
}

export interface SchemaValidation {
    valid: boolean;
    errors?: readonly string[];
}

export type SchemaValidator = (
    skill: SkillIdentity,
    schemaFingerprint: string,
    value: unknown,
) => SchemaValidation;

export interface GrammarCandidate {
    skill: SkillIdentity;
    skillRevision: string;
    schemaFingerprint: string;
    ruleId: string;
    ruleSource: GrammarRuleSource;
    value: unknown;
    match: GrammarMatchResult;
}

export type GrammarRouteOutcome =
    | { status: "miss" }
    | {
          status: "match";
          candidate: GrammarCandidate;
          equivalentMatchCount: number;
      }
    | {
          status: "ambiguous";
          candidates: readonly GrammarCandidate[];
      }
    | {
          status: "invalid";
          candidates: readonly GrammarCandidate[];
          errors: readonly string[];
      };

export type RoutingMode = "grammarFirst" | "grammarOnly" | "hybrid" | "shadow";

export interface FallbackRouteCandidate {
    skill: SkillIdentity;
    value: unknown;
    score: number;
}

export interface FallbackRouter {
    route(utterance: string): Promise<readonly FallbackRouteCandidate[]>;
}

export interface RouteResult {
    mode: RoutingMode;
    selected: "grammar" | "fallback" | "none";
    grammar: GrammarRouteOutcome;
    fallback?: readonly FallbackRouteCandidate[];
}

export interface StoredCorrection {
    readonly id: string;
    readonly skill: SkillIdentity;
    readonly skillRevision: string;
    readonly schemaFingerprint: string;
    readonly grammar: GrammarJson;
    readonly createdAt: string;
}
