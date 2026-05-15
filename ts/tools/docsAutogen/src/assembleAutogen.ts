// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { decideCompact } from "./compactMode.js";
import { computeContentHash, formatHashComment } from "./contentHash.js";
import type { PackageInputs } from "./packageInputs.js";
import { renderOverviewSection } from "./renderOverview.js";
import { renderReferenceSection } from "./renderReference.js";
import { renderStalenessFooter } from "./renderStaleness.js";

/**
 * Result of rendering the AUTOGEN block for a single package.
 */
export interface AssembledAutogen {
    /** The full body that goes between the START / END markers. */
    readonly body: string;
    /** The content hash embedded inside the body. */
    readonly hash: string;
    /** True when the package qualified for compact mode. */
    readonly compact: boolean;
}

export interface AssembleOptions {
    /** Full SHA the generation runs against — embedded in the footer. */
    readonly headSha: string;
    /** ISO-8601 timestamp embedded in the footer. */
    readonly isoDate: string;
    /**
     * Optional LLM-authored Overview body to embed in place of the
     * deterministic placeholder. When provided, replaces the entire
     * `## Overview` section content (heading is added by the renderer).
     */
    readonly llmOverviewBody?: string;
}

/**
 * Compose the deterministic-skeleton + LLM-prose AUTOGEN body for a
 * package: hash comment, Overview section, Reference section, and
 * staleness footer.
 *
 * The hash is computed over deterministic prompt-input proxies — NOT
 * over the rendered output (which would defeat the purpose).
 */
export function assembleAutogenBlock(
    inputs: PackageInputs,
    options: AssembleOptions,
): AssembledAutogen {
    const decision = decideCompact(inputs);

    const hash = computeContentHash(hashInputs(inputs));
    const overview = renderOverviewSection(
        inputs,
        decision,
        options.llmOverviewBody,
    );
    const reference = renderReferenceSection(inputs, decision);
    const footer = renderStalenessFooter(
        options.headSha,
        options.isoDate,
        inputs.pkg.name,
    );

    const body = [
        formatHashComment(hash),
        "",
        overview.trimEnd(),
        "",
        reference.trimEnd(),
        "",
        footer.trimEnd(),
        "",
    ].join("\n");

    return { body, hash, compact: decision.compact };
}

/**
 * Build the labelled string map the content hash is computed over.
 * Stable serialisation of every input that should trigger a doc
 * regeneration when changed.
 */
function hashInputs(inputs: PackageInputs): Record<string, string> {
    return {
        "package.name": inputs.pkg.name,
        "package.description": inputs.description,
        "package.exports": stableJson(inputs.pkg.packageJson.exports),
        "package.main": String(inputs.pkg.packageJson.main ?? ""),
        "package.bin": stableJson(inputs.pkg.packageJson.bin),
        "package.dependencies": stableJson(inputs.pkg.packageJson.dependencies),
        "package.devDependencies": stableJson(
            inputs.pkg.packageJson.devDependencies,
        ),
        "package.peerDependencies": stableJson(
            inputs.pkg.packageJson.peerDependencies,
        ),
        "workspace.deps": inputs.workspaceDeps
            .map((d) => d.name)
            .sort()
            .join(","),
        "workspace.reverseDeps": inputs.reverseDeps
            .map((d) => d.name)
            .sort()
            .join(","),
        "src.fileList": inputs.sourceFiles
            .map((f) => `${f.relPath}:${f.sizeBytes}`)
            .join("\n"),
        "agent.surface": stableJson(inputs.agentSurface),
    };
}

function stableJson(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
}
