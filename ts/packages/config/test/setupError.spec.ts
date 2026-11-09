// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConfigSetupError,
    configSetupError,
    getErrorMarkdown,
} from "../src/setupError.js";

describe("configSetupError", () => {
    test("keeps the summary plain and puts the hint in markdown", () => {
        const e = configSetupError("Spotify is not configured.", [
            "SPOTIFY_APP_CLI",
        ]);
        expect(e).toBeInstanceOf(ConfigSetupError);
        expect(e.message).toBe("Spotify is not configured.");
        expect(e.message).not.toContain("```");
        expect(e.markdown).toContain("Spotify is not configured.");
        expect(e.markdown).toContain("```yaml");
        expect(e.markdown).toContain("clientId");
    });

    test("includes the agent-specific note", () => {
        const e = configSetupError(
            "Spotify is not configured.",
            ["SPOTIFY_APP_CLI"],
            "Values come from the developer dashboard.",
        );
        expect(e.markdown).toContain(
            "Values come from the developer dashboard.",
        );
    });
});

describe("getErrorMarkdown", () => {
    test("reads markdown off any error-shaped value", () => {
        expect(
            getErrorMarkdown(configSetupError("x", ["OPENAI_API_KEY"])),
        ).toContain("```yaml");
        // Errors are rebuilt on the far side of the agent RPC boundary, so
        // the property matters, not the class.
        const rebuilt: Error & { markdown?: string } = new Error("x");
        rebuilt.markdown = "**x**";
        expect(getErrorMarkdown(rebuilt)).toBe("**x**");
    });

    test("returns undefined without usable markdown", () => {
        expect(getErrorMarkdown(new Error("plain"))).toBeUndefined();
        expect(getErrorMarkdown(undefined)).toBeUndefined();
        expect(getErrorMarkdown({ markdown: "" })).toBeUndefined();
        expect(getErrorMarkdown({ markdown: 42 })).toBeUndefined();
    });
});
