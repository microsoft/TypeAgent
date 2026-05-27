// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionSchemaTypeDefinition,
    ParsedActionSchema,
} from "@typeagent/action-schema";
import { ActionConfig } from "../src/translation/actionConfig.js";
import type {
    ActionConfigProvider,
    ActionSchemaFile,
} from "../src/translation/actionConfigProvider.js";
import { withActionConfigOverride } from "../src/neighborhoods/optimize/actionConfigOverride.js";

function fakeActionDef(name: string): ActionSchemaTypeDefinition {
    // Cast to any: real definitions carry a typed ActionSchemaObject; for
    // the filter test we only care that the entry is keyed by `name` in the
    // map. The filter wrapper doesn't inspect the def itself.
    return { name } as unknown as ActionSchemaTypeDefinition;
}

function fakeActionConfig(schemaName: string): ActionConfig {
    return { schemaName } as unknown as ActionConfig;
}

function fakeSchemaFile(
    schemaName: string,
    actionNames: string[],
): ActionSchemaFile {
    const actionSchemas = new Map<string, ActionSchemaTypeDefinition>();
    for (const n of actionNames) actionSchemas.set(n, fakeActionDef(n));
    const parsedActionSchema = {
        actionSchemas,
    } as unknown as ParsedActionSchema;
    return {
        schemaName,
        sourceHash: `hash:${schemaName}`,
        parsedActionSchema,
    };
}

function makeBase(map: Record<string, string[]>): {
    provider: ActionConfigProvider;
    configs: Record<string, ActionConfig>;
} {
    const configs: Record<string, ActionConfig> = {};
    const schemaFiles: Record<string, ActionSchemaFile> = {};
    for (const [name, actions] of Object.entries(map)) {
        configs[name] = fakeActionConfig(name);
        schemaFiles[name] = fakeSchemaFile(name, actions);
    }
    const provider: ActionConfigProvider = {
        tryGetActionConfig(name) {
            return configs[name];
        },
        getActionConfig(name) {
            const c = configs[name];
            if (!c) throw new Error(`unknown: ${name}`);
            return c;
        },
        getActionConfigs() {
            return Object.values(configs);
        },
        getActionSchemaFileForConfig(config) {
            const f = schemaFiles[config.schemaName];
            if (!f) throw new Error(`no schema for ${config.schemaName}`);
            return f;
        },
    };
    return { provider, configs };
}

describe("withActionConfigOverride", () => {
    it("drops listed actions from getActionSchemaFileForConfig output", () => {
        const { provider } = makeBase({
            player: ["playTrack", "playAlbum", "playPlaylist", "pause", "stop"],
        });
        const wrapped = withActionConfigOverride(provider, {
            player: {
                schemaVersion: 1,
                droppedActions: ["pause", "stop"],
            },
        });
        const config = wrapped.getActionConfig("player");
        const filtered = wrapped.getActionSchemaFileForConfig(config);
        const names = [...filtered.parsedActionSchema.actionSchemas.keys()];
        expect(names.sort()).toEqual(
            ["playAlbum", "playPlaylist", "playTrack"].sort(),
        );
    });

    it("getActionConfigs() returns all configs (schema-level not pruned)", () => {
        const { provider } = makeBase({
            player: ["playTrack", "pause"],
            email: ["send"],
        });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: ["pause"] },
        });
        expect(
            wrapped
                .getActionConfigs()
                .map((c) => c.schemaName)
                .sort(),
        ).toEqual(["email", "player"]);
    });

    it("returns identical ActionSchemaFile when no actions are dropped for a schema", () => {
        const { provider } = makeBase({
            player: ["a", "b"],
            email: ["c", "d"],
        });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: ["a"] },
            // No override for email; should pass through identity.
        });
        const emailConfig = wrapped.getActionConfig("email");
        const filtered = wrapped.getActionSchemaFileForConfig(emailConfig);
        const original = provider.getActionSchemaFileForConfig(emailConfig);
        // Same reference — no wrapping was needed.
        expect(filtered).toBe(original);
    });

    it("returns identical ActionSchemaFile when override lists no actions", () => {
        const { provider } = makeBase({ player: ["a", "b"] });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: [] },
        });
        const config = wrapped.getActionConfig("player");
        const filtered = wrapped.getActionSchemaFileForConfig(config);
        const original = provider.getActionSchemaFileForConfig(config);
        // With no drops, the wrapper short-circuits and passes through.
        expect(filtered).toBe(original);
    });

    it("preserves sourceHash hint for distinct filtered files", () => {
        const { provider } = makeBase({
            player: ["a", "b", "c"],
        });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: ["a"] },
        });
        const config = wrapped.getActionConfig("player");
        const filtered = wrapped.getActionSchemaFileForConfig(config);
        expect(filtered.sourceHash).toMatch(/^hash:player\+drop:a$/);
    });

    it("memoizes filtered ActionSchemaFile per config", () => {
        const { provider } = makeBase({ player: ["a", "b", "c"] });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: ["a"] },
        });
        const config = wrapped.getActionConfig("player");
        const first = wrapped.getActionSchemaFileForConfig(config);
        const second = wrapped.getActionSchemaFileForConfig(config);
        expect(first).toBe(second);
    });

    it("ignores dropped action names that aren't in the schema", () => {
        const { provider } = makeBase({ player: ["a", "b", "c"] });
        const wrapped = withActionConfigOverride(provider, {
            player: { schemaVersion: 1, droppedActions: ["nonexistent"] },
        });
        const config = wrapped.getActionConfig("player");
        const filtered = wrapped.getActionSchemaFileForConfig(config);
        // No actions actually dropped → identity return (short-circuit).
        expect(filtered).toBe(provider.getActionSchemaFileForConfig(config));
    });
});
