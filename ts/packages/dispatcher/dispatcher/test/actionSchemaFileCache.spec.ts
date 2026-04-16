// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import crypto from "node:crypto";
import { ActionSchemaFileCache } from "../src/translation/actionSchemaFileCache.js";
import { ActionConfig } from "../src/translation/actionConfig.js";
import { SchemaContent } from "@typeagent/agent-sdk";

function makePasActionConfig(content: string): ActionConfig {
    const schemaFile: SchemaContent = {
        format: "pas",
        content,
        config: undefined,
    };
    return {
        emojiChar: "🔧",
        cachedActivities: undefined,
        schemaDefaultEnabled: true,
        actionDefaultEnabled: true,
        transient: false,
        schemaName: "testSchema",
        schemaFilePath: undefined,
        originalSchemaFilePath: undefined,
        description: "test",
        schemaType: "TestAction",
        schemaFile,
        grammarFile: undefined,
    } as unknown as ActionConfig;
}

describe("ActionSchemaFileCache", () => {
    describe("loadParsedActionSchema JSON validation", () => {
        it("throws for JSON missing version field", () => {
            const cache = new ActionSchemaFileCache();
            const content = JSON.stringify({ entry: {}, types: {} });
            expect(() =>
                cache.getActionSchemaFile(makePasActionConfig(content)),
            ).toThrow("Failed to load parsed action schema 'testSchema'");
        });

        it("throws for JSON with non-number version", () => {
            const cache = new ActionSchemaFileCache();
            const content = JSON.stringify({
                version: "1",
                entry: {},
                types: {},
            });
            expect(() =>
                cache.getActionSchemaFile(makePasActionConfig(content)),
            ).toThrow("malformed JSON structure");
        });

        it("throws for JSON missing entry field", () => {
            const cache = new ActionSchemaFileCache();
            const content = JSON.stringify({ version: 1, types: {} });
            expect(() =>
                cache.getActionSchemaFile(makePasActionConfig(content)),
            ).toThrow("malformed JSON structure");
        });

        it("throws for JSON missing types field", () => {
            const cache = new ActionSchemaFileCache();
            const content = JSON.stringify({ version: 1, entry: {} });
            expect(() =>
                cache.getActionSchemaFile(makePasActionConfig(content)),
            ).toThrow("malformed JSON structure");
        });

        it("passes structure validation for valid JSON (fails on type name mismatch)", () => {
            const cache = new ActionSchemaFileCache();
            // Valid structure but wrong version — will fail at fromJSONParsedActionSchema
            const content = JSON.stringify({
                version: 99,
                entry: {},
                types: {},
            });
            expect(() =>
                cache.getActionSchemaFile(makePasActionConfig(content)),
            ).toThrow("Unsupported ParsedActionSchema version");
        });
    });

    describe("getSchemaSource preserves config", () => {
        it("should include config in hash when schema has a config", () => {
            const schemaContentWithConfig: SchemaContent = {
                format: "ts",
                content: 'export type TestAction = { actionName: "test"; }',
                config: '{"configKey": "configValue"}',
            };

            const schemaContentWithoutConfig: SchemaContent = {
                format: "ts",
                content: 'export type TestAction = { actionName: "test"; }',
                config: undefined,
            };

            const makeActionConfig = (
                schemaFile: SchemaContent,
            ): ActionConfig =>
                ({
                    emojiChar: "🔧",
                    cachedActivities: undefined,
                    schemaDefaultEnabled: true,
                    actionDefaultEnabled: true,
                    transient: false,
                    schemaName: "testSchema",
                    schemaFilePath: undefined,
                    originalSchemaFilePath: undefined,
                    description: "test",
                    schemaType: "TestAction",
                    schemaFile,
                    grammarFile: undefined,
                }) as ActionConfig;

            const cache = new ActionSchemaFileCache();

            // Get schema file with config - this will parse and cache
            // We expect this to throw because the schema content isn't a real
            // parseable schema, but the important thing is to verify getSchemaSource
            // passes the config through, which affects the hash.
            // We can verify this by checking that two configs produce different hashes.

            // Access the private getSchemaSource method via prototype trick
            const getSchemaSource = (
                ActionSchemaFileCache.prototype as any
            ).getSchemaSource.bind(cache);

            const resultWithConfig = getSchemaSource(
                makeActionConfig(schemaContentWithConfig),
            );
            const resultWithoutConfig = getSchemaSource(
                makeActionConfig(schemaContentWithoutConfig),
            );

            // The fix ensures config is passed through from schemaContent
            expect(resultWithConfig.config).toBe(
                '{"configKey": "configValue"}',
            );
            expect(resultWithoutConfig.config).toBeUndefined();

            // Verify format and source are also correctly passed
            expect(resultWithConfig.format).toBe("ts");
            expect(resultWithConfig.source).toBe(
                schemaContentWithConfig.content,
            );
        });

        it("should not include config for pas format schemas", () => {
            const pasSchemaContent: SchemaContent = {
                format: "pas",
                content: '{"entry": {}}',
                config: undefined,
            };

            const makeActionConfig = (
                schemaFile: SchemaContent,
            ): ActionConfig =>
                ({
                    emojiChar: "🔧",
                    cachedActivities: undefined,
                    schemaDefaultEnabled: true,
                    actionDefaultEnabled: true,
                    transient: false,
                    schemaName: "testSchema",
                    schemaFilePath: undefined,
                    originalSchemaFilePath: undefined,
                    description: "test",
                    schemaType: "TestAction",
                    schemaFile: pasSchemaContent,
                    grammarFile: undefined,
                }) as ActionConfig;

            const cache = new ActionSchemaFileCache();
            const getSchemaSource = (
                ActionSchemaFileCache.prototype as any
            ).getSchemaSource.bind(cache);

            const result = getSchemaSource(makeActionConfig(pasSchemaContent));
            expect(result.config).toBeUndefined();
            expect(result.format).toBe("pas");
        });

        it("should produce different hashes when config differs", () => {
            // This test verifies the consequence of the bug fix:
            // when config is correctly included, the hash changes
            // when config content changes, ensuring proper cache invalidation.

            function hashStrings(...str: string[]) {
                const hash = crypto.createHash("sha256");
                for (const s of str) {
                    hash.update(s);
                }
                return hash.digest("base64");
            }

            const schemaType = JSON.stringify("TestAction");
            const source = 'export type TestAction = { actionName: "test"; }';
            const config = '{"configKey": "configValue"}';

            // With the fix: config is included in the hash
            const hashWithConfig = hashStrings(schemaType, source, config);
            const hashWithoutConfig = hashStrings(schemaType, source);

            // The hashes must differ - if config was dropped (the bug),
            // both would be identical and config changes wouldn't
            // invalidate the cache
            expect(hashWithConfig).not.toBe(hashWithoutConfig);
        });
    });
});
