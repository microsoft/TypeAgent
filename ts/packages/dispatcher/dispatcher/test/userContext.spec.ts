// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveUserContextFromSchema } from "../src/translation/userContext.js";
import type { AppAgentManager } from "../src/context/appAgentManager.js";

// Minimal AppAgentManager stub — only `getAppAgentDescription` is read by
// the helper. Anything else is irrelevant for this test. We cast through
// `unknown` so the stub satisfies the static type without us having to
// supply the full surface area of AppAgentManager.
function fakeAgents(
    descriptions: Record<string, string | undefined>,
): AppAgentManager {
    const stub = {
        getAppAgentDescription(name: string): string | undefined {
            if (!(name in descriptions)) {
                throw new Error(`Unknown app agent: ${name}`);
            }
            return descriptions[name];
        },
    };
    return stub as unknown as AppAgentManager;
}

describe("resolveUserContextFromSchema", () => {
    it("returns activeApp + description for a top-level schema", () => {
        const agents = fakeAgents({ spotify: "Agent for Spotify" });
        const ctx = resolveUserContextFromSchema("spotify", agents);
        expect(ctx).toEqual({
            activeApp: "spotify",
            activeAppDescription: "Agent for Spotify",
        });
    });

    it("walks sub-schemas up to the top-level app agent", () => {
        const agents = fakeAgents({ code: "Agent for VSCode integration" });
        const ctx = resolveUserContextFromSchema("code.code-debug", agents);
        expect(ctx).toEqual({
            activeApp: "code",
            activeAppDescription: "Agent for VSCode integration",
        });
    });

    it("omits description when the manifest description is missing", () => {
        const agents = fakeAgents({ mystery: undefined });
        const ctx = resolveUserContextFromSchema("mystery", agents);
        expect(ctx).toEqual({ activeApp: "mystery" });
    });

    it("falls back to bare activeApp when the agent is unknown", () => {
        const agents = fakeAgents({});
        const ctx = resolveUserContextFromSchema("ghost", agents);
        // `getAppAgentDescription` throws; the helper must swallow that
        // and still return a usable context.
        expect(ctx).toEqual({ activeApp: "ghost" });
    });
});
