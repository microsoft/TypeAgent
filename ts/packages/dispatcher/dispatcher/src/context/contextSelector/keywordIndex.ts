// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The keyword index (§5–6): resolves a candidate's *effective* keyword vector =
// derived lexical defaults (memoized, drift-proof) layered with sidecar deltas
// (live-tunable). The one place the scorer reads candidate keywords from. The
// schema-reading side is behind `ActionSchemaSource` so the index is unit-
// testable with a stub source.
//
// v1 baseline = the deterministic lexical floor (keywordExtractor). LLM
// distillation (the design's preferred baseline) and auto-derived sidecar layers
// (misroute mining, learned-preference deltas) are follow-ups: they slot in as
// an alternate baseline and additional sidecar deltas without changing this
// index's shape.

import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import { KeywordVector, applyKeywordDelta } from "./keywordVector.js";
import { buildExtractionInput, extractKeywords } from "./keywordExtractor.js";
import { KeywordSidecar, keywordId } from "./keywordSidecar.js";
import {
    KeywordFile,
    loadKeywordFile,
    keywordFilePathFor,
} from "./keywordFile.js";

// Read-only access to the keyword data an action derives its vector from — the
// committed keyword file (§5 Source 1, preferred) and the live schema text (the
// lexical floor fallback). The seam that keeps the index decoupled from the
// AppAgentManager.
export interface ActionSchemaSource {
    // The committed keyword file for a schema, if one exists (§5 Source 1).
    // Optional: a source that doesn't provide committed files (tests, minimal
    // hosts) simply falls back to the live lexical floor.
    getKeywordFile?(schemaName: string): KeywordFile | undefined;
    getSchemaDescription(schemaName: string): string | undefined;
    getActionDefinition(
        schemaName: string,
        actionName: string,
    ): ActionSchemaTypeDefinition | undefined;
}

// Structural view of the AppAgentManager methods the production source needs —
// avoids importing the concrete manager type here. The schema file paths are the
// (already-absolute) locations the per-agent keyword file sits beside.
export interface AgentSchemaProvider {
    tryGetActionConfig(schemaName: string):
        | {
              description?: string;
              originalSchemaFilePath?: string | undefined;
              schemaFilePath?: string | undefined;
          }
        | undefined;
    tryGetActionSchemaFile(schemaName: string):
        | {
              parsedActionSchema: {
                  actionSchemas: Map<string, ActionSchemaTypeDefinition>;
              };
          }
        | undefined;
}

// Adapt the AppAgentManager to `ActionSchemaSource`. All reads are guarded — a
// schema that isn't loadable yet (agent failed/slow to start) yields undefined
// text, which the extractor treats as an empty (uncovered) vector.
export function agentSchemaSource(
    agents: AgentSchemaProvider,
): ActionSchemaSource {
    return {
        getKeywordFile(schemaName: string): KeywordFile | undefined {
            try {
                // Per-agent file: a sibling of this schema's source (§5).
                const config = agents.tryGetActionConfig(schemaName);
                const filePath = keywordFilePathFor(
                    config?.originalSchemaFilePath,
                    config?.schemaFilePath,
                );
                return loadKeywordFile(filePath, schemaName);
            } catch {
                return undefined;
            }
        },
        getSchemaDescription(schemaName: string): string | undefined {
            try {
                return agents.tryGetActionConfig(schemaName)?.description;
            } catch {
                return undefined;
            }
        },
        getActionDefinition(
            schemaName: string,
            actionName: string,
        ): ActionSchemaTypeDefinition | undefined {
            try {
                return agents
                    .tryGetActionSchemaFile(schemaName)
                    ?.parsedActionSchema.actionSchemas.get(actionName);
            } catch {
                return undefined;
            }
        },
    };
}

export class KeywordIndex {
    // Derived-only vectors, keyed by `schema.action`. Cached because extraction
    // reads/parses schema text; sidecar deltas are applied fresh on top so live
    // `@collision keywords` edits take effect without invalidating this.
    private readonly derivedMemo = new Map<string, KeywordVector>();

    // Committed keyword file per schema (§5 Source 1), memoized so it is read
    // once per schema rather than once per action. `null` records "looked, none
    // present" so a missing file isn't re-read on every action.
    private readonly keywordFileMemo = new Map<string, KeywordFile | null>();

    constructor(
        private readonly source: ActionSchemaSource,
        private readonly getSidecar: () => KeywordSidecar,
    ) {}

    private keywordFile(schemaName: string): KeywordFile | null {
        const cached = this.keywordFileMemo.get(schemaName);
        if (cached !== undefined) {
            return cached;
        }
        const file = this.source.getKeywordFile?.(schemaName) ?? null;
        this.keywordFileMemo.set(schemaName, file);
        return file;
    }

    // Baseline keywords for one action (memoized). Prefers the committed keyword
    // file (§5 Source 1, LLM-distilled or lexical); falls back to live lexical
    // extraction (§6.1 floor) when the file is absent or doesn't cover the
    // action. A missing schema definition is NOT memoized, so it is re-read once
    // the schema is available rather than cached empty forever.
    public derived(schemaName: string, actionName: string): KeywordVector {
        const id = keywordId(schemaName, actionName);
        const cached = this.derivedMemo.get(id);
        if (cached !== undefined) {
            return cached;
        }
        const fromFile = this.keywordFile(schemaName)?.actions[actionName];
        if (fromFile !== undefined && fromFile.length > 0) {
            const vector = new Set(fromFile);
            this.derivedMemo.set(id, vector);
            return vector;
        }
        const definition = this.source.getActionDefinition(
            schemaName,
            actionName,
        );
        if (definition === undefined) {
            return new Set<string>();
        }
        const vector = extractKeywords(
            buildExtractionInput(
                actionName,
                definition,
                this.source.getSchemaDescription(schemaName),
            ),
        );
        this.derivedMemo.set(id, vector);
        return vector;
    }

    // Effective keywords = derived ∪ add − remove (or replace) from the sidecar.
    public effective(schemaName: string, actionName: string): KeywordVector {
        const derived = this.derived(schemaName, actionName);
        const delta = this.getSidecar().deltaFor(schemaName, actionName);
        return applyKeywordDelta(derived, delta);
    }

    // Drop cached vectors + keyword file when a schema may have changed (agent
    // add/remove/reload, or a fresh backfill). Clears all when no schema given.
    // Agent reload passes the agent name, which is the prefix of its sub-schema
    // names, so both memos are cleared by prefix for symmetry.
    public invalidate(schemaName?: string): void {
        if (schemaName === undefined) {
            this.derivedMemo.clear();
            this.keywordFileMemo.clear();
            return;
        }
        const prefix = `${schemaName}.`;
        this.keywordFileMemo.delete(schemaName);
        for (const key of [...this.keywordFileMemo.keys()]) {
            if (key.startsWith(prefix)) {
                this.keywordFileMemo.delete(key);
            }
        }
        for (const id of [...this.derivedMemo.keys()]) {
            if (id.startsWith(prefix)) {
                this.derivedMemo.delete(id);
            }
        }
    }
}
