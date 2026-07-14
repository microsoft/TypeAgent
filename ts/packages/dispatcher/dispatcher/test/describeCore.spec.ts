// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AgentSchemaInfo } from "@typeagent/dispatcher-types";
import {
    resolveAgent,
    resolveAction,
    renderAgentView,
    renderActionView,
    extractActionParameters,
    renderAmbiguousActionMessage,
    renderAgentNotFoundMessage,
    renderActionNotFoundMessage,
    polishAgentView,
    polishActionView,
} from "../src/context/system/describe/describeCore.js";

function makeAction(name: string, description: string) {
    return { name, description };
}

const spotifySchemaText = `export type PlayAction = {
    actionName: "play";
    parameters: {
        // what to play (track/artist/album/playlist name)
        query: string;
        // target device; defaults to the active device
        deviceName?: string;
    };
};`;

const nestedParamsSchemaText = `export type ConfigureAction = {
    actionName: "configure";
    parameters: {
        // playback tuning
        options: {
            volume: number;
            mute?: boolean;
        };
        // search text
        query: string;
    };
};`;

function makeSpotifyAgent(actionCount: number): AgentSchemaInfo {
    const actions = [
        makeAction("play", "Play a track, album, artist, or playlist"),
        makeAction("pause", "Pause the current playback"),
        makeAction("next", "Skip to the next track"),
    ];
    for (let i = actions.length; i < actionCount; i++) {
        actions.push(makeAction(`action${i}`, `Description ${i}`));
    }
    return {
        name: "spotify",
        emoji: "🎵",
        description: "controls your local Spotify instance and plays music",
        subSchemas: [
            {
                schemaName: "spotify",
                description: "Spotify playback control",
                schemaText: spotifySchemaText,
                actions,
            },
        ],
    };
}

function makeBrowserAgent(): AgentSchemaInfo {
    return {
        name: "browser",
        emoji: "🌐",
        description: "controls the web browser",
        subSchemas: [
            {
                schemaName: "browser",
                description: "General browser control",
                schemaText: undefined,
                actions: [makeAction("openTab", "Open a new tab")],
            },
            {
                schemaName: "browser.crossword",
                description: "Crossword puzzle helper",
                schemaText: undefined,
                actions: [makeAction("solve", "Solve the crossword")],
            },
        ],
    };
}

function makeJukeboxAgent(): AgentSchemaInfo {
    return {
        name: "jukebox",
        emoji: "🎶",
        description: "an alternate music player",
        subSchemas: [
            {
                schemaName: "jukebox",
                description: "Jukebox playback",
                schemaText: undefined,
                actions: [makeAction("play", "Play the jukebox")],
            },
        ],
    };
}

