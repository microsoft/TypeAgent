// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { CompactDecision } from "./compactMode.js";
import {
    EXTERNAL_DEPS_MAX,
    FILES_OF_INTEREST_MAX,
    USED_BY_MAX,
} from "./lengthCaps.js";
import type { PackageInputs, SourceFile } from "./packageInputs.js";
import { hasAgentSurface } from "./agentSurface.js";
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
        "> Generated deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit shown in the footer below. The Overview above is LLM-authored; this section is not.",
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
    appendExamplePlaceholder(lines, inputs);

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

function appendExamplePlaceholder(out: string[], inputs: PackageInputs): void {
    out.push("### Example");
    out.push("");
    out.push(
        "_Example snippet pending LLM authoring; will be filled in once the generator is wired to the LLM (see `ts/docs/architecture/doc-autogen.md`)._",
    );
    void inputs;
    out.push("");
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
 * Compute a repo-relative POSIX link from one package's README to
 * another package's README. Both packages know their own `relDir`
 * (relative to the monorepo root); we walk up from the source and
 * down into the target.
 */
function packageReadmeLink(
    from: WorkspacePackage,
    to: WorkspacePackage,
): string {
    const upCount = from.relDir.split("/").length;
    const ups = "../".repeat(upCount);
    return `${ups}${to.relDir}/README.md`;
}
