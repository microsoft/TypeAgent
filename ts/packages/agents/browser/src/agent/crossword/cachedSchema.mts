// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext, Storage } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { Crossword } from "./schema/pageSchema.mjs";
import { BrowserActionContext } from "../actionHandler.mjs";
const debugError = registerDebug("typeagent:browser:crossword:schema:error");
const cacheSchemaFile = `crosswordSchema.json`;

async function readCachedSchemas(
    storage?: Storage,
): Promise<Map<string, Crossword> | undefined> {
    if (!storage) {
        return undefined;
    }
    if (!(await storage.exists(cacheSchemaFile))) {
        return undefined;
    }

    try {
        const cachedSchema = await storage.read(cacheSchemaFile, "utf8");
        return new Map(JSON.parse(cachedSchema) as [string, Crossword][]);
    } catch {
        return undefined;
    }
}
async function ensureCachedSchemas(
    context: SessionContext<BrowserActionContext>,
) {
    const agentContext = context.agentContext;
    if (agentContext.crosswordCachedSchemas === undefined) {
        agentContext.crosswordCachedSchemas =
            (await readCachedSchemas(context.sessionStorage)) ??
            new Map<string, Crossword>();
    }

    return agentContext.crosswordCachedSchemas;
}

export async function getCachedSchema(
    context: SessionContext<BrowserActionContext>,
    url: string,
): Promise<Crossword | undefined> {
    const cachedSchemas = await ensureCachedSchemas(context);
    return cachedSchemas.get(url);
}

async function writeCachedSchemas(
    context: SessionContext<BrowserActionContext>,
): Promise<void> {
    const cachedSchemas = context.agentContext.crosswordCachedSchemas;
    if (cachedSchemas === undefined) {
        return;
    }
    const storage = context.sessionStorage;
    if (storage === undefined) {
        return;
    }

    try {
        await storage.write(
            cacheSchemaFile,
            JSON.stringify([...cachedSchemas.entries()]),
        );
    } catch (e) {
        debugError("Failed to write cached crossword schema.", e);
    }
}
export async function setCachedSchema(
    context: SessionContext<BrowserActionContext>,
    url: string,
    schema: Crossword,
): Promise<void> {
    const cachedSchemas = await ensureCachedSchemas(context);
    cachedSchemas.set(url, schema);
    await writeCachedSchemas(context);
}

export async function deleteCachedSchema(
    context: SessionContext<BrowserActionContext>,
    url: string,
): Promise<void> {
    const cachedSchemas = await ensureCachedSchemas(context);
    cachedSchemas.delete(url);
    await writeCachedSchemas(context);
}

export async function clearCachedSchemas(
    context: SessionContext<BrowserActionContext>,
): Promise<void> {
    const storage = context.sessionStorage;
    if (storage === undefined) {
        return;
    }
    await storage.delete(cacheSchemaFile);
    context.agentContext.crosswordCachedSchemas = undefined;
}