describe("describeCore resolution", () => {
    it("resolves an agent by exact case-insensitive name", () => {
        const schemas = [makeSpotifyAgent(3)];
        const result = resolveAgent(schemas, "SPOTIFY");
        expect(result.kind).toBe("found");
        if (result.kind === "found") {
            expect(result.agent.name).toBe("spotify");
        }
    });

    it("suggests the closest agent name on a near-miss typo", () => {
        const schemas = [makeSpotifyAgent(3)];
        const result = resolveAgent(schemas, "spotfy");
        expect(result.kind).toBe("notFound");
        if (result.kind === "notFound") {
            expect(result.suggestion).toBe("spotify");
        }
    });

    it("does not suggest an unrelated agent name", () => {
        const schemas = [makeSpotifyAgent(3), makeBrowserAgent()];
        const result = resolveAgent(schemas, "calendar");
        expect(result.kind).toBe("notFound");
        if (result.kind === "notFound") {
            expect(result.suggestion).toBeUndefined();
        }
    });

    it("resolves an action scoped to a given agent", () => {
        const schemas = [makeSpotifyAgent(3)];
        const result = resolveAction(schemas, "play", "spotify");
        expect(result.kind).toBe("found");
        if (result.kind === "found") {
            expect(result.match.action.name).toBe("play");
            expect(result.match.subSchema.schemaName).toBe("spotify");
        }
    });

    it("resolves an unqualified action across agents when unambiguous", () => {
        const schemas = [makeSpotifyAgent(3), makeBrowserAgent()];
        const result = resolveAction(schemas, "openTab");
        expect(result.kind).toBe("found");
        if (result.kind === "found") {
            expect(result.match.agent.name).toBe("browser");
        }
    });

    it("reports ambiguity when an unqualified action exists in multiple agents", () => {
        const schemas = [makeSpotifyAgent(3), makeJukeboxAgent()];
        const result = resolveAction(schemas, "play");
        expect(result.kind).toBe("ambiguous");
        if (result.kind === "ambiguous") {
            expect(result.matches).toHaveLength(2);
            expect(result.matches.map((m) => m.agent.name).sort()).toEqual([
                "jukebox",
                "spotify",
            ]);
        }
    });

    it("resolves a dotted schema.action form directly", () => {
        const schemas = [makeBrowserAgent()];
        const result = resolveAction(schemas, "browser.crossword.solve");
        expect(result.kind).toBe("found");
        if (result.kind === "found") {
            expect(result.match.subSchema.schemaName).toBe("browser.crossword");
            expect(result.match.action.name).toBe("solve");
        }
    });

    it("reports not-found with a suggestion for an unresolved action", () => {
        const schemas = [makeSpotifyAgent(3)];
        const result = resolveAction(schemas, "pase", "spotify");
        expect(result.kind).toBe("notFound");
        if (result.kind === "notFound") {
            expect(result.suggestion).toBe("pause");
        }
    });

    it("suggests a close action name for an unresolved dotted schema.action form", () => {
        const schemas = [makeBrowserAgent()];
        const result = resolveAction(schemas, "browser.crossword.solv");
        expect(result.kind).toBe("notFound");
        if (result.kind === "notFound") {
            expect(result.suggestion).toBe("solve");
        }
    });

    it("does not offer a nonsensical suggestion for empty input", () => {
        const schemas = [makeSpotifyAgent(3)];
        const agentResult = resolveAgent(schemas, "");
        expect(agentResult.kind).toBe("notFound");
        if (agentResult.kind === "notFound") {
            expect(agentResult.suggestion).toBeUndefined();
        }
        const actionResult = resolveAction(schemas, "", "spotify");
        expect(actionResult.kind).toBe("notFound");
        if (actionResult.kind === "notFound") {
            expect(actionResult.suggestion).toBeUndefined();
        }
    });
});

