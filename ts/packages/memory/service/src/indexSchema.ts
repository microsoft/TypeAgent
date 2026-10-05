// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type IndexKind = "documents" | "conversation-events" | "procedures";

export interface IndexSchema {
    indexSchemaVersion: 1;
    engine: "knowpro";
    indexKind: IndexKind;
}

const schemaFileName = "index-schema.json";
const semanticFileName = "corpus_data.json";

async function hasSemanticData(directory: string): Promise<boolean> {
    const filePath = path.join(directory, semanticFileName);
    let content: string;
    try {
        content = await readFile(filePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw new Error(
            `Cannot read semantic index '${filePath}': ${String(error)}`,
        );
    }
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Malformed semantic index '${filePath}': ${String(error)}`,
        );
    }
    if (
        typeof value !== "object" ||
        value === null ||
        !("messages" in value) ||
        !Array.isArray(value.messages) ||
        value.messages.length === 0 ||
        !("semanticRefs" in value) ||
        !Array.isArray(value.semanticRefs)
    ) {
        throw new Error(`Invalid semantic index '${filePath}'`);
    }
    return true;
}

export async function classifyIndexSchema(
    directory: string,
    indexKind: IndexKind,
    hasDocuments: boolean,
): Promise<"current" | "reset"> {
    const filePath = path.join(directory, schemaFileName);
    let content: string;
    try {
        content = await readFile(filePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return "reset";
        }
        throw new Error(
            `Cannot read index schema '${filePath}': ${String(error)}`,
        );
    }
    let descriptor: unknown;
    try {
        descriptor = JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Malformed index schema '${filePath}': ${String(error)}`,
        );
    }
    if (
        typeof descriptor !== "object" ||
        descriptor === null ||
        !("indexSchemaVersion" in descriptor) ||
        !Number.isInteger(descriptor.indexSchemaVersion) ||
        typeof descriptor.indexSchemaVersion !== "number" ||
        descriptor.indexSchemaVersion < 0
    ) {
        throw new Error(`Invalid index schema '${filePath}'`);
    }
    if (descriptor.indexSchemaVersion > 1) {
        throw new Error(
            `Unsupported future index schema version ${descriptor.indexSchemaVersion} in '${filePath}'`,
        );
    }
    if (descriptor.indexSchemaVersion < 1) {
        return "reset";
    }
    if (
        !("engine" in descriptor) ||
        descriptor.engine !== "knowpro" ||
        !("indexKind" in descriptor) ||
        descriptor.indexKind !== indexKind
    ) {
        throw new Error(`Incompatible index schema '${filePath}'`);
    }
    if (indexKind === "documents") {
        try {
            await stat(path.join(directory, "document-projection.json"));
            return "reset";
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }
    if (hasDocuments && !(await hasSemanticData(directory))) {
        return "reset";
    }
    return "current";
}

export async function stampIndexSchema(
    directory: string,
    indexKind: IndexKind,
    hasDocuments: boolean,
): Promise<void> {
    if (hasDocuments && !(await hasSemanticData(directory))) {
        throw new Error(
            `Missing semantic index '${path.join(directory, semanticFileName)}'`,
        );
    }
    const descriptor: IndexSchema = {
        indexSchemaVersion: 1,
        engine: "knowpro",
        indexKind,
    };
    await writeFile(
        path.join(directory, schemaFileName),
        `${JSON.stringify(descriptor)}\n`,
        "utf8",
    );
}
