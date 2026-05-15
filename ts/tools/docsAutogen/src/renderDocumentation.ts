// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PackageInputs } from "./packageInputs.js";

/**
 * Sentinel string embedded verbatim in the AI banner above any
 * AI-authored body. Cheap-to-grep marker that downstream tooling
 * uses to distinguish AI-authored README.AUTOGEN.md files from
 * placeholder ones (e.g. cli.ts:existingFileIsAiAuthored, which
 * gates a placeholder write from clobbering a good AI body on a
 * transient model error).
 *
 * Keep this short, distinctive, and stable — changing it without
 * also updating consumers will silently disable the protection.
 */
export const AI_AUTHORED_BANNER_SENTINEL = "**AI-authored documentation**";

/**
 * Render the AI-authored portion of `README.AUTOGEN.md`.
 *
 * Two paths:
 *   1. LLM body present → render a short provenance banner followed
 *      by the body verbatim. The body is expected to begin with a
 *      `## Overview` H2 (validated upstream).
 *   2. No LLM body → render a deterministic placeholder body that
 *      reads like documentation but tells the contributor the AI
 *      authoring step has not run yet.
 *
 * In both cases the rendered output starts with the AI provenance
 * banner and ends with a single trailing newline so the assembler
 * can concatenate it with the deterministic Reference section.
 */
export function renderAiDocumentation(
    inputs: PackageInputs,
    llmBody?: string,
): string {
    if (llmBody !== undefined && llmBody.trim().length > 0) {
        const lines: string[] = [];
        lines.push(aiBanner(inputs));
        lines.push("");
        lines.push(llmBody.trim());
        lines.push("");
        return lines.join("\n");
    }
    return renderPlaceholder(inputs);
}

function aiBanner(inputs: PackageInputs): string {
    const sourceHint = inputs.readmeContext.exists
        ? " Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source."
        : "";
    return `> 🤖 ${AI_AUTHORED_BANNER_SENTINEL}, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics.${sourceHint} May lag the working tree by up to 24h — see the staleness footer at the end of this file.`;
}

function renderPlaceholder(inputs: PackageInputs): string {
    const lines: string[] = [];
    const readmeHint = inputs.readmeContext.exists
        ? `, or read [\`./README.md\`](./README.md) for the hand-written documentation in the meantime`
        : "";
    lines.push(
        `> 📝 **Placeholder documentation — not yet AI-authored.** Re-run \`pnpm docs:generate:llm --package ${stripScope(inputs.pkg.name)}\` to populate this file${readmeHint}. The deterministic Reference section below is already populated.`,
    );
    lines.push("");
    lines.push("## Overview");
    lines.push("");
    if (inputs.description.length > 0) {
        lines.push(inputs.description);
    } else {
        lines.push(
            `\`${inputs.pkg.name}\` is a workspace package in the TypeAgent monorepo.`,
        );
    }
    lines.push("");
    return lines.join("\n").trimEnd() + "\n";
}

function stripScope(name: string): string {
    const slash = name.indexOf("/");
    return slash >= 0 ? name.slice(slash + 1) : name;
}
