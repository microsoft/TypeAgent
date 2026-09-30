// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getActionNamespaceKeys,
    getSchemaNamespaceKeys,
    isSchemaNamespaceKeyValid,
    splitSchemaNamespaceKey,
} from "../src/cache/schemaNamespace.js";
import type { SchemaInfoProvider } from "../src/explanation/schemaInfoProvider.js";

function createProvider(
    schemaHash: string,
    fingerprints: Record<string, string>,
): SchemaInfoProvider {
    return {
        getActionParamSpec: () => undefined,
        getActionCacheEnabled: () => true,
        getActionNamespace: () => false,
        getActionSchemaFileHash: () => schemaHash,
        getActionCacheBinding: (_schemaName, actionName) => {
            const actionFingerprint = fingerprints[actionName];
            return actionFingerprint === undefined
                ? undefined
                : {
                      sourceId: "provider,one",
                      actionFingerprint,
                  };
        },
        getSchemaCacheBinding: () => ({
            sourceId: "provider,one",
            actionFingerprints: fingerprints,
        }),
    };
}

describe("schema namespaces", () => {
    it("uses an action fingerprint for learned dynamic constructions", () => {
        const provider = createProvider("schema-v1", {
            alpha: "alpha-v1",
            beta: "beta-v1",
        });
        const [key] = getActionNamespaceKeys(
            [
                {
                    action: {
                        schemaName: "dynamic",
                        actionName: "alpha",
                    },
                },
            ],
            undefined,
            provider,
        );

        expect(splitSchemaNamespaceKey(key!)).toEqual({
            schemaName: "dynamic",
            hash: undefined,
            activityName: undefined,
            sourceId: "provider,one",
            actionName: "alpha",
            actionFingerprint: "alpha-v1",
        });
        expect(isSchemaNamespaceKeyValid(key!, provider)).toBe(true);
        expect(
            isSchemaNamespaceKeyValid(
                key!,
                createProvider("schema-v2", {
                    alpha: "alpha-v1",
                    beta: "beta-v2",
                }),
            ),
        ).toBe(true);
        expect(
            isSchemaNamespaceKeyValid(
                key!,
                createProvider("schema-v2", {
                    alpha: "alpha-v2",
                    beta: "beta-v1",
                }),
            ),
        ).toBe(false);
    });

    it("includes legacy and action-specific keys while matching", () => {
        const keys = getSchemaNamespaceKeys(
            ["dynamic"],
            undefined,
            createProvider("schema-v1", {
                alpha: "alpha-v1",
                beta: "beta-v1",
            }),
        );

        expect(keys).toHaveLength(3);
        expect(keys).toContain("dynamic,schema-v1,");
        expect(
            keys.map((key) => splitSchemaNamespaceKey(key).actionName),
        ).toEqual(expect.arrayContaining([undefined, "alpha", "beta"]));
    });
});
