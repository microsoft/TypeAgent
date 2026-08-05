// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * User-facing setup hints.
 *
 * Configuration now lives in `config.local.yaml`; the flat `KEY=value`
 * env vars are the legacy (still supported) form that the YAML flattens
 * into. Code that detects missing configuration therefore knows the env
 * var name, but the user needs the YAML key. This module owns that
 * translation plus the phrasing of the "here is what to add" message so
 * every agent says the same thing.
 *
 * `hints.spec.ts` verifies each mapping by flattening the YAML path and
 * checking it produces the mapped env var, so the table cannot drift
 * away from the real converter in `runtime/tree.ts`.
 */

/** Where users put their own settings. */
export const CONFIG_LOCAL_FILE = "ts/config.local.yaml";

/** Fully commented example of every supported section. */
export const CONFIG_SAMPLE_FILE = "ts/config.sample.yaml";

/**
 * Legacy env var name -> dotted path in the YAML config tree.
 *
 * Only the vars that appear in user-facing setup messages are listed;
 * anything missing falls back to the `env:` passthrough block, which is
 * the correct YAML form for a var the typed schema doesn't model.
 */
const CONFIG_PATH_BY_ENV_VAR: Readonly<Record<string, string>> = {
    // Spotify (player agent).
    SPOTIFY_APP_CLI: "spotify.clientId",
    SPOTIFY_APP_CLISEC: "spotify.clientSecret",
    SPOTIFY_APP_PORT: "spotify.port",

    // Microsoft Graph (calendar / email agents).
    MSGRAPH_APP_CLIENTID: "msGraph.clientId",
    MSGRAPH_APP_CLIENTSECRET: "msGraph.clientSecret",
    MSGRAPH_APP_TENANTID: "msGraph.tenantId",
    MSGRAPH_APP_USERNAME: "msGraph.username",
    MSGRAPH_APP_PASSWD: "msGraph.password",

    // Google (calendar / email agents).
    GOOGLE_CALENDAR_CLIENT_ID: "googleCalendar.clientId",
    GOOGLE_CALENDAR_CLIENT_SECRET: "googleCalendar.clientSecret",

    // Speech (shell voice input).
    SPEECH_SDK_KEY: "speech.auth",
    SPEECH_SDK_REGION: "speech.region",
    SPEECH_SDK_ENDPOINT: "speech.endpoint",

    // Azure Maps.
    AZURE_MAPS_CLIENTID: "maps.clientId",
    AZURE_MAPS_ENDPOINT: "maps.endpoint",

    // Telemetry / session storage backends.
    COSMOSDB_CONNECTION_STRING: "storage.database.cosmosDbConnectionString",
    MONGODB_CONNECTION_STRING: "storage.database.mongoDbConnectionString",
};

/**
 * A setting to mention in a hint: either the bare env var name, or the
 * name plus the placeholder to show as its YAML value.
 */
export type ConfigHintVar = string | { envVar: string; placeholder?: string };

/**
 * The YAML key path for a legacy env var, or `undefined` when the typed
 * schema doesn't model it (in which case it belongs under `env:`).
 */
export function configPathForEnvVar(envVar: string): string | undefined {
    return CONFIG_PATH_BY_ENV_VAR[envVar];
}

function normalize(v: ConfigHintVar): { envVar: string; placeholder: string } {
    return typeof v === "string"
        ? { envVar: v, placeholder: "<value>" }
        : { envVar: v.envVar, placeholder: v.placeholder ?? "<value>" };
}

type Node = Map<string, Node | string>;

function insert(root: Node, segments: string[], value: string): void {
    let node = root;
    for (const segment of segments.slice(0, -1)) {
        const existing = node.get(segment);
        if (existing instanceof Map) {
            node = existing;
        } else {
            const child: Node = new Map();
            node.set(segment, child);
            node = child;
        }
    }
    node.set(segments[segments.length - 1], value);
}

function render(node: Node, indent: number, out: string[]): void {
    const pad = " ".repeat(indent);
    for (const [key, value] of node) {
        if (value instanceof Map) {
            out.push(`${pad}${key}:`);
            render(value, indent + 2, out);
        } else {
            out.push(`${pad}${key}: ${value}`);
        }
    }
}

/**
 * Render the YAML the user should add for the given settings. Vars the
 * typed schema knows go under their section; the rest are grouped in the
 * `env:` passthrough block (which `flatten()` copies verbatim into the
 * flat env namespace).
 */
export function configYamlSnippet(vars: ConfigHintVar[]): string {
    const root: Node = new Map();
    for (const v of vars) {
        const { envVar, placeholder } = normalize(v);
        const configPath = configPathForEnvVar(envVar);
        insert(
            root,
            configPath !== undefined ? configPath.split(".") : ["env", envVar],
            placeholder,
        );
    }
    const out: string[] = [];
    render(root, 0, out);
    return out.join("\n");
}

/**
 * Full "how to configure this" blurb: the YAML to add, where to add it,
 * and an optional agent-specific note (where to obtain the values, which
 * command to run afterwards, ...).
 */
export function configSetupHint(vars: ConfigHintVar[], note?: string): string {
    const lines = [
        `Add to \`${CONFIG_LOCAL_FILE}\` (see \`${CONFIG_SAMPLE_FILE}\` for the full format):`,
        "",
        "```yaml",
        configYamlSnippet(vars),
        "```",
    ];
    if (note) {
        lines.push("", note);
    }
    return lines.join("\n");
}

/**
 * The YAML keys for the given env vars, for inline use in a one-line
 * message ("missing: spotify.clientId, spotify.clientSecret"). Unmapped
 * vars keep their env var name.
 */
export function configKeyNames(vars: ConfigHintVar[]): string[] {
    return vars.map((v) => {
        const { envVar } = normalize(v);
        return configPathForEnvVar(envVar) ?? envVar;
    });
}
