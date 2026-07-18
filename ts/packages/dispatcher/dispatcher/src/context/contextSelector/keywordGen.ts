// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Generate a committed keyword file (§5 "Source 1") for a schema we own the
// SOURCE for - the "onboarding" and "dynamic-generation" moments of the three
// keyword-vector lifecycle moments (design §6.1). This is the I/O orchestrator
// around the I/O-free `produceKeywordFile`: read the schema source, resolve the
// sibling `<schema>.keywords.json` path, parse the actions, reproduce the
// dispatcher's drift hash, produce the vectors (LLM-distilled preferred, lexical
// floor fallback), and write the file.
//
// This is the counterpart to the backfill flow (collisionKeywordHandlers.ts),
// which produces from an already-LOADED ActionConfig. Both share
// `produceKeywordFile`; this module is the "produce from a source file on disk"
// path, so a caller (e.g. the onboarding scaffolder) that has just written a
// schema `.ts` can commit its keyword vectors beside it without loading the
// agent.

import fs from "node:fs";
import { parseActionSchemaSource } from "@typeagent/action-schema";
import { computeActionSchemaFileHash } from "agent-cache";
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
    // The entry action union type, e.g. "FooActions". Used both to locate the
    // action set (parseActionSchemaSource) AND to reproduce the dispatcher's
    // sourceHash (computeActionSchemaFileHash hashes the schema-type NAME string,
    // not the parsed object), so a later refresh pipeline can detect drift.
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

    // Same committable location the read path and backfill agree on (§5).
    const keywordFilePath = keywordFilePathFor(
        schemaSourcePath,
        schemaSourcePath,
    );
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

    // Reproduce the exact hash the dispatcher stamps at load
    // (computeActionSchemaFileHash of the schema-TYPE name string + source),
    // so a committed file's sourceHash matches the live schema for drift
    // detection. Scaffolded agents carry no `<schema>.json` sidecar config.
    const sourceHash = computeActionSchemaFileHash(entryTypeName, source);

    const produced = await produceKeywordFile(
        {
            schemaName,
            schemaDescription,
            sourceHash,
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
