// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isValidActionSchemaFileHash,
    type SchemaInfoProvider,
} from "../explanation/schemaInfoProvider.js";
import type { ExecutableAction } from "../explanation/requestAction.js";

function encodeNamespacePart(value: string): string {
    return encodeURIComponent(value);
}

function decodeNamespacePart(value: string | undefined): string | undefined {
    return value ? decodeURIComponent(value) : undefined;
}

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
    const keys: string[] = [];
    for (const name of schemaNames) {
        keys.push(
            getSchemaNamespaceKey(name, activityName, schemaInfoProvider),
        );
        const binding = schemaInfoProvider?.getSchemaCacheBinding?.(name);
        if (binding === undefined) {
            continue;
        }
        for (const [actionName, actionFingerprint] of Object.entries(
            binding.actionFingerprints,
        )) {
            keys.push(
                getActionNamespaceKey(
                    name,
                    actionName,
                    activityName,
                    binding.sourceId,
                    actionFingerprint,
                ),
            );
        }
    }
    return keys;
}

export function getActionNamespaceKeys(
    actions: ExecutableAction[],
    activityName: string | undefined,
    schemaInfoProvider: SchemaInfoProvider | undefined,
): string[] {
    const keys = new Set<string>();
    for (const { action } of actions) {
        const binding = schemaInfoProvider?.getActionCacheBinding?.(
            action.schemaName,
            action.actionName,
        );
        keys.add(
            binding === undefined
                ? getSchemaNamespaceKey(
                      action.schemaName,
                      activityName,
                      schemaInfoProvider,
                  )
                : getActionNamespaceKey(
                      action.schemaName,
                      action.actionName,
                      activityName,
                      binding.sourceId,
                      binding.actionFingerprint,
                  ),
        );
    }
    return [...keys].sort();
}

function getActionNamespaceKey(
    schemaName: string,
    actionName: string,
    activityName: string | undefined,
    sourceId: string,
    actionFingerprint: string,
): string {
    return [
        schemaName,
        "",
        activityName ?? "",
        encodeNamespacePart(sourceId),
        encodeNamespacePart(actionName),
        encodeNamespacePart(actionFingerprint),
    ].join(",");
}

export function splitSchemaNamespaceKey(namespaceKey: string): {
    schemaName: string;
    hash: string | undefined;
    activityName: string | undefined;
    sourceId: string | undefined;
    actionName: string | undefined;
    actionFingerprint: string | undefined;
} {
    const [
        schemaName,
        hash,
        activityName,
        sourceId,
        actionName,
        actionFingerprint,
    ] = namespaceKey.split(",");
    return {
        schemaName,
        hash: hash !== "" ? hash : undefined,
        activityName: activityName !== "" ? activityName : undefined,
        sourceId: decodeNamespacePart(sourceId),
        actionName: decodeNamespacePart(actionName),
        actionFingerprint: decodeNamespacePart(actionFingerprint),
    };
}

export function isSchemaNamespaceKeyValid(
    namespaceKey: string,
    schemaInfoProvider: SchemaInfoProvider,
): boolean {
    const { schemaName, hash, sourceId, actionName, actionFingerprint } =
        splitSchemaNamespaceKey(namespaceKey);
    if (
        sourceId !== undefined &&
        actionName !== undefined &&
        actionFingerprint !== undefined
    ) {
        const current = schemaInfoProvider.getActionCacheBinding?.(
            schemaName,
            actionName,
        );
        return (
            current?.sourceId === sourceId &&
            current.actionFingerprint === actionFingerprint
        );
    }
    return isValidActionSchemaFileHash(schemaInfoProvider, schemaName, hash);
}
