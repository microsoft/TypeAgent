// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { parseFlowLLMResponse } from "../src/index.js";

type FakeParam = { name: string; type: string };

const validateFakeParams = (p: unknown): p is FakeParam[] =>
    Array.isArray(p) &&
    p.every(
        (e) =>
            typeof e === "object" &&
            e !== null &&
            typeof (e as any).name === "string" &&
            typeof (e as any).type === "string",
    );

const options = { validateParameters: validateFakeParams };

const defaults: FakeParam[] = [{ name: "p0", type: "string" }];

describe("parseFlowLLMResponse", () => {
    test("parses a ```json fenced wrapper", () => {
        const text = [
            "Sure, here's the flow:",
            "```json",
            JSON.stringify({
                script: "async function execute(ctx){}",
                parameters: [{ name: "x", type: "string" }],
                description: "  a test flow  ",
            }),
            "```",
        ].join("\n");

        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeDefined();
        expect(result!.script).toContain("async function execute");
        expect(result!.parameters).toEqual([{ name: "x", type: "string" }]);
        expect(result!.description).toBe("a test flow");
    });

    test("parses a plain ``` fence whose body is a JSON object", () => {
        const text = [
            "```",
            JSON.stringify({
                script: "async function execute(){}",
                parameters: [],
            }),
            "```",
        ].join("\n");

        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeDefined();
        expect(result!.parameters).toEqual([]);
    });

    test("parses raw {…} slice when no code fences are present", () => {
        const text = `prefix ${JSON.stringify({
            script: "async function execute(){}",
            parameters: [],
        })} suffix`;
        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeDefined();
        expect(result!.script).toContain("async function execute");
    });

    test("bare-script fallback uses caller's defaultParameters", () => {
        const text = [
            "```typescript",
            "async function execute(api, params) { return { success: true }; }",
            "```",
        ].join("\n");

        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeDefined();
        expect(result!.parameters).toBe(defaults);
        expect(result!.script).toContain("async function execute");
    });

    test("bare script that doesn't match a signature is rejected", () => {
        const text = [
            "```typescript",
            "function notAFlow() { return 1; }",
            "```",
        ].join("\n");

        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeUndefined();
    });

    test("malformed JSON in fenced block returns undefined and emits debug", () => {
        const debug = jest.fn();
        const text = "```json\n{ this is not valid json\n```";
        const result = parseFlowLLMResponse(text, defaults, {
            ...options,
            debug,
        });
        expect(result).toBeUndefined();
        expect(debug).toHaveBeenCalled();
    });

    test("missing 'script' field is rejected even when JSON parses", () => {
        const text = `\`\`\`json\n${JSON.stringify({
            parameters: [],
        })}\n\`\`\``;
        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeUndefined();
    });

    test("invalid parameters shape is rejected by caller's validator", () => {
        const text = `\`\`\`json\n${JSON.stringify({
            script: "async function execute(){}",
            parameters: [{ name: "x" }],
        })}\n\`\`\``;
        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeUndefined();
    });

    test("description field is omitted when empty after trim", () => {
        const text = `\`\`\`json\n${JSON.stringify({
            script: "async function execute(){}",
            parameters: [],
            description: "   ",
        })}\n\`\`\``;
        const result = parseFlowLLMResponse(text, defaults, options);
        expect(result).toBeDefined();
        expect(result!.description).toBeUndefined();
    });

    test("custom bareScriptSignatures override the default", () => {
        const text = "```ts\nexport function run() {}\n```";
        const result = parseFlowLLMResponse(text, defaults, {
            ...options,
            bareScriptSignatures: [/function\s+run\s*\(/],
        });
        expect(result).toBeDefined();
        expect(result!.script).toContain("function run");
    });
});
