// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { CompactDecision } from "./compactMode.js";
import {
    ACTIONS_REFERENCE_MAX,
    EXTERNAL_DEPS_MAX,
    FILES_OF_INTEREST_MAX,
    USED_BY_MAX,
} from "./lengthCaps.js";
import type { PackageInputs, SourceFile } from "./packageInputs.js";
import { hasAgentSurface } from "./agentSurface.js";
import type { AgentAction } from "./extractActions.js";
import type { WorkspacePackage } from "./workspaceGraph.js";

/**
 * Render the deterministic `## Reference` section of an AUTOGEN
 * block. No LLM input is consulted; everything is computed from
 * `inputs` and the workspace graph that produced them.
 */
export function renderReferenceSection(
    inputs: PackageInputs,
    decision: CompactDecision,
): string {
    const lines: string[] = [];
    lines.push("## Reference");
    lines.push("");
    lines.push(
        "> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.",
    );
    lines.push("");

    appendEntryPoints(lines, inputs);
    appendDependencies(lines, inputs);

    // Per design: compact mode omits Used by ONLY when empty;
    // a non-empty Used by is still informative and stays.
    const usedByEmpty = inputs.reverseDeps.length === 0;
    if (!(decision.compact && usedByEmpty)) {
        appendUsedBy(lines, inputs);
    }
    appendFilesOfInterest(lines, inputs, decision);
    if (inputs.isAgentPackage && hasAgentSurface(inputs.agentSurface)) {
        appendAgentSurface(lines, inputs);
    }
    if (inputs.envVars.length > 0) {
        appendEnvVars(lines, inputs);
    }
    if (inputs.isAgentPackage && inputs.actions.length > 0) {
        appendActionsReference(lines, inputs);
    }

    return lines.join("\n").trimEnd() + "\n";
}

function appendEntryPoints(out: string[], inputs: PackageInputs): void {
    out.push("### Entry points");
    out.push("");
    if (inputs.entryPoints.length === 0) {
        out.push("_No public exports declared in `package.json`._");
        out.push("");
        return;
    }
    for (const ep of inputs.entryPoints) {
        const target = ep.exists
            ? `[${ep.resolved}](${ep.resolved})`
            : `\`${ep.resolved}\``;
        const subpathLabel =
            ep.subpath === "." ? "default" : `\`${ep.subpath}\``;
        out.push(
            `- ${subpathLabel} → ${target}${ep.exists ? "" : " _(not found on disk)_"}`,
        );
    }
    out.push("");
}

function appendDependencies(out: string[], inputs: PackageInputs): void {
    out.push("### Dependencies");
    out.push("");
    if (inputs.workspaceDeps.length === 0) {
        out.push("Workspace: _None._");
    } else {
        out.push("Workspace:");
        out.push("");
        for (const dep of inputs.workspaceDeps) {
            out.push(`- [${dep.name}](${packageReadmeLink(inputs.pkg, dep)})`);
        }
    }
    out.push("");
    if (inputs.externalDeps.length === 0) {
        out.push("External: _None at runtime._");
    } else {
        const shown = inputs.externalDeps.slice(0, EXTERNAL_DEPS_MAX);
        const overflow = inputs.externalDeps.length - shown.length;
        out.push(`External: ${shown.map((d) => `\`${d}\``).join(", ")}`);
        if (overflow > 0) {
            out.push("");
            out.push(`_…and ${overflow} more not shown._`);
        }
    }
    out.push("");
}

function appendUsedBy(out: string[], inputs: PackageInputs): void {
    out.push("### Used by");
    out.push("");
    if (inputs.reverseDeps.length === 0) {
        out.push("_None._");
        out.push("");
        return;
    }
    const shown = inputs.reverseDeps.slice(0, USED_BY_MAX);
    const overflow = inputs.reverseDeps.length - shown.length;
    for (const consumer of shown) {
        out.push(
            `- [${consumer.name}](${packageReadmeLink(inputs.pkg, consumer)})`,
        );
    }
    if (overflow > 0) {
        out.push(`- _…and ${overflow} more workspace consumers._`);
    }
    out.push("");
}

function appendFilesOfInterest(
    out: string[],
    inputs: PackageInputs,
    decision: CompactDecision,
): void {
    out.push("### Files of interest");
    out.push("");
    const ranked = rankSourceFiles(inputs);
    if (ranked.length === 0) {
        out.push("_No tracked source files under `./src/`._");
        out.push("");
        return;
    }
    if (decision.compact) {
        const summary = ranked
            .slice(0, 3)
            .map((f) => `\`${f.relPath}\``)
            .join(", ");
        const moreCount = ranked.length - 3;
        out.push(
            moreCount > 0
                ? `${summary}, …and ${moreCount} more under \`./src/\`.`
                : summary + ".",
        );
        out.push("");
        return;
    }
    const shown = ranked.slice(0, FILES_OF_INTEREST_MAX);
    const overflow = ranked.length - shown.length;
    for (const f of shown) {
        out.push(`- [${f.relPath}](${f.relPath})`);
    }
    if (overflow > 0) {
        out.push(`- _…and ${overflow} more under \`./src/\`._`);
    }
    out.push("");
}

