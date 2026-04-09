// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Gap 6: Direct unit tests for spacingModeToSeparatorMode, ensuring each
// CompiledSpacingMode value maps to the correct SeparatorMode.

import { spacingModeToSeparatorMode } from "../src/grammarCompletion.js";
import type { CompiledSpacingMode } from "../src/grammarTypes.js";

describe("spacingModeToSeparatorMode", () => {
    it('maps "required" → "spacePunctuation"', () => {
        expect(spacingModeToSeparatorMode("required")).toBe("spacePunctuation");
    });

    it('maps "optional" → "optionalSpacePunctuation"', () => {
        expect(spacingModeToSeparatorMode("optional")).toBe(
            "optionalSpacePunctuation",
        );
    });

    it('maps "none" → "none"', () => {
        expect(spacingModeToSeparatorMode("none")).toBe("none");
    });

    it('maps undefined (auto) → "autoSpacePunctuation"', () => {
        expect(spacingModeToSeparatorMode(undefined)).toBe(
            "autoSpacePunctuation",
        );
    });

    it("covers all CompiledSpacingMode values exhaustively", () => {
        // Ensure the function handles every possible input without throwing.
        const modes: CompiledSpacingMode[] = [
            "required",
            "optional",
            "none",
            undefined,
        ];
        for (const mode of modes) {
            const result = spacingModeToSeparatorMode(mode);
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }
    });
});
