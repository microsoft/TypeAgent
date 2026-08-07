// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import yaml from "js-yaml";
import { flatten } from "../src/flatten.js";
import { SIMPLE_CONFIG_MAPPING_LIST } from "../src/mappings.js";
import { buildConfig } from "../src/runtime/build.js";
import { configToEnv } from "../src/runtime/shim.js";
import {
    CONFIG_LOCAL_FILE,
    configKeyNames,
    configPathForEnvVar,
    configSetupHint,
    configYamlSnippet,
} from "../src/hints.js";

function sampleValue(configPath: string): string | number {
    if (configPath === "spotify.port") return 9999;
    if (configPath === "speech.region") return "eastus";
    return "probe-value";
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
    test.each(SIMPLE_CONFIG_MAPPING_LIST)(
        "$envVar maps to a YAML path that flattens back to it",
        ({ envVar, configPath }) => {
            expect(configPathForEnvVar(envVar)).toBe(configPath);
            const flat = flatten(treeFor(configPath));
            expect(flat[envVar]).toBe(String(sampleValue(configPath)));
        },
    );

    test("registry env vars and config paths are unique", () => {
        expect(
            new Set(SIMPLE_CONFIG_MAPPING_LIST.map((entry) => entry.envVar))
                .size,
        ).toBe(SIMPLE_CONFIG_MAPPING_LIST.length);
        expect(
            new Set(SIMPLE_CONFIG_MAPPING_LIST.map((entry) => entry.configPath))
                .size,
        ).toBe(SIMPLE_CONFIG_MAPPING_LIST.length);
    });

    test("all registry entries round-trip through typed runtime config", () => {
        const flat = Object.fromEntries(
            SIMPLE_CONFIG_MAPPING_LIST.map(({ envVar, configPath }) => [
                envVar,
                String(sampleValue(configPath)),
            ]),
        );
        const projected = configToEnv(buildConfig(flat));
        for (const { envVar } of SIMPLE_CONFIG_MAPPING_LIST) {
            expect(projected[envVar]).toBe(flat[envVar]);
        }
    });

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

    test("links the local config file so hosts can open it", () => {
        const hint = configSetupHint(["SPOTIFY_APP_CLI"]);
        // Inside the monorepo the path always resolves, so the reference is
        // a markdown link with the `typeagent-file:` scheme the chat hosts
        // route to "open this file".
        expect(hint).toContain(`[\`${CONFIG_LOCAL_FILE}\`](<typeagent-file:`);
        expect(hint).toContain("config.local.yaml>)");
    });
});

describe("configKeyNames", () => {
    test("maps to YAML keys, keeping unmapped names as-is", () => {
        expect(
            configKeyNames(["SPOTIFY_APP_CLI", "DISCORD_BOT_TOKEN"]),
        ).toEqual(["spotify.clientId", "DISCORD_BOT_TOKEN"]);
    });
});
