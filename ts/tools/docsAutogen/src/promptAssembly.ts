// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PackageInputs } from "./packageInputs.js";
import type { AgentAction } from "./extractActions.js";

export interface AssembledPrompt {
    system: string;
    user: string;
    chars: number;
}

export interface PromptOptions {
    /** Cap on user-message characters. Defaults to ~32k (≈8k tokens). */
    maxUserChars?: number;
    /** Max characters of source-file sample per file. */
    perFileSampleChars?: number;
    /** Max number of source files to sample. */
    maxSampleFiles?: number;
    /** Max characters of hand-written README content to forward. */
    maxReadmeChars?: number;
}

const DEFAULT_OPTS: Required<PromptOptions> = {
    maxUserChars: 32_000,
    perFileSampleChars: 1_500,
    maxSampleFiles: 8,
    maxReadmeChars: 8_000,
};

const SYSTEM_PROMPT = `You are authoring contributor-grade documentation for a package in the TypeAgent monorepo. Your output becomes the body of a generated \`README.AUTOGEN.md\` file that lives alongside the package's hand-written \`README.md\`.

Your job is to write multi-section markdown documentation that:
  • orients a new contributor to what the package does and where to start;
  • is concrete about features, actions, and integration points (not generic scaffolding);
  • mirrors and extends the hand-written README content the user gives you (do not contradict it; summarise setup steps in your own \`## Setup\` section rather than duplicating verbatim, and link to \`./README.md\` for the full step-by-step).

Hard constraints (a structural validator enforces these and a failed validation triggers one corrective retry):

1. Output ONLY the markdown body. Do NOT include an H1 (\`# …\`) — the file's title is added deterministically. Do NOT include the deterministic Reference section (entry points / dependencies / files of interest / agent surface / actions list / environment variables) — that is appended after your output. Do NOT include the staleness footer.
2. Use \`## Section\` headings for top-level sections. The body MUST contain at least an \`## Overview\` section. Recommended layout when applicable:
     ## Overview
     ## What it does
     ## Setup       (include when the package needs anything beyond \`pnpm install\` — env vars, API keys, OAuth, external account or service setup; summarise the steps and link to ./README.md for details. Omit when no extra setup is needed.)
     ## Architecture
     ## How to extend
   You may add or omit sections to fit the package; aim for 4–7 H2 sections total. Do NOT author an \`## Actions\` section — the deterministic Actions reference table is appended after your output and is the single source of truth for the user-says-to-action mapping.
3. Length: 500–1500 words target band, 2500-word hard cap. Write tighter rather than longer; favour concrete details over filler prose.
4. Tone: factual, plain language, geared at both new contributors and AI agents reading for navigation. No marketing prose. The validator rejects words like "powerful", "seamless", "robust", "cutting-edge", "best-in-class", "blazing", "elegant".
5. No diagrams. No Mermaid blocks. No ASCII art.
6. No clickable absolute URLs. Do not write \`[text](https://…)\` markdown links or \`<https://…>\` autolinks. Repo-internal references must use repo-relative \`./\` or \`../\` paths (the validator checks every link target resolves on disk). External URLs that are part of legitimate setup instructions (Discord developer portal, Microsoft sign-in URL, etc.) MAY appear as inline code (e.g. \`\` \`https://aka.ms/foo\` \`\`) or as plain prose mentions, but never as clickable markdown links.
7. Code fences must declare a language (e.g. \`\`\`ts, \`\`\`json). No bare \`\`\` fences.
8. When referencing actions in prose, use action names verbatim from the action list given to you (e.g. \`createMessage\`, not "create message"). Group them thematically rather than enumerating every one — the deterministic table below your output already enumerates them. Mention only actions from the implemented action list; do not invent or describe actions that are schema-only stubs.
9. If the package has hand-written README content provided to you, treat it as authoritative for setup/prerequisites — extract the essentials into your own \`## Setup\` section (env vars to set, accounts/keys to obtain, one-time bootstrap commands) and link to \`./README.md\` for the full walk-through. Do not invent setup steps that aren't in the README or implied by the source.
10. If you reference a file, use a markdown link with a repo-relative path: \`[photoActionHandler.ts](./src/photoActionHandler.ts)\`.

Style guidance (not validator-enforced but expected):
  • Open the Overview with one sentence stating what the package is, then 1–2 short paragraphs of context.
  • In "What it does", describe the package's capabilities in concrete terms — what kinds of actions it accepts (referenced by name), what it produces, what other parts of the system it talks to. The deterministic table will list every action; your job is to give shape and grouping in prose.
  • In "Setup" (when present): list every env var the deterministic input flagged, briefly state how to obtain its value (cite the README if it explains the process), call out any OAuth / portal steps, and finish with a one-line "see ./README.md for the full walk-through" pointer when the README has detailed steps. Skip this section when the package has no env vars and the README has no setup section.
  • In "Architecture", describe the internal layout: which files own which responsibilities, the schema/grammar/handler triple for agents, public exports for libraries.
  • In "How to extend", give the contributor a starting point: which file to open first, what pattern to follow, what tests to run.

If an existing AUTOGEN block from a previous run is supplied below, treat it as a starting point and revise where it is stale, vague, or violates the constraints. If no prior block is supplied, write fresh.`;

