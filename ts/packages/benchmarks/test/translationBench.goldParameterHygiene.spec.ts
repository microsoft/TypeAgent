// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    isOmittedFromGoldParameter,
    omittedGoldParameterNames,
    stripOmittedGoldParameters,
} from "../src/translationBench/synthesizer/goldParameterHygiene.js";

describe("gold parameter hygiene", () => {
    it("lists and strips omit-from-gold keys without touching other fields", () => {
        expect(
            isOmittedFromGoldParameter("github-cli", "starRepo", "unstar"),
        ).toBe(true);
        expect(omittedGoldParameterNames("github-cli", "starRepo")).toEqual([
            "unstar",
        ]);
        const stripped = stripOmittedGoldParameters("github-cli", "starRepo", {
            repo: "microsoft/TypeScript",
            unstar: false,
        });
        expect(stripped.removed).toEqual(["unstar"]);
        expect(stripped.parameters).toEqual({ repo: "microsoft/TypeScript" });
        const onlyDefault = stripOmittedGoldParameters(
            "github-cli",
            "starRepo",
            { unstar: false },
        );
        expect(onlyDefault.removed).toEqual(["unstar"]);
        expect(onlyDefault.parameters).toBeUndefined();
        const untouched = stripOmittedGoldParameters("list", "removeItems", {
            listName: "groceries",
        });
        expect(untouched.removed).toEqual([]);
        expect(untouched.parameters).toEqual({ listName: "groceries" });
    });
});
