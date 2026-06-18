// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import crypto from "node:crypto";
import { ParamSpec } from "@typeagent/action-schema";
import { ExecutableAction, FullAction } from "./requestAction.js";

export type ParamRange = {
    min: string;
    max: string;
    step: string;
    convertToInt?: boolean;
};

export function getParamRange(spec: ParamSpec): ParamRange | undefined {
    switch (spec) {
        case "ordinal":
            return { min: "1", max: "50", step: "1", convertToInt: true };
        case "percentage":
            return { min: "0", max: "50", step: "1", convertToInt: true };
        case "time":
            return { min: "12:00", max: "11:45", step: "00:15" };
    }
}

export function doCacheAction(
    action: ExecutableAction,
    schemaInfoProvider?: SchemaInfoProvider,
) {
    return schemaInfoProvider?.getActionCacheEnabled(
        action.action.schemaName,
        action.action.actionName,
    );
}

export function getParamSpec(
    action: FullAction,
    paramName: string,
    schemaInfoProvider?: SchemaInfoProvider,
): ParamSpec | undefined {
    return schemaInfoProvider?.getActionParamSpec(
        action.schemaName,
        action.actionName,
        paramName,
    );
}

export function getNamespaceForCache(
    schemaName: string,
    actionName: string,
    schemaInfoProvider?: SchemaInfoProvider,
): string {
    if (schemaInfoProvider?.getActionNamespace(schemaName) === true) {
        // REVIEW: this requires that subtranslator name doesn't conflict with actionName
        return `${schemaName}.${actionName}`;
    }

    return schemaName;
}

/**
 * Compute the schema-file hash that keys a schema's construction-cache
 * namespace (`${schemaName},${hash}`). A construction only matches while this
 * hash still equals the current schema's (see {@link isValidActionSchemaFileHash}),
 * so editing or rebuilding a schema invalidates its cached constructions.
 *
 * The hash digests, in order, the JSON-serialized schema type, the schema
 * source, and the optional sidecar paramSpec config (omitted when falsy, e.g.
 * built `.pas.json` schemas that carry no sidecar). This is the single source of
 * truth for the hash; producers (the dispatcher's schema cache) and consumers
 * (cache-namespace validation, replay tooling) must share it so the namespace
 * key stays consistent.
 */
export function computeActionSchemaFileHash(
    schemaType: unknown,
    source: string,
    config?: string,
): string {
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(schemaType));
    hash.update(source);
    if (config) {
        hash.update(config);
    }
    return hash.digest("base64");
}

export function isValidActionSchemaFileHash(
    provider: SchemaInfoProvider,
    schemaName: string,
    hash: string | undefined,
) {
    if (hash === undefined) {
        return false;
    }

    try {
        const fileHash = provider.getActionSchemaFileHash(schemaName);
        return fileHash === hash;
    } catch {
        // Schema not found
        return false;
    }
}

export type SchemaInfoProvider = {
    // Throws if schemaName or actionName not found
    getActionParamSpec: (
        schemaName: string,
        actionName: string,
        paramName: string,
    ) => ParamSpec | undefined;

    // Throws if schemaName or actionName not found
    getActionCacheEnabled: (schemaName: string, actionName: string) => boolean;

    // Throws if schemaName not found
    getActionNamespace: (schemaName: string) => boolean | undefined; // default to false

    // Throws if schemaName not found
    getActionSchemaFileHash: (schemaName: string) => string;
};
