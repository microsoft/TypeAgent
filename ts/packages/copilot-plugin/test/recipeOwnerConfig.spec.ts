// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getConfigPath,
    getRecipeOwner,
    writeConfig,
} from "../src/shared/plugin-config.js";
import { recipeOwnerSetting } from "../src/shared/recipe-owner-command.js";

describe("sole recipe owner configuration", () => {
    let directory: string;
    const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
    const originalOwner = process.env.TYPEAGENT_RECIPE_OWNER;
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "recipe-owner-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_RECIPE_OWNER;
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        if (originalData === undefined)
            delete process.env.TYPEAGENT_PLUGIN_DATA;
        else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
        if (originalOwner === undefined)
            delete process.env.TYPEAGENT_RECIPE_OWNER;
        else process.env.TYPEAGENT_RECIPE_OWNER = originalOwner;
    });
    it("defaults to plugin without a config file or setting", () => {
        expect(getRecipeOwner()).toBe("plugin");
        writeConfig({ mode: "direct" });
        expect(getRecipeOwner()).toBe("plugin");
    });
    it.each(["plugin", "off"] as const)(
        "supports explicit %s and environment precedence",
        (owner) => {
            writeConfig({ mode: "direct", recipeOwner: owner });
            expect(getRecipeOwner()).toBe(owner);
            process.env.TYPEAGENT_RECIPE_OWNER =
                owner === "plugin" ? "off" : "plugin";
            expect(getRecipeOwner()).toBe(process.env.TYPEAGENT_RECIPE_OWNER);
            expect(() => recipeOwnerSetting(owner)).toThrow("overrides");
        },
    );
    it.each(["typeagent", "unknown", ""])(
        "rejects obsolete/invalid owner %s in config and environment",
        (owner) => {
            writeFileSync(
                getConfigPath(),
                JSON.stringify({ mode: "direct", recipeOwner: owner }),
            );
            expect(() => getRecipeOwner()).toThrow(
                owner === "typeagent" ? "removed" : "plugin or off",
            );
            process.env.TYPEAGENT_RECIPE_OWNER = owner;
            expect(() => getRecipeOwner()).toThrow();
            delete process.env.TYPEAGENT_RECIPE_OWNER;
            expect(() =>
                recipeOwnerSetting(owner === "" ? "unknown" : owner),
            ).toThrow();
        },
    );
    it("does not silently select a new catalog for malformed configuration", () => {
        writeFileSync(getConfigPath(), "{broken");
        expect(() => getRecipeOwner()).toThrow(
            "Unable to read plugin configuration",
        );
    });
    it.each([null, [], false, "old"])(
        "rejects a non-object configuration %p",
        (value) => {
            writeFileSync(getConfigPath(), JSON.stringify(value));
            expect(() => getRecipeOwner()).toThrow("must be a JSON object");
        },
    );
    it("rejects an explicit null owner instead of treating it as absent", () => {
        writeFileSync(getConfigPath(), JSON.stringify({ recipeOwner: null }));
        expect(() => getRecipeOwner()).toThrow("plugin or off");
    });
    it("retains disable without rollback instructions", () => {
        expect(recipeOwnerSetting("off")).toContain("Recipe owner: off.");
        expect(recipeOwnerSetting("plugin")).toContain(
            "never selects another owner",
        );
        expect(getRecipeOwner()).toBe("plugin");
    });
});
