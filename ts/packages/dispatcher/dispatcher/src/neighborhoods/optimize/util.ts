// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared helpers for the optimize/ subtree. These mirror the (currently
// duplicated) helpers in `collisionCorpusHandlers.ts` and
// `collisionNeighborhoodHandlers.ts`. v1 keeps them here so the optimize
// path doesn't grow a handler-to-handler dependency; a follow-up cleanup
// can dedupe.

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type { ActionContext } from "@typeagent/agent-sdk";
import {
    changeContextConfig,
    type CommandHandlerContext,
} from "../../context/commandHandlerContext.js";

// =============================================================================
// Concurrency
// =============================================================================

/** Sensible LLM-call concurrency default. Chat completions are expensive
 *  and rate-limited; 8 is a reasonable balance for current Azure OpenAI
 *  quotas. */
export const DEFAULT_CONCURRENCY = 8;

/** Bounded-concurrency async map. Matches the helper used by the corpus
 *  probe and the translation probe runner. */
export async function pmap<T, R>(
    items: T[],
    concurrency: number,
    runOne: (item: T, index: number) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let done = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await runOne(items[i]!, i);
            done++;
            onProgress?.(done, items.length);
        }
    }
    const workers = Array.from(
        { length: Math.max(1, concurrency) },
        worker,
    );
    await Promise.all(workers);
    return results;
}

// =============================================================================
// JSON extraction (LLM-response unwrap)
// =============================================================================

/** Pull a JSON object/array out of an LLM response. Strips ``` fences and
 *  finds the first balanced {…} or […] block. Returns undefined when no
 *  parseable JSON is found. */
export function extractJSON<T = unknown>(text: string): T | undefined {
    if (!text) return undefined;
    // Strip code fences.
    let body = text;
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        body = fenced[1]!;
    }
    body = body.trim();
    // Try direct parse first.
    try {
        return JSON.parse(body) as T;
    } catch {
        // fall through
    }
    // Find first balanced {…} or […].
    const start = body.search(/[{[]/);
    if (start < 0) return undefined;
    const open = body[start]!;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < body.length; i++) {
        const c = body[i]!;
        if (escape) {
            escape = false;
            continue;
        }
        if (c === "\\") {
            escape = true;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (c === open) depth++;
        else if (c === close) {
            depth--;
            if (depth === 0) {
                const candidate = body.slice(start, i + 1);
                try {
                    return JSON.parse(candidate) as T;
                } catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}

// =============================================================================
// Workdir + path resolution
// =============================================================================

export function defaultWorkdir(systemContext: CommandHandlerContext): string {
    const root = systemContext.instanceDir ?? process.cwd();
    return path.join(root, "collisions");
}

export function ensureDir(p: string) {
    fs.mkdirSync(p, { recursive: true });
}

export function resolveWorkdir(
    systemContext: CommandHandlerContext,
    flag: string | undefined,
): string {
    const dir = flag ? path.resolve(flag) : defaultWorkdir(systemContext);
    ensureDir(dir);
    return dir;
}

export function defaultPath(
    systemContext: CommandHandlerContext,
    flag: string | undefined,
    workdir: string | undefined,
    filename: string,
): string {
    if (flag) return path.resolve(flag);
    const dir = workdir ?? defaultWorkdir(systemContext);
    return path.join(dir, filename);
}

// =============================================================================
// Read-only session wrapper — toggles construction cache off for the
// duration of an LLM-driven probe so we observe pure translator decisions.
// Mirrors the wrapper used by collisionCorpusHandlers's translate step.
// =============================================================================

export async function withReadOnlySession<T>(
    context: ActionContext<CommandHandlerContext>,
    fn: () => Promise<T>,
): Promise<T> {
    const session = context.sessionContext.agentContext.session;
    const wasCacheEnabled = session.getConfig().cache.enabled;
    if (wasCacheEnabled) {
        await changeContextConfig({ cache: { enabled: false } }, context);
    }
    try {
        return await fn();
    } finally {
        if (wasCacheEnabled) {
            await changeContextConfig({ cache: { enabled: true } }, context);
        }
    }
}

// =============================================================================
// Display helpers — clickable file paths in dispatcher output.
// =============================================================================

/** Render an absolute filesystem path as a markdown link the shell/VS Code
 *  extension can render as `<a href="file:///…">`. Encodes spaces and
 *  Windows backslashes via `pathToFileURL`. */
export function fileLinkMd(p: string, label?: string): string {
    const href = pathToFileURL(p).href;
    return `[${label ?? p}](${href})`;
}

/** Same as `fileLinkMd` but emits an HTML anchor for `type: "html"`
 *  displays. */
export function fileLinkHtml(p: string, label?: string): string {
    const href = pathToFileURL(p).href;
    return `<a href="${href}">${label ?? p}</a>`;
}

// =============================================================================
// Default model labels (used for telemetry on optimize runs).
// =============================================================================

export const DEFAULT_MODELS = {
    /** Translator model — whatever the dispatcher's translation config
     *  resolves to. We don't pick; just record. */
    translator: "default",
    /** Model used for hypothesis generation prompts. */
    propose: "gpt-4o",
    /** Model used for case-analyzer classification refinement. */
    classify: "gpt-4o",
} as const;
