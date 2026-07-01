// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The keyword index (§5–6): resolves a candidate's *effective* keyword vector =
// derived lexical defaults (memoized, drift-proof) layered with sidecar deltas
// (live-tunable). The one place the scorer reads candidate keywords from. The
// schema-reading side is behind `ActionSchemaSource` so the index is unit-
// testable with a stub source.

import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import { KeywordVector, applyKeywordDelta } from "./keywordVector.js";
import { buildExtractionInput, extractKeywords } from "./keywordExtractor.js";
import { KeywordSidecar, keywordId } from "./keywordSidecar.js";

// Read-only access to the live schema text an action derives its keywords from.
// The seam that keeps the index decoupled from the AppAgentManager.
export interface ActionSchemaSource {
    getSchemaDescription(schemaName: string): string | undefined;
    getActionDefinition(
        schemaName: string,
        actionName: string,
    ): ActionSchemaTypeDefinition | undefined;
}

// Structural view of the AppAgentManager methods the production source needs —
// avoids importing the concrete manager type here.
export interface AgentSchemaProvider {
    tryGetActionConfig(
        schemaName: string,
    ): { description?: string } | undefined;
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

    constructor(
        private readonly source: ActionSchemaSource,
        private readonly getSidecar: () => KeywordSidecar,
    ) {}

    // Lexical-floor keywords for one action (memoized).
    public derived(schemaName: string, actionName: string): KeywordVector {
        const id = keywordId(schemaName, actionName);
        const cached = this.derivedMemo.get(id);
        if (cached !== undefined) {
            return cached;
        }
        const definition = this.source.getActionDefinition(
            schemaName,
            actionName,
        );
        const vector: KeywordVector =
            definition === undefined
                ? new Set<string>()
                : extractKeywords(
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

    // Drop cached derived vectors when a schema may have changed (agent
    // add/remove/reload). Clears all when no schema is given.
    public invalidate(schemaName?: string): void {
        if (schemaName === undefined) {
            this.derivedMemo.clear();
            return;
        }
        const prefix = `${schemaName}.`;
        for (const id of [...this.derivedMemo.keys()]) {
            if (id.startsWith(prefix)) {
                this.derivedMemo.delete(id);
            }
        }
    }
}