function appendAgentSurface(out: string[], inputs: PackageInputs): void {
    out.push("### Agent surface");
    out.push("");
    const s = inputs.agentSurface;
    if (s.manifestPath !== null) {
        out.push(`- Manifest: [${s.manifestPath}](${s.manifestPath})`);
    }
    if (s.schemaPath !== null) {
        out.push(`- Schema: [${s.schemaPath}](${s.schemaPath})`);
    }
    if (s.grammarPath !== null) {
        out.push(`- Grammar: [${s.grammarPath}](${s.grammarPath})`);
    }
    if (s.handlerPath !== null) {
        out.push(`- Handler: [${s.handlerPath}](${s.handlerPath})`);
    }
    out.push("");
}

/**
 * Render the deterministic `### Environment variables` subsection.
 * Lists every project-specific `process.env.<NAME>` reference found
 * in `src/`. System / runtime / debug env vars are filtered out
 * upstream so this list reflects only configuration the contributor
 * needs to set themselves (typically in `ts/.env`).
 *
 * Only emitted when at least one env var was detected; the AI-authored
 * `## Setup` section above is the place for prose around how to
 * obtain each value.
 */
function appendEnvVars(out: string[], inputs: PackageInputs): void {
    out.push("### Environment variables");
    out.push("");
    out.push(
        `_${inputs.envVars.length} environment variable${inputs.envVars.length === 1 ? "" : "s"} referenced from \`./src/\` (set in \`ts/.env\` or your shell). See the \`## Setup\` section above for guidance on obtaining each value._`,
    );
    out.push("");
    for (const name of inputs.envVars) {
        out.push(`- \`${name}\``);
    }
    out.push("");
}

/**
 * Render the deterministic `### Actions` reference subsection for an
 * agent package. Emits a compact two-column table — one row per
 * action — pairing a representative sample utterance with the action
 * name and a type-shaped sample of its required parameters:
 *
 * ```
 * | User says | Action |
 * | --- | --- |
 * | "take a photo" | `takePhoto` |
 * | "add bananas to my grocery list" | `addItems` → `{ "items": ["…"], "listName": "…" }` |
 * ```
 *
 * Sample values are placeholders synthesized from each parameter's
 * declared type — never invented data — so the row shows the *shape*
 * of the call, not a worked example. Optional parameters are
 * intentionally omitted to keep the table scannable; the schema link
 * in the Agent surface section above is the source of truth for the
 * full signature.
 *
 * Capped at `ACTIONS_REFERENCE_MAX` with an overflow row.
 */
function appendActionsReference(out: string[], inputs: PackageInputs): void {
    const implemented = inputs.actions.filter((a) => a.implemented);
    const stubCount = inputs.actions.length - implemented.length;
    if (implemented.length === 0) {
        // All declared actions are schema-only stubs — render a one-line
        // note so contributors can see the agent's surface area is still
        // pending implementation, then bail.
        out.push("### Actions");
        out.push("");
        out.push(
            `_${inputs.actions.length} action${inputs.actions.length === 1 ? "" : "s"} declared in the schema, none yet implemented in [\`${inputs.agentSurface.handlerPath ?? "the handler"}\`]._`,
        );
        out.push("");
        return;
    }

    out.push("### Actions");
    out.push("");
    const schemaPath = inputs.agentSurface.schemaPath ?? "schema";
    const stubNote =
        stubCount > 0
            ? ` ${stubCount} additional action${stubCount === 1 ? " is" : "s are"} declared in the schema but not yet implemented; not shown.`
            : "";
    out.push(
        `_${implemented.length} action${implemented.length === 1 ? "" : "s"} implemented by this agent, parsed deterministically from \`${schemaPath}\`. Sample utterances and parameter shapes are illustrative; consult the schema for the full signature.${stubNote}_`,
    );
    out.push("");
    out.push("| User says | Action |");
    out.push("| --- | --- |");
    const shown = implemented.slice(0, ACTIONS_REFERENCE_MAX);
    const overflow = implemented.length - shown.length;
    for (const action of shown) {
        out.push(renderActionRow(action));
    }
    if (overflow > 0) {
        out.push(
            `| _…and ${overflow} more action${overflow === 1 ? "" : "s"} not shown (cap: ${ACTIONS_REFERENCE_MAX})._ | |`,
        );
    }
    out.push("");
}

function renderActionRow(action: AgentAction): string {
    const userSays = formatUserSaysCell(action);
    const actionCell = formatActionCell(action);
    return `| ${userSays} | ${actionCell} |`;
}

