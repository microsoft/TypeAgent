// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";

export function getSchemaNamespaceKey(
    name: string,
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
) {
    return `${name},${schemaInfoProvider?.getActionSchemaFileHash(name) ?? ""},${activityName ?? ""}`;
}

// Namespace policy. Combines schema name, file hash, and activity name to indicate enabling/disabling of matching.
export function getSchemaNamespaceKeys(
    schemaNames: string[],
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
) {
    return schemaNames.map((name) =>
        getSchemaNamespaceKey(name, activityName, schemaInfoProvider),
    );
}

export function splitSchemaNamespaceKey(namespaceKey: string): {
    schemaName: string;
    hash: string | undefined;
    activityName: string | undefined;
} {
    const [schemaName, hash, activityName] = namespaceKey.split(",");
    return {
        schemaName,
        hash: hash !== "" ? hash : undefined,
        activityName: activityName !== "" ? activityName : undefined,
    };
}