describe("describeCore deterministic rendering", () => {
    it("renders the agent summary and a table for a small action set", () => {
        const agent = makeSpotifyAgent(3);
        const isEnabled = () => true;
        const markdown = renderAgentView(agent, false, isEnabled);
        expect(markdown).toContain("The spotify agent");
        expect(markdown).toContain("| Action | What it does |");
        expect(markdown).toContain("| play |");
        expect(markdown).not.toContain("Showing");
    });

    it("truncates to 10 rows with a footer when more than 10 actions exist", () => {
        const agent = makeSpotifyAgent(23);
        const isEnabled = () => true;
        const markdown = renderAgentView(agent, false, isEnabled);
        const rowCount = markdown
            .split("\n")
            .filter(
                (l) =>
                    l.startsWith("| ") &&
                    !l.startsWith("| Action") &&
                    !l.startsWith("| -"),
            ).length;
        expect(rowCount).toBe(10);
        expect(markdown).toContain("Showing 10 of 23 actions");
        expect(markdown).toContain("@describe spotify --all");
    });

    it("renders the full table with `all`, no truncation footer", () => {
        const agent = makeSpotifyAgent(23);
        const isEnabled = () => true;
        const markdown = renderAgentView(agent, true, isEnabled);
        const rowCount = markdown
            .split("\n")
            .filter(
                (l) =>
                    l.startsWith("| ") &&
                    !l.startsWith("| Action") &&
                    !l.startsWith("| -"),
            ).length;
        expect(rowCount).toBe(23);
        expect(markdown).not.toContain("Showing");
    });

    it("adds a Group column only for multi-sub-schema agents", () => {
        const single = renderAgentView(makeSpotifyAgent(3), false, () => true);
        const multi = renderAgentView(makeBrowserAgent(), false, () => true);
        expect(single).not.toContain("Group");
        expect(multi).toContain("| Action | What it does | Group |");
    });

    it("appends an enable hint for a disabled sub-schema", () => {
        const agent = makeBrowserAgent();
        const isEnabled = (schemaName: string) =>
            schemaName !== "browser.crossword";
        const markdown = renderAgentView(agent, false, isEnabled);
        expect(markdown).toContain("browser.crossword is currently disabled");
        expect(markdown).toContain("@config schema browser.crossword");
    });

    it("states plainly when an agent exposes no actions", () => {
        const agent: AgentSchemaInfo = {
            name: "empty",
            emoji: "❔",
            description: "does nothing yet",
            subSchemas: [],
        };
        const markdown = renderAgentView(agent, false, () => true);
        expect(markdown).toContain("no callable actions");
    });

    it("extracts parameters from generated schema text", () => {
        const params = extractActionParameters(spotifySchemaText, "play");
        expect(params).toEqual([
            {
                name: "query",
                type: "string",
                optional: false,
                comment: "what to play (track/artist/album/playlist name)",
            },
            {
                name: "deviceName",
                type: "string",
                optional: true,
                comment: "target device; defaults to the active device",
            },
        ]);
    });

    it("treats a nested object-typed parameter as a single top-level field, not its inner fields", () => {
        const params = extractActionParameters(
            nestedParamsSchemaText,
            "configure",
        );
        expect(params.map((p) => p.name)).toEqual(["options", "query"]);
    });

    it("renders a single action view with its parameters", () => {
        const agent = makeSpotifyAgent(3);
        const markdown = renderActionView({
            agent,
            subSchema: agent.subSchemas[0],
            action: agent.subSchemas[0].actions[0],
        });
        expect(markdown).toContain("spotify.play");
        expect(markdown).toContain("**Parameters**");
        expect(markdown).toContain("`query` (string)");
        expect(markdown).toContain("`deviceName` (string, optional)");
    });

    it("renders a helpful message for an ambiguous action", () => {
        const schemas = [makeSpotifyAgent(3), makeJukeboxAgent()];
        const result = resolveAction(schemas, "play");
        if (result.kind !== "ambiguous") throw new Error("expected ambiguous");
        const message = renderAmbiguousActionMessage(result);
        expect(message).toContain("spotify");
        expect(message).toContain("jukebox");
    });

    it("renders a not-found message with a suggestion", () => {
        const schemas = [makeSpotifyAgent(3)];
        const agentResult = resolveAgent(schemas, "spotfy");
        if (agentResult.kind !== "notFound")
            throw new Error("expected notFound");
        expect(renderAgentNotFoundMessage(agentResult)).toContain(
            "Did you mean 'spotify'?",
        );

        const actionResult = resolveAction(schemas, "pase", "spotify");
        if (actionResult.kind !== "notFound")
            throw new Error("expected notFound");
        expect(renderActionNotFoundMessage(actionResult)).toContain(
            "Did you mean 'pause'?",
        );
    });
});

describe("describeCore LLM fallback (no model configured)", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Ensure no provider looks configured during this test run.
        for (const key of Object.keys(process.env)) {
            if (/openai|azure/i.test(key)) {
                delete process.env[key];
            }
        }
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("falls back to the deterministic agent summary unchanged", async () => {
        const agent = makeSpotifyAgent(3);
        const deterministic = renderAgentView(agent, false, () => true);
        const result = await polishAgentView(agent, deterministic);
        expect(result).toBe(deterministic);
    });

    it("falls back to the deterministic action view unchanged", async () => {
        const agent = makeSpotifyAgent(3);
        const match = {
            agent,
            subSchema: agent.subSchemas[0],
            action: agent.subSchemas[0].actions[0],
        };
        const deterministic = renderActionView(match);
        const result = await polishActionView(match, deterministic);
        expect(result).toBe(deterministic);
    });
});
