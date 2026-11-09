// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileRecipeProgram } from "@typeagent/copilot-macros/recipeCompiler";
import { recipeDigest } from "@typeagent/copilot-macros/recipeCore";

describe("recipe program compiler", () => {
    it("checks TypeScript and emits deterministic checked JavaScript", () => {
        const source = `async function execute(api, params: { title: string }) {
            const result: JsonValue = await api.tools.call("read", params);
            return result;
        }`;
        const first = compileRecipeProgram(source);
        expect(first).toEqual(compileRecipeProgram(source));
        expect(first.text).not.toContain(": JsonValue");
        expect(first.sourceDigest).toBe(recipeDigest(source));
        expect(first.digest).toBe(recipeDigest(first.text));
        expect(first.compiler.name).toBe("typescript");
    });

    it("keeps recipe diagnostics and declarations isolated across warm compilations", () => {
        const valid = `async function execute(api, params) {
            const value: Map<string, number> = new Map();
            value.set("entry", 1);
            return value.get("entry") ?? 0;
        }`;
        const cold = compileRecipeProgram(valid);
        expect(() =>
            compileRecipeProgram(`async function execute(api, params) {
            return value;
        }`),
        ).toThrow("Cannot find name 'value'");
        expect(() =>
            compileRecipeProgram(`async function execute(api, params) {
            const value: Map<string, number> = new Map();
            value.set("entry", "wrong");
            return null;
        }`),
        ).toThrow();
        expect(compileRecipeProgram(valid)).toEqual(cold);
    });

    it.each([
        `async function execute(api, params) { const value: number = "wrong"; return value; }`,
        `async function execute(api, params) { return api.tools.missing("read", null); }`,
        `async function execute(api, params) { return undefined; }`,
        `async function execute(api, params) { return api.tools.call(42, params); }`,
        `async function execute(api, params) { return missingName; }`,
        `async function execute(api, params: Date) { return null; }`,
        `function execute(api, params) { return null; }`,
        `export async function execute(api, params) { return null; }`,
        `import fs from "node:fs"; async function execute(api, params) { return null; }`,
        `async function execute(api, params) { return import("node:fs"); }`,
        `async function execute(api, params) { return process.env; }`,
        `async function execute(api, params) { return require("node:fs"); }`,
        `async function execute(api, params) { return fetch("https://example.com"); }`,
        `async function execute(api, params) { return eval("1"); }`,
        `async function execute(api, params) { declare const x: string; return x; }`,
        `async function execute(api, params) { return null; } execute(null, null);`,
    ])("rejects invalid or unsupported source: %s", (source) => {
        expect(() => compileRecipeProgram(source)).toThrow();
    });
});
