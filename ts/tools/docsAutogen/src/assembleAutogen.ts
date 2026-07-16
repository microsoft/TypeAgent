// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { decideCompact } from "./compactMode.js";
import { computeContentHash, formatHashComment } from "./contentHash.js";
import type { PackageInputs } from "./packageInputs.js";
import { renderAiDocumentation } from "./renderDocumentation.js";
import { renderReferenceSection } from "./renderReference.js";
import { renderStalenessFooter } from "./renderStaleness.js";

/**
 * Result of rendering the AUTOGEN body for a single package's
 * `README.AUTOGEN.md` file. The body that goes between the START /
 * END markers is the concatenation of:
 *
 *   1. hash comment
 *   2. SOURCE comment pointing back at `./README.md`
 *   3. H1 title (`# <pkg> — AI-generated documentation`)
 *   4. AI-authored documentation body (banner + LLM sections)
 *   5. deterministic Reference section
 *   6. staleness footer
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
     * Optional LLM-authored documentation body to embed in place of
     * the deterministic placeholder. When provided, this body is
     * expected to contain `## Section` headings beginning with
     * `## Overview`.
     */
    readonly llmDocumentationBody?: string;
}

/**
 * Compose the AUTOGEN body for a `README.AUTOGEN.md` file. Returns
 * the body that goes between the markers, plus the hash and compact
 * flag.
 *
 * The hash is computed over deterministic prompt-input proxies — NOT
 * over the rendered output (which would defeat the purpose).
 */
export function assembleAutogenBlock(
    inputs: PackageInputs,
    options: AssembleOptions,
): AssembledAutogen {
    const decision = decideCompact(inputs);

    const hash = computeInputHash(inputs);
    const documentation = renderAiDocumentation(
        inputs,
        options.llmDocumentationBody,
    );
    const reference = renderReferenceSection(inputs, decision);
    const footer = renderStalenessFooter(
        options.headSha,
        options.isoDate,
        inputs.pkg.name,
    );

    const titleLine = `# ${inputs.pkg.name} — AI-generated documentation`;
    const sourceComment = inputs.readmeContext.exists
        ? "<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->"
        : "<!-- AUTOGEN:DOCS:SOURCE: (no hand-written ./README.md found at last regen) -->";

    const body = [
        formatHashComment(hash),
        sourceComment,
        "",
        titleLine,
        "",
        documentation.trimEnd(),
        "",
        reference.trimEnd(),
        "",
        footer.trimEnd(),
        "",
    ].join("\n");

    return { body, hash, compact: decision.compact };
}

/**
 * Compute the content hash for a package's inputs — the same digest
 * `assembleAutogenBlock` embeds in the README.AUTOGEN.md body. Exposed
 * so callers can decide whether regenerating a package would be
 * meaningful (inputs changed) or pure churn (hash unchanged) WITHOUT
 * rendering or calling the LLM. Covers deterministic prompt-input
 * proxies, never the rendered output.
 */
export function computeInputHash(inputs: PackageInputs): string {
    return computeContentHash(hashInputs(inputs));
}

/**
 * Build the labelled string map the content hash is computed over.
 * Stable serialisation of every input that should trigger a doc
 * regeneration when changed.
 *
 * Notes:
 *   - We hash a digest of the hand-written README rather than the
 *     full text so a one-character whitespace edit doesn't churn
 *     the doc. The word-count proxy is good enough.
 *   - Action names + parameter shapes (but not comment text) are
 *     hashed so the deterministic Actions reference auto-regenerates
 *     when the schema's structural surface changes.
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
        "agent.actions": inputs.actions
            .map(
                (a) =>
                    `${a.actionName}|${a.implemented ? 1 : 0}|${a.parameters
                        .map((p) => `${p.name}:${p.optional ? 1 : 0}:${p.type}`)
                        .join(";")}`,
            )
            .sort()
            .join("\n"),
        "src.envVars": [...inputs.envVars].sort().join(","),
        "readme.wordCount": String(inputs.readmeContext.wordCount),
        "readme.exists": inputs.readmeContext.exists ? "1" : "0",
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
