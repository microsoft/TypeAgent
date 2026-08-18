// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Targeted, comment-preserving editor for the `telemetry.local` block inside
// `config.local.yaml`. Rewrites *only* the local block — anything else in the
// file (comments, unrelated sections, secrets) is preserved verbatim.
//
// Design constraints (see the corresponding node:test spec):
//   - `enabled` is written as the string "true" / "false". The flat env
//     layer used by `@typeagent/config` drops YAML booleans whose value is
//     `false`, so a plain boolean would silently "stick" once enabled.
//   - Defaults are only inserted for keys the user has NOT set; existing
//     `otlpEndpoint` / `logFile` / `debugBridge` / `structuredLogs` values
//     are preserved so a customized local sink survives a toggle.
//   - The document is parsed with js-yaml before and after the edit. If
//     either parse fails, or if `telemetry` / `telemetry.local` uses an
//     ambiguous / unsupported shape (flow style, sequence, scalar, custom
//     tag), the helper throws instead of rewriting.

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

/**
 * Default values written by `pnpm run telemetry:grafana` when the user has
 * not customized the corresponding key. Kept in sync with the resolver's
 * `telemetry.local` defaults in `packages/telemetry/src/otel/config.ts`.
 */
export const LOCAL_DEFAULTS = Object.freeze({
    otlpEndpoint: "http://localhost:4318",
    logFile: "~/.typeagent/logs/{process}-{timestamp}-p{pid}.jsonl",
    debugBridge: "true",
    structuredLogs: "true",
});

/**
 * Resolve the path to `config.local.yaml` using the same precedence as
 * `getKeys.mjs`, so a script toggle and a Key Vault sync target the same
 * file on any machine:
 *   TYPEAGENT_CONFIG_LOCAL
 *   > <TYPEAGENT_CONFIG_DIR>/config.local.yaml
 *   > <workspaceTsRoot>/config.local.yaml
 */
export function resolveLocalConfigPath(workspaceTsRoot) {
    return (
        process.env.TYPEAGENT_CONFIG_LOCAL ??
        (process.env.TYPEAGENT_CONFIG_DIR
            ? path.join(process.env.TYPEAGENT_CONFIG_DIR, "config.local.yaml")
            : path.resolve(workspaceTsRoot, "config.local.yaml"))
    );
}

/**
 * Enable the local telemetry sink in `config.local.yaml`. Writes the file
 * only when its content actually changes.
 */
export function enableTelemetryLocal(filePath) {
    return applyTelemetryLocalEdit(filePath, true);
}

/**
 * Disable the local telemetry sink in `config.local.yaml`. Preserves any
 * customized local defaults so re-enabling does not lose them.
 */
export function disableTelemetryLocal(filePath) {
    return applyTelemetryLocalEdit(filePath, false);
}

function applyTelemetryLocalEdit(filePath, enable) {
    const originalText = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, "utf8")
        : "";
    const parsed = safeParseYaml(originalText, filePath);
    validateTelemetryLocalShape(parsed, filePath);

    const existingLocal = getExistingLocal(parsed);
    const previouslyEnabled = existingLocal?.enabled === "true";

    const desiredLocal = buildDesiredLocal(existingLocal, enable);
    const newText = rewriteTelemetryLocalBlock(originalText, desiredLocal);

    // Re-parse to guarantee we did not corrupt the document. If it fails,
    // do not touch the file — surface the parse error so the user can fix it.
    const reparsed = safeParseYaml(newText, `${filePath} (edited in memory)`);
    const reparsedLocal = getExistingLocal(reparsed);
    if (
        reparsedLocal === undefined ||
        reparsedLocal.enabled !== desiredLocal.enabled
    ) {
        throw new Error(
            `Refusing to write ${filePath}: the edited document did not round-trip to the expected telemetry.local shape.`,
        );
    }

    if (newText === originalText) {
        return { path: filePath, changed: false, previouslyEnabled };
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, newText, "utf8");
    return { path: filePath, changed: true, previouslyEnabled };
}

