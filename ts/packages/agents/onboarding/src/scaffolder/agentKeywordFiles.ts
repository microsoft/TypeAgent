// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The "onboarding moment" of the contextSelector keyword-vector lifecycle
// (see docs/architecture/collision/onboarding-keyword-generation-design.md).
// After the scaffolder writes the new agent's schema sources, this generates a
// committed `<schema>.keywords.json` beside each one so the agent ships with
// LLM-distilled keyword vectors for context-weighted collision resolution -
// without waiting for a `@collision keywords backfill` pass.
//
// This is thin glue: the scaffolder (which owns all the naming) builds the
// targets; this loops them through the dispatcher helper with the onboarding
// LLM model factory, catching per target so keyword generation can NEVER break
// scaffolding.

import path from "path";
import { generateKeywordFileForSchemaSource } from "agent-dispatcher/contextSelector";
import { getKeywordGenModel } from "../lib/llm.js";

// One schema to generate a keyword file for. The scaffolder fills these from the
// schema sources it just wrote (main schema + each sub-group), skipping the
// placeholder-only main union.
export type KeywordSchemaTarget = {
    // Cosmetic file `schema` field: the agent name for a main schema,
    // `${agent}.${group}` for a sub-schema.
    schemaName: string;
    // Absolute path to the schema `.ts` source the file is written beside.
    schemaSourcePath: string;
    // The entry action union type, e.g. "FooActions".
    entryTypeName: string;
    schemaDescription?: string | undefined;
};

export type KeywordGenOutcome = {
    // Successfully committed files, as paths relative to the agent package root.
    generated: {
        schemaName: string;
        relPath: string;
        actionCount: number;
        distilled: number;
        lexical: number;
        generatedBy: string;
    }[];
    errors: { schemaName: string; error: string }[];
};

// Generate keyword files for each target. Never throws - a target that fails
// (unparseable schema, LLM-less environment that also can't reach the lexical
// floor, write failure) is recorded in `errors` and the rest still generate.
export async function generateAgentKeywordFiles(
    targets: KeywordSchemaTarget[],
    packageRootDir: string,
): Promise<KeywordGenOutcome> {
    const outcome: KeywordGenOutcome = { generated: [], errors: [] };
    // LLM distillation is the preferred producer (design §6.1); an action the
    // model can't produce falls back to the lexical floor inside the helper.
    const createModel = (_name: string) => getKeywordGenModel();

    for (const target of targets) {
        try {
            const result = await generateKeywordFileForSchemaSource({
                schemaName: target.schemaName,
                schemaSourcePath: target.schemaSourcePath,
                entryTypeName: target.entryTypeName,
                schemaDescription: target.schemaDescription,
                createModel,
            });
            outcome.generated.push({
                schemaName: result.schemaName,
                relPath: path.relative(packageRootDir, result.keywordFilePath),
                actionCount: result.actionCount,
                distilled: result.distilled,
                lexical: result.lexical,
                generatedBy: result.generatedBy,
            });
        } catch (e) {
            outcome.errors.push({
                schemaName: target.schemaName,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return outcome;
}
