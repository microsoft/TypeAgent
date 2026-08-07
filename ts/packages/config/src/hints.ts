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
 */

import { fileLinkHref } from "./fileLink.js";
import { resolveLocalConfigPath } from "./loader.js";
import { simpleConfigMappingForEnvVar } from "./mappings.js";

/** Where users put their own settings. */
export const CONFIG_LOCAL_FILE = "ts/config.local.yaml";
/** Fully commented example of every supported section. */
export const CONFIG_SAMPLE_FILE = "ts/config.sample.yaml";

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
    return simpleConfigMappingForEnvVar(envVar)?.configPath;
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
 * `resolveLocalConfigPath` walks the filesystem, so treat any failure
 * (permissions, exotic install layout) as "no link".
 */
function tryResolveLocalConfigPath(): string | undefined {
    try {
        return resolveLocalConfigPath();
    } catch {
        return undefined;
    }
}

/**
 * Markdown for the `config.local.yaml` reference. When the file's location
 * on this machine can be resolved, it becomes a `typeagent-file:` link the
 * chat hosts open in the user's editor; otherwise it degrades to plain
 * code text.
 */
export function configLocalFileLink(): string {
    const target = fileLinkHref(tryResolveLocalConfigPath());
    return target === undefined
        ? `\`${CONFIG_LOCAL_FILE}\``
        : `[\`${CONFIG_LOCAL_FILE}\`](<${target}>)`;
}

/**
 * Full "how to configure this" blurb: the YAML to add, where to add it,
 * and an optional agent-specific note (where to obtain the values, which
 * command to run afterwards, ...).
 */
export function configSetupHint(vars: ConfigHintVar[], note?: string): string {
    const lines = [
        `Add to ${configLocalFileLink()} (see \`${CONFIG_SAMPLE_FILE}\` for the full format):`,
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