function safeParseYaml(text, source) {
    if (text.trim() === "") {
        return {};
    }
    try {
        const parsed = yaml.load(text, { filename: source });
        if (parsed === null || parsed === undefined) {
            return {};
        }
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(
                `Top-level YAML value in ${source} must be a map; got ${Array.isArray(parsed) ? "sequence" : typeof parsed}.`,
            );
        }
        return parsed;
    } catch (error) {
        throw new Error(
            `Failed to parse ${source} as YAML: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

function validateTelemetryLocalShape(parsed, source) {
    if (!("telemetry" in parsed)) {
        return;
    }
    const telemetry = parsed.telemetry;
    if (telemetry === null || telemetry === undefined) {
        return;
    }
    if (typeof telemetry !== "object" || Array.isArray(telemetry)) {
        throw new Error(
            `Refusing to edit ${source}: telemetry must be a map; got ${Array.isArray(telemetry) ? "sequence" : typeof telemetry}.`,
        );
    }
    if (!("local" in telemetry)) {
        return;
    }
    const local = telemetry.local;
    if (local === null || local === undefined) {
        return;
    }
    if (typeof local !== "object" || Array.isArray(local)) {
        throw new Error(
            `Refusing to edit ${source}: telemetry.local must be a map; got ${Array.isArray(local) ? "sequence" : typeof local}.`,
        );
    }
}

function getExistingLocal(parsed) {
    const telemetry = parsed?.telemetry;
    if (
        telemetry === undefined ||
        telemetry === null ||
        typeof telemetry !== "object" ||
        Array.isArray(telemetry)
    ) {
        return undefined;
    }
    const local = telemetry.local;
    if (
        local === undefined ||
        local === null ||
        typeof local !== "object" ||
        Array.isArray(local)
    ) {
        return undefined;
    }
    return local;
}

function buildDesiredLocal(existingLocal, enable) {
    const merged = { ...LOCAL_DEFAULTS, ...(existingLocal ?? {}) };
    merged.enabled = enable ? "true" : "false";
    for (const key of ["debugBridge", "structuredLogs"]) {
        if (typeof merged[key] === "boolean") {
            merged[key] = merged[key] ? "true" : "false";
        }
    }
    return merged;
}

/**
 * Rewrite (or insert) the `telemetry.local:` block in `text`. Existing key
 * lines and comments are preserved; only managed scalar values are changed,
 * and missing defaults are appended.
 */
function rewriteTelemetryLocalBlock(text, desiredLocal) {
    const eol = detectEol(text);
    const lines = text.length === 0 ? [] : text.split(/\r?\n/);
    // If the file ended with a trailing newline, `split` leaves an empty
    // string at the end; drop it so line indexing lines up with what the
    // user sees. We always end the rewritten document with a trailing EOL
    // to match the repo convention (see `getKeys.mjs`, `yamlConfigMerge`).
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }

    const telemetryIndex = findTopLevelKeyLine(lines, "telemetry");
    if (telemetryIndex === -1) {
        // Fresh document (empty file, or one with no telemetry section):
        // append a self-terminated block using the repo's two-space
        // convention. A blank spacer line is inserted only when the file
        // has trailing non-blank content.
        const bodyIndent = "    ";
        const keyIndent = "  ";
        const rendered = renderTelemetryLocalBody(
            desiredLocal,
            bodyIndent,
            eol,
        );
        const appendix = `telemetry:${eol}${keyIndent}local:${eol}${rendered}`;
        if (lines.length === 0) {
            return appendix;
        }
        const existing = joinLines(lines, eol) + eol;
        const needsBlank = lines[lines.length - 1].trim() !== "";
        return existing + (needsBlank ? eol : "") + appendix;
    }

    assertBlockMappingOpener(lines[telemetryIndex], "telemetry");
    const telemetryBlockEnd = findBlockEnd(lines, telemetryIndex + 1);

    const telemetryChildIndent =
        detectChildIndent(lines, telemetryIndex + 1, telemetryBlockEnd) ??
        "  ";
    if (
        telemetryChildIndent.length === 0 ||
        telemetryChildIndent.trim() !== ""
    ) {
        throw new Error(
            "Refusing to edit config.local.yaml: telemetry child indent is not pure spaces.",
        );
    }

    const localKeyIndex = findChildKeyLine(
        lines,
        telemetryIndex + 1,
        telemetryBlockEnd,
        telemetryChildIndent,
        "local",
    );

    if (localKeyIndex === -1) {
        // `telemetry:` exists but has no `local:` child. Insert a fresh
        // block at the end of the telemetry block, using its child indent.
        const bodyIndent = `${telemetryChildIndent}${telemetryChildIndent}`;
        const rendered = renderTelemetryLocalBody(
            desiredLocal,
            bodyIndent,
            eol,
        );
        const before = lines.slice(0, telemetryBlockEnd);
        const after = lines.slice(telemetryBlockEnd);
        // Split the rendered body back into its individual lines so that
        // the final `join(eol)` produces exactly one EOL per line.
        const renderedLines = stripTrailingEol(rendered, eol).split(eol);
        const insertedLines = [
            `${telemetryChildIndent}local:`,
            ...renderedLines,
        ];
        const rebuilt = [...before, ...insertedLines, ...after];
        return joinLines(rebuilt, eol) + eol;
    }

    assertBlockMappingOpener(lines[localKeyIndex], "telemetry.local");
    const localBlockEnd = findChildBlockEnd(
        lines,
        localKeyIndex + 1,
        telemetryBlockEnd,
        telemetryChildIndent,
    );
    const localChildIndent =
        detectChildIndent(lines, localKeyIndex + 1, localBlockEnd) ??
        `${telemetryChildIndent}${telemetryChildIndent}`;
    if (
        localChildIndent.length <= telemetryChildIndent.length ||
        localChildIndent.trim() !== ""
    ) {
        throw new Error(
            "Refusing to edit config.local.yaml: telemetry.local child indent is not a strict extension of the parent indent.",
        );
    }

    const rebuiltLocal = editExistingLocalBlock(
        lines.slice(localKeyIndex + 1, localBlockEnd),
        localChildIndent,
        desiredLocal,
    );
    const rebuilt = [
        ...lines.slice(0, localKeyIndex + 1),
        ...rebuiltLocal,
        ...lines.slice(localBlockEnd),
    ];
    return joinLines(rebuilt, eol) + eol;
}

function editExistingLocalBlock(lines, indent, desiredLocal) {
    const managedKeys = [
        "enabled",
        "otlpEndpoint",
        "logFile",
        "debugBridge",
        "structuredLogs",
    ];
    const existingKeys = new Set();
    const rebuilt = lines.map((line) => {
        const match = new RegExp(
            `^${escapeRegExp(indent)}([A-Za-z][A-Za-z0-9]*)\\s*:\\s*(.*)$`,
        ).exec(line);
        if (match === null || !managedKeys.includes(match[1])) {
            return line;
        }
        const key = match[1];
        existingKeys.add(key);
        if (
            key !== "enabled" &&
            key !== "debugBridge" &&
            key !== "structuredLogs"
        ) {
            return line;
        }
        const comment = extractInlineComment(match[2]);
        return `${indent}${key}: ${formatValue(desiredLocal[key])}${comment}`;
    });
    for (const key of managedKeys) {
        if (!existingKeys.has(key)) {
            rebuilt.push(`${indent}${key}: ${formatValue(desiredLocal[key])}`);
        }
    }
    return rebuilt;
}

function extractInlineComment(value) {
    const match = /(\s+#.*)$/.exec(value);
    return match?.[1] ?? "";
}

function detectEol(text) {
    if (text.includes("\r\n")) {
        return "\r\n";
    }
    return "\n";
}

function stripTrailingEol(text, eol) {
    return text.endsWith(eol) ? text.slice(0, -eol.length) : text;
}

function joinLines(lines, eol) {
    return lines.join(eol);
}

function findTopLevelKeyLine(lines, key) {
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (pattern.test(line)) {
            return i;
        }
    }
    return -1;
}

function findChildKeyLine(lines, start, end, indent, key) {
    const pattern = new RegExp(
        `^${escapeRegExp(indent)}${escapeRegExp(key)}\\s*:`,
    );
    for (let i = start; i < end; i++) {
        if (pattern.test(lines[i])) {
            return i;
        }
    }
    return -1;
}

function findBlockEnd(lines, start) {
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        if (/^\s/.test(line)) continue;
        if (/^\s*#/.test(line)) continue;
        return i;
    }
    return lines.length;
}

function findChildBlockEnd(lines, start, hardEnd, parentIndent) {
    for (let i = start; i < hardEnd; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        const indent = countLeadingSpaces(line);
        if (/^\s*#/.test(line)) {
            if (indent <= parentIndent.length) {
                return i;
            }
            continue;
        }
        if (indent <= parentIndent.length) {
            return i;
        }
    }
    return hardEnd;
}

function detectChildIndent(lines, start, end) {
    for (let i = start; i < end; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        if (/^\s*#/.test(line)) continue;
        const match = line.match(/^(\s+)\S/);
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

function countLeadingSpaces(line) {
    let n = 0;
    while (n < line.length && line[n] === " ") n++;
    return n;
}

function assertBlockMappingOpener(line, keyLabel) {
    const stripped = line.replace(/^\s*/, "");
    const colonIdx = stripped.indexOf(":");
    if (colonIdx < 0) {
        throw new Error(
            `Refusing to edit config.local.yaml: expected a block mapping for '${keyLabel}:'.`,
        );
    }
    const rest = stripped.slice(colonIdx + 1).trim();
    if (rest === "" || rest.startsWith("#")) {
        return;
    }
    throw new Error(
        `Refusing to edit config.local.yaml: '${keyLabel}:' must open a block mapping (found inline value "${rest}").`,
    );
}

function renderTelemetryLocalBody(desiredLocal, indent, eol) {
    const orderedKeys = [
        "enabled",
        "otlpEndpoint",
        "logFile",
        "debugBridge",
        "structuredLogs",
    ];
    const seen = new Set(orderedKeys);
    const extras = Object.keys(desiredLocal).filter((k) => !seen.has(k));
    const allKeys = [...orderedKeys, ...extras];

    const parts = [];
    for (const key of allKeys) {
        if (!(key in desiredLocal)) continue;
        parts.push(`${indent}${key}: ${formatValue(desiredLocal[key])}`);
    }
    return parts.join(eol) + eol;
}

function formatValue(value) {
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "number") {
        return String(value);
    }
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value !== "string") {
        throw new Error(
            `Unsupported telemetry.local value type: ${typeof value}.`,
        );
    }
    if (needsQuoting(value)) {
        return quote(value);
    }
    return value;
}

const YAML_RESERVED_LITERALS = new Set([
    "true",
    "false",
    "null",
    "yes",
    "no",
    "on",
    "off",
    "~",
    "",
]);

function needsQuoting(value) {
    if (YAML_RESERVED_LITERALS.has(value.toLowerCase())) {
        return true;
    }
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) {
        return true;
    }
    if (/^[\s"'`&*!|>%@?{}\[\],#]/.test(value)) {
        return true;
    }
    if (/:\s|\s#/.test(value)) {
        return true;
    }
    if (/[\r\n\t\0]/.test(value)) {
        return true;
    }
    return false;
}

function quote(value) {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");
    return `"${escaped}"`;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