function escapeTableCell(value: string): string {
    // Escape backslashes BEFORE pipes so we don't double-escape the
    // backslash we just added in front of `|` (incomplete-string-
    // escaping CodeQL warning).
    return value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

function formatUserSaysCell(action: AgentAction): string {
    const phrase = action.samplePhrases[0];
    if (phrase !== undefined && phrase.length > 0) {
        return `"${escapeTableCell(phrase)}"`;
    }
    if (action.description.length > 0) {
        const trimmed = action.description.split(/[.!?]\s/u)[0]!.trim();
        return `_${escapeTableCell(trimmed)}_`;
    }
    return "_(no sample)_";
}

function formatActionCell(action: AgentAction): string {
    const requiredParams = action.parameters.filter((p) => !p.optional);
    if (requiredParams.length === 0) {
        return `\`${action.actionName}\``;
    }
    const sampleJson = synthesizeSampleJson(requiredParams);
    return `\`${action.actionName}\` → \`${escapeTableCell(sampleJson)}\``;
}

/**
 * Build a JSON-shaped string showing the required parameters of an
 * action with type-derived placeholder values. The output is a
 * single-line `{ "key": value, ... }` literal suitable for a table
 * cell. Values are NOT invented — they are placeholders (`"…"`, `0`,
 * `false`) keyed off the declared TypeScript type, except for
 * single-literal string unions where the literal itself is a useful
 * sample.
 */
function synthesizeSampleJson(
    parameters: readonly { name: string; type: string }[],
): string {
    const parts = parameters.map(
        (p) => `"${p.name}": ${placeholderValueFor(p.type)}`,
    );
    return `{ ${parts.join(", ")} }`;
}

function placeholderValueFor(rawType: string): string {
    const t = rawType.trim();
    if (/^string\s*\[\s*\]$/u.test(t)) return `["…"]`;
    if (/^number\s*\[\s*\]$/u.test(t)) return `[0]`;
    if (/^boolean\s*\[\s*\]$/u.test(t)) return `[false]`;
    if (/^Array\s*<\s*string\s*>$/u.test(t)) return `["…"]`;
    if (/^Array\s*<\s*number\s*>$/u.test(t)) return `[0]`;
    const literalUnion = parseStringLiteralUnion(t);
    if (literalUnion !== null) return `"${literalUnion}"`;
    if (t === "string") return `"…"`;
    if (t === "number") return "0";
    if (t === "boolean") return "false";
    if (t.startsWith("{")) return "{ … }";
    if (t.startsWith("[")) return "[ … ]";
    return `"…"`;
}

/**
 * If `type` is a union of one or more single-quoted/double-quoted
 * string literals, return the first literal's contents. Otherwise
 * return null.
 */
function parseStringLiteralUnion(type: string): string | null {
    const parts = type
        .split("|")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (parts.length === 0) return null;
    const first = parts[0]!;
    const m = /^"([^"]*)"$|^'([^']*)'$/u.exec(first);
    if (!m) return null;
    for (const p of parts) {
        if (!/^"[^"]*"$|^'[^']*'$/u.test(p)) return null;
    }
    return m[1] ?? m[2] ?? "";
}

/**
 * Order source files so the renderer's truncation cap keeps the most
 * informative ones. Heuristic, intentionally simple:
 *
 *  1. Files referenced by the agent surface come first.
 *  2. Then files whose name suggests an entry point (Manifest, Schema,
 *     Handler, index, main).
 *  3. Then everything else in alphabetical order.
 *
 * Within each tier we sort alphabetically for stability.
 */
function rankSourceFiles(inputs: PackageInputs): SourceFile[] {
    const surfaceSet = new Set<string>(
        [
            inputs.agentSurface.manifestPath,
            inputs.agentSurface.schemaPath,
            inputs.agentSurface.grammarPath,
            inputs.agentSurface.handlerPath,
        ].filter((p): p is string => p !== null),
    );
    const entryPointSet = new Set<string>(
        inputs.entryPoints.filter((ep) => ep.exists).map((ep) => ep.resolved),
    );

    function tier(f: SourceFile): number {
        if (surfaceSet.has(f.relPath)) return 0;
        if (entryPointSet.has(f.relPath)) return 1;
        const base = path.basename(f.relPath);
        if (/^(index|main)\.(m?[tj]sx?)$/u.test(base)) return 2;
        if (
            /(Manifest\.json|Schema\.ts|Schema\.agr|Handler\.ts)$/u.test(base)
        ) {
            return 2;
        }
        return 3;
    }

    return [...inputs.sourceFiles].sort((a, b) => {
        const ta = tier(a);
        const tb = tier(b);
        if (ta !== tb) return ta - tb;
        return a.relPath.localeCompare(b.relPath);
    });
}

/**
 * Compute a repo-relative POSIX link from one package's
 * README.AUTOGEN.md to another package's README.md (still the
 * canonical README file across the repo). Both packages know their
 * own `relDir` (relative to the monorepo root); we walk up from the
 * source and down into the target.
 */
function packageReadmeLink(
    from: WorkspacePackage,
    to: WorkspacePackage,
): string {
    const upCount = from.relDir.split("/").length;
    const ups = "../".repeat(upCount);
    return `${ups}${to.relDir}/README.md`;
}
