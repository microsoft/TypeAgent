// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractCompiledPhrasings } from "../src/phrasings.js";

describe("extractCompiledPhrasings", () => {
    it("prefers authored grammar from the source map over optimized fragments", () => {
        const fileName = "demo.agr";
        const sourceMap = JSON.stringify({
            files: {
                [fileName]:
                    '<Start> = toggle mute -> { actionName: "toggleMute" };',
            },
            rules: { Start: { fileId: fileName, start: 0, end: 64 } },
        });

        const result = extractCompiledPhrasings("[]", sourceMap);

        expect(result.get("toggleMute")).toEqual(["toggle mute"]);
    });

    it("falls back to optimized grammar when no source map is available", () => {
        expect(extractCompiledPhrasings("[]")).toEqual(new Map());
    });
});
