// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Generate a committed keyword file (§5 "Source 1") for a schema we own the
// SOURCE for - the "onboarding" and "dynamic-generation" moments of the three
// keyword-vector lifecycle moments (design §6.1). This is the I/O orchestrator
// around the I/O-free `produceKeywordFile`: read the schema source, resolve the
// sibling `<schema>.keywords.json` path, parse the actions, produce the vectors
// (LLM-distilled preferred, lexical floor fallback), and write the file.
//
// This is the counterpart to the backfill flow (collisionKeywordHandlers.ts),
// which produces from an already-LOADED ActionConfig. Both share
// `produceKeywordFile`; this module is the "produce from a source file on disk"
// path, so a caller (e.g. the onboarding scaffolder) that has just written a
// schema `.ts` can commit its keyword vectors beside it without loading the
// agent.
//
// The committed file carries NO `sourceHash`. A built agent's manifest points
// `schemaFile` at the compiled `.pas.json`, so the dispatcher's load-time drift
// hash is `computeActionSchemaFileHash` over that `.pas.json` blob - which can't
// be reproduced from the `.ts` here, and doesn't even exist yet at scaffold
// time. The live hash is stamped later, from the loaded ActionSchemaFile, by the
// backfill / refresh pass (collisionKeywordHandlers.ts stamps `schemaFile.sourceHash`).
// The read path never requires `sourceHash` (keywordFile.ts), so deferring it is
// transparent to scoring.

import fs from "node:fs";
import { parseActionSchemaSource } from "@typeagent/action-schema";
import { produceKeywordFile } from "./keywordProducer.js";
import {
    keywordFilePathFor,
    writeKeywordFile,
    KeywordFileProducer,
} from "./keywordFile.js";
import { CreateChatModel } from "./keywordDistiller.js";

// Re-exported so a caller reaching this module through the public
// `agent-dispatcher/contextSelector` subpath can type its model factory without
// deep-importing keywordDistiller.
export type { CreateChatModel } from "./keywordDistiller.js";

export type GenerateKeywordFileOptions = {
    // The schema's runtime name. Cosmetic: written to the file's `schema` field
    // (telemetry / `@collision keywords` display). The read path (KeywordIndex)
    // keys off the file PATH + action name, NOT this. Pass the agent name for a
    // main schema, `${agent}.${sub}` for a sub-schema.
    schemaName: string;
    // Absolute path to the schema SOURCE (`.ts`/`.mts`/`.cts`). The keyword file
    // is written as its `<name>.keywords.json` sibling.
    schemaSourcePath: string;
    // The entry action union type, e.g. "FooActions". Locates the action set
    // for parseActionSchemaSource.
    entryTypeName: string;
    // Schema/agent description; feeds keyword distillation with the domain.
    schemaDescription?: string | undefined;
    // When supplied, LLM distillation is the preferred producer; any action it
    // can't produce falls back to the lexical floor. Omit for a deterministic
    // lexical-only run.
    createModel?: CreateChatModel | undefined;
    topN?: number | undefined;
};

export type GenerateKeywordFileResult = {
    keywordFilePath: string;
    schemaName: string;
    actionCount: number;
    distilled: number;
    lexical: number;
    generatedBy: KeywordFileProducer;
};

// Produce and commit the keyword file for one schema source. Throws on inputs
// that can't yield a committed file (a non-absolute / non-`.ts` path, an
// unparseable schema, a schema with no actions, or a write failure) so the
// caller can record the failure per schema. `produceKeywordFile` itself degrades
// gracefully (a per-action LLM failure falls back to the lexical floor), so the
// common path never throws.
export async function generateKeywordFileForSchemaSource(
    options: GenerateKeywordFileOptions,
): Promise<GenerateKeywordFileResult> {
    const {
        schemaName,
        schemaSourcePath,
        entryTypeName,
        schemaDescription,
        createModel,
        topN,
    } = options;

    // Same committable location the read path and backfill agree on (§5). The
    // source we read IS the original `.ts`, so pass it as the original-source
    // argument; there is no separate resolved schema file at scaffold time.
    const keywordFilePath = keywordFilePathFor(schemaSourcePath, undefined);
    if (keywordFilePath === undefined) {
        throw new Error(
            `Cannot place a keyword file beside '${schemaSourcePath}': not an absolute .ts/.mts/.cts source.`,
        );
    }

    const source = fs.readFileSync(schemaSourcePath, "utf8");
    const parsed = parseActionSchemaSource(
        source,
        schemaName,
        entryTypeName,
        schemaSourcePath,
    );
    const actions = parsed.actionSchemas;
    if (actions.size === 0) {
        throw new Error(`Schema '${schemaName}' has no actions to distill.`);
    }

    // No `sourceHash` is stamped here (see the module comment): the built agent's
    // runtime drift hash is over the compiled `.pas.json`, which does not exist
    // at scaffold time. Backfill / refresh stamps the live hash post-build.
    const produced = await produceKeywordFile(
        {
            schemaName,
            schemaDescription,
            actions,
        },
        { createModel, topN },
    );

    let writeError: unknown;
    const written = writeKeywordFile(keywordFilePath, produced.file, (e) => {
        writeError = e;
    });
    if (written === undefined) {
        throw new Error(
            `Failed to write keyword file '${keywordFilePath}': ${writeError}`,
        );
    }

    return {
        keywordFilePath: written,
        schemaName,
        actionCount: actions.size,
        distilled: produced.distilled,
        lexical: produced.lexical,
        generatedBy: produced.file.generatedBy,
    };
}