/**
 * Build the user message for the documentation prompt. Includes:
 *   - package name + description + manifest summary
 *   - the package's hand-written README.md (if any), capped
 *   - the action list (for agent packages)
 *   - the deterministic Reference section (so the model doesn't
 *     duplicate it)
 *   - the existing AUTOGEN block (if present) for refinement
 *   - a capped slice of source files for grounding
 *
 * Truncation strategy: if total length exceeds the cap, drop the
 * source samples first, then the existing-block + README sections.
 * Package metadata, action list, and Reference are never truncated.
 */
export async function assembleDocumentationPrompt(
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
    head.push(
        inputs.isAgentPackage
            ? "Package type: TypeAgent application agent."
            : "Package type: TypeScript library.",
    );
    head.push("");

    const implementedActions = inputs.actions.filter((a) => a.implemented);
    if (implementedActions.length > 0) {
        const stubCount = inputs.actions.length - implementedActions.length;
        const stubNote =
            stubCount > 0
                ? `; ${stubCount} additional schema-only stub${stubCount === 1 ? " is" : "s are"} omitted`
                : "";
        head.push(
            `## Action list (${implementedActions.length} implemented action${implementedActions.length === 1 ? "" : "s"}, deterministic from \`${inputs.agentSurface.schemaPath ?? "schema"}\`${stubNote})`,
        );
        head.push("");
        for (const a of implementedActions) {
            head.push(formatActionForPrompt(a));
        }
        head.push("");
    }

    if (inputs.envVars.length > 0) {
        head.push(
            `## Environment variables (deterministic, from \`process.env.<NAME>\` references in \`./src/\`)`,
        );
        head.push("");
        head.push(
            `These are the project-specific env vars the source code reads (system / runtime / debug vars are filtered out). Mention every one of them in your \`## Setup\` section; if the hand-written README explains how to obtain a value, summarise that explanation. If an env var is not in this list, do NOT invent it.`,
        );
        head.push("");
        for (const name of inputs.envVars) {
            head.push(`- \`${name}\``);
        }
        head.push("");
    }

    head.push("## Reference (already generated, do NOT duplicate)");
    head.push("");
    head.push(referenceMarkdown.trim());
    head.push("");

    const headBlock = head.join("\n");

    const middle: string[] = [];
    if (inputs.readmeContext.exists && inputs.readmeContext.handAuthored) {
        middle.push(
            `## Hand-written README.md (authoritative source — mirror, do not contradict)`,
        );
        middle.push("");
        const trimmed = inputs.readmeContext.handAuthored.slice(
            0,
            opts.maxReadmeChars,
        );
        middle.push(trimmed);
        if (inputs.readmeContext.handAuthored.length > opts.maxReadmeChars) {
            middle.push(`\n…(truncated to first ${opts.maxReadmeChars} chars)`);
        }
        middle.push("");
    }

    const existing = extractExistingDocumentation(inputs.existingBlock);
    if (existing && existing.trim().length > 0) {
        middle.push("## Previously generated documentation (refine if stale)");
        middle.push("");
        middle.push(existing.trim());
        middle.push("");
    }

    const tail: string[] = [];
    tail.push("## Source samples (truncated, for grounding only)");
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

    let user = `${headBlock}\n${middle.join("\n")}\n${tail.join("\n")}`;
    if (user.length > opts.maxUserChars) {
        user = `${headBlock}\n${middle.join("\n")}\n## Source samples (omitted — over ${opts.maxUserChars}-char budget)\n`;
        if (user.length > opts.maxUserChars) {
            user = `${headBlock}\n## Hand-written README and prior-block context omitted — over budget.\n`;
            if (user.length > opts.maxUserChars) {
                user = user.slice(0, opts.maxUserChars);
            }
        }
    }

    return {
        system: SYSTEM_PROMPT,
        user,
        chars: SYSTEM_PROMPT.length + user.length,
    };
}

function formatActionForPrompt(a: AgentAction): string {
    const lines: string[] = [];
    lines.push(`- \`${a.actionName}\` (\`${a.typeName}\`)`);
    if (a.description) {
        lines.push(`    - ${a.description}`);
    }
    if (a.parameters.length > 0) {
        const params = a.parameters
            .map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}`)
            .join("; ");
        lines.push(`    - parameters: ${params}`);
    }
    if (a.samplePhrases.length > 0) {
        const sample = a.samplePhrases[0]!;
        lines.push(`    - sample: "${sample}"`);
    }
    return lines.join("\n");
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

    for (const candidate of [
        inputs.agentSurface.manifestPath,
        inputs.agentSurface.schemaPath,
        inputs.agentSurface.handlerPath,
        inputs.agentSurface.grammarPath,
    ]) {
        if (candidate && !seen.has(candidate)) {
            seen.add(candidate);
            candidates.push(candidate);
        }
    }
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
 * Pull the documentation body out of a previously-generated AUTOGEN
 * block (for refinement across runs). Strips the leading hash-comment
 * header line and any trailing staleness footer so the model sees
 * just the prose.
 */
function extractExistingDocumentation(body: string | null): string | null {
    if (body === null) return null;
    let s = body;
    s = s.replace(/^<!--\s*AUTOGEN:DOCS:HASH:[^>]*-->\s*\r?\n+/u, "");
    s = s.replace(/^<!--\s*AUTOGEN:DOCS:SOURCE:[^>]*-->\s*\r?\n+/iu, "");
    s = s.replace(/\n##\s+Reference\s*\r?\n[\s\S]*$/u, "\n");
    return s.trim();
}
