// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageInputs } from "./packageInputs.js";

export interface AssembledPrompt {
    system: string;
    user: string;
    chars: number;
}

export interface PromptOptions {
    /** Cap on user-message characters. Defaults to ~24k (≈6k tokens). */
    maxUserChars?: number;
    /** Max characters of source-file sample per file. */
    perFileSampleChars?: number;
    /** Max number of source files to sample. */
    maxSampleFiles?: number;
}

const DEFAULT_OPTS: Required<PromptOptions> = {
    maxUserChars: 24_000,
    perFileSampleChars: 1_500,
    maxSampleFiles: 4,
};

const SYSTEM_PROMPT = `You are writing the Overview section for a package README in the TypeAgent monorepo.

Constraints — these are enforced by a structural validator and a failed validation will trigger one corrective retry:

1. Output ONLY the markdown body of the Overview section. Do NOT include the "## Overview" heading itself, do NOT include any other headings, do NOT include the Reference section (which is generated deterministically and provided to you for context only), and do NOT include the staleness footer.
2. Length: 250–400 words is the target; 500 words is the hard cap. Write tighter rather than longer.
3. Tone: factual, plain language, geared at both new contributors and AI agents reading for navigation. No marketing prose. The validator rejects words like "powerful", "seamless", "robust", "cutting-edge", "best-in-class", "blazing", "elegant".
4. No diagrams. No Mermaid blocks. No ASCII art.
5. No absolute URLs or https://github.com/... links. Cross-package links should be left to the deterministic Reference section below.
6. If you reference a file path, use a repo-relative path that starts with ./ or ../ and link it as markdown. The validator checks every link target resolves on disk.
7. Code fences must declare a language (e.g. \`\`\`ts, \`\`\`json). No bare \`\`\` fences.
8. Two recommended paragraphs:
   • What this package is and where it sits in the dispatcher → agent flow.
   • How a contributor (or agent) typically modifies it — the entry point, the schema/grammar/handler triple if it's an agent package, the most important source file to read first.

If an existing Overview is supplied below, treat it as a starting point and only revise where it is stale, vague, or violates the constraints above. If no existing Overview is supplied, write one from scratch.`;

/**
 * Build the user message for the Overview prompt. Includes:
 *   - package name + description
 *   - the deterministic Reference section (so the model knows what's
 *     already covered and doesn't duplicate)
 *   - the existing Overview (if present) for refinement
 *   - a capped slice of the entry-point source files for grounding
 *
 * The user message is truncated end-first to fit within
 * `maxUserChars` so the most important context (package metadata,
 * reference, existing overview) is preserved.
 */
export async function assembleOverviewPrompt(
    inputs: PackageInputs,
    referenceMarkdown: string,
    options: PromptOptions = {},
): Promise<AssembledPrompt> {
    const opts = { ...DEFAULT_OPTS, ...options };

    const head: string[] = [];
    head.push(`Package: ${inputs.pkg.name}`);
    if (inputs.description) {
        head.push(`Description: ${inputs.description}`);
    }
    head.push(`Workspace location: ts/${inputs.pkg.relDir}/`);
    head.push("");

    head.push("## Reference (already generated, do not duplicate)");
    head.push("");
    head.push(referenceMarkdown.trim());
    head.push("");

    const existingOverview = extractExistingOverviewFromBlock(
        inputs.existingBlock,
    );
    if (existingOverview && existingOverview.trim().length > 0) {
        head.push("## Existing Overview (refine if needed)");
        head.push("");
        head.push(existingOverview.trim());
        head.push("");
    }

    const headBlock = head.join("\n");
    const tail: string[] = [];
    tail.push("## Source samples (truncated)");
    tail.push("");

    const samples = await sampleEntryPointSources(inputs, opts);
    for (const sample of samples) {
        tail.push(`### ${sample.relPath}`);
        tail.push("");
        tail.push("```" + sample.lang);
        tail.push(sample.body);
        tail.push("```");
        tail.push("");
    }

    let user = `${headBlock}\n${tail.join("\n")}`;
    if (user.length > opts.maxUserChars) {
        // Drop source samples first; never truncate metadata or the
        // Reference block.
        user = `${headBlock}\n## Source samples (omitted — would exceed ${opts.maxUserChars}-char budget)\n`;
        if (user.length > opts.maxUserChars) {
            user = user.slice(0, opts.maxUserChars);
        }
    }

    return {
        system: SYSTEM_PROMPT,
        user,
        chars: SYSTEM_PROMPT.length + user.length,
    };
}

interface SampledFile {
    relPath: string;
    lang: string;
    body: string;
}

async function sampleEntryPointSources(
    inputs: PackageInputs,
    opts: Required<PromptOptions>,
): Promise<SampledFile[]> {
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const ep of inputs.entryPoints) {
        if (!ep.exists) continue;
        const srcCandidate = ep.resolved
            .replace(/\.\/dist\//u, "./src/")
            .replace(/\.js(\b|$)/u, ".ts$1");
        if (!seen.has(srcCandidate)) {
            seen.add(srcCandidate);
            candidates.push(srcCandidate);
        }
    }
    for (const sf of inputs.sourceFiles) {
        if (seen.has(sf.relPath)) continue;
        seen.add(sf.relPath);
        candidates.push(sf.relPath);
    }

    const out: SampledFile[] = [];
    for (const relPath of candidates) {
        if (out.length >= opts.maxSampleFiles) break;
        const abs = path.join(inputs.pkg.dir, relPath);
        let body: string;
        try {
            body = await fs.readFile(abs, "utf8");
        } catch {
            continue;
        }
        if (body.length > opts.perFileSampleChars) {
            body = `${body.slice(0, opts.perFileSampleChars)}\n// …truncated`;
        }
        out.push({
            relPath,
            lang: detectLang(relPath),
            body,
        });
    }
    return out;
}

function detectLang(relPath: string): string {
    const ext = path.extname(relPath).toLowerCase();
    switch (ext) {
        case ".ts":
        case ".mts":
        case ".cts":
            return "ts";
        case ".js":
        case ".mjs":
        case ".cjs":
            return "js";
        case ".json":
            return "json";
        case ".agr":
            return "text";
        default:
            return "text";
    }
}

/**
 * Pull the existing `## Overview` section (and any sub-headings up to
 * the next `##`) out of a previously-generated AUTOGEN body, so the
 * LLM can refine human edits across runs.
 */
function extractExistingOverviewFromBlock(body: string | null): string | null {
    if (body === null) return null;
    const lines = body.split(/\r?\n/u);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+Overview\s*$/u.test(lines[i]!)) {
            start = i + 1;
            break;
        }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
        if (/^##\s+\S/u.test(lines[i]!)) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n").trim();
}
