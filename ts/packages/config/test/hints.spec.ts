// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "js-yaml";
import { flatten } from "../src/flatten.js";
import {
    CONFIG_LOCAL_FILE,
    configKeyNames,
    configPathForEnvVar,
    configSetupHint,
    configYamlSnippet,
} from "../src/hints.js";

// Every env var the hint table claims to know, paired with the YAML path
// it maps to. The first test flattens each path and asserts it really
// produces that env var, so the table can't drift from tree.ts.
const MAPPED_VARS = [
    "SPOTIFY_APP_CLI",
    "SPOTIFY_APP_CLISEC",
    "SPOTIFY_APP_PORT",
    "MSGRAPH_APP_CLIENTID",
    "MSGRAPH_APP_CLIENTSECRET",
    "MSGRAPH_APP_TENANTID",
    "MSGRAPH_APP_USERNAME",
    "MSGRAPH_APP_PASSWD",
    "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "SPEECH_SDK_KEY",
    "SPEECH_SDK_REGION",
    "SPEECH_SDK_ENDPOINT",
    "AZURE_MAPS_CLIENTID",
    "AZURE_MAPS_ENDPOINT",
    "COSMOSDB_CONNECTION_STRING",
    "MONGODB_CONNECTION_STRING",
];

// spotify.port is typed as a number; everything else is a string.
function sampleValue(configPath: string): string | number {
    return configPath === "spotify.port" ? 9999 : "probe-value";
}

function treeFor(configPath: string): any {
    const segments = configPath.split(".");
    let node: any = sampleValue(configPath);
    for (const segment of segments.reverse()) {
        node = { [segment]: node };
    }
    return node;
}

describe("configPathForEnvVar", () => {
    test.each(MAPPED_VARS)(
        "%s maps to a YAML path that flattens back to it",
        (envVar) => {
            const configPath = configPathForEnvVar(envVar);
            expect(configPath).toBeDefined();
            const flat = flatten(treeFor(configPath!));
            expect(Object.keys(flat)).toContain(envVar);
            expect(flat[envVar]).toBe(String(sampleValue(configPath!)));
        },
    );

    test("returns undefined for a var the typed schema doesn't model", () => {
        expect(configPathForEnvVar("DISCORD_BOT_TOKEN")).toBeUndefined();
    });
});

describe("configYamlSnippet", () => {
    test("groups mapped vars under their section", () => {
        expect(
            configYamlSnippet([
                "SPOTIFY_APP_CLI",
                "SPOTIFY_APP_CLISEC",
                "SPOTIFY_APP_PORT",
            ]),
        ).toBe(
            [
                "spotify:",
                "  clientId: <value>",
                "  clientSecret: <value>",
                "  port: <value>",
            ].join("\n"),
        );
    });

    test("uses per-var placeholders when given", () => {
        expect(
            configYamlSnippet([
                { envVar: "SPOTIFY_APP_PORT", placeholder: "9999" },
            ]),
        ).toBe(["spotify:", "  port: 9999"].join("\n"));
    });

    test("falls back to the env: passthrough block for unmapped vars", () => {
        expect(configYamlSnippet(["DISCORD_BOT_TOKEN"])).toBe(
            ["env:", "  DISCORD_BOT_TOKEN: <value>"].join("\n"),
        );
    });

    test("emits multiple sections in first-seen order", () => {
        expect(
            configYamlSnippet([
                "MSGRAPH_APP_CLIENTID",
                "GOOGLE_CALENDAR_CLIENT_ID",
                "MSGRAPH_APP_TENANTID",
            ]),
        ).toBe(
            [
                "msGraph:",
                "  clientId: <value>",
                "  tenantId: <value>",
                "googleCalendar:",
                "  clientId: <value>",
            ].join("\n"),
        );
    });

    test("snippets are valid input for flatten()", () => {
        // The snippet is what we tell users to paste, so it must round-trip
        // through the real loader path.
        const snippet = configYamlSnippet([
            { envVar: "SPOTIFY_APP_CLI", placeholder: "id" },
            { envVar: "SPOTIFY_APP_CLISEC", placeholder: "secret" },
            { envVar: "SPOTIFY_APP_PORT", placeholder: "9999" },
            { envVar: "DISCORD_BOT_TOKEN", placeholder: "token" },
        ]);
        // Parse the snippet the same way the loader parses config.local.yaml.
        const flat = flatten(yaml.load(snippet) as any);
        expect(flat.SPOTIFY_APP_CLI).toBe("id");
        expect(flat.SPOTIFY_APP_CLISEC).toBe("secret");
        expect(flat.SPOTIFY_APP_PORT).toBe("9999");
        expect(flat.DISCORD_BOT_TOKEN).toBe("token");
    });
});

describe("configSetupHint", () => {
    test("names the local config file and fences the snippet", () => {
        const hint = configSetupHint(["SPOTIFY_APP_CLI"], "Then do the thing.");
        expect(hint).toContain(CONFIG_LOCAL_FILE);
        expect(hint).toContain("```yaml");
        expect(hint).toContain("clientId:");
        expect(hint).toContain("Then do the thing.");
        // The legacy env-var name shouldn't be the headline instruction.
        expect(hint).not.toContain("SPOTIFY_APP_CLI");
    });
});

describe("configKeyNames", () => {
    test("maps to YAML keys, keeping unmapped names as-is", () => {
        expect(
            configKeyNames(["SPOTIFY_APP_CLI", "DISCORD_BOT_TOKEN"]),
        ).toEqual(["spotify.clientId", "DISCORD_BOT_TOKEN"]);
    });
});
