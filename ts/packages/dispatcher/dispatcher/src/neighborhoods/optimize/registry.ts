// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// `LeverPlugin` interface + module-load registry. Each lever owns its own
// hypothesis-generation prompt and sandbox-edit primitives; the case loop
// orchestrates and the registry is the extensibility seam.
//
// To add a new lever: create `levers/<name>.ts` exporting a `LeverPlugin`
// const, add one line to `levers/index.ts`. `--lever <name>` works on the
// CLI; `optimize list-levers` shows it; `explore` includes it in
// hypothesis generation.

import type { ChatModel } from "aiclient";
import type { ActionConfigProvider } from "../../translation/actionConfigProvider.js";
import type {
    AttemptRecord,
    CaseDescription,
    Hypothesis,
} from "./types.js";
import { pmap } from "./util.js";

// =============================================================================
// Contexts
// =============================================================================

export interface ProposeContext {
    /** Factory for chat models. Levers pick a named model — defaults live in
     *  `util.ts:DEFAULT_MODELS`. */
    createModel(name: string): ChatModel;
    /** Bounded-concurrency async map. */
    pmap: typeof pmap;
    /** Run-level workdir (`<workdir>/optimization-run-<ts>/`). Levers
     *  occasionally need to drop scratch files here; most don't. */
    workdir: string;
    /** Attempt-level output directory
     *  (`<workdir>/optimization-run-<ts>/cases/<case-id>/attempts/<id>/`).
     *  Levers write their artifact (`schema.patch`, `manifest.patch`, etc.)
     *  here. */
    outDir: string;
    /** Canonical schema-authoring guidelines. Levers include this in their
     *  hypothesis-generation prompt. */
    schemaGuidelines: string;
}

export interface ApplyContext {
    /** The un-edited live provider. Levers read original schema content
     *  from here to compute checksums and produce minimal diffs. */
    originalProvider: ActionConfigProvider;
    /** Root of the sandbox tree (`<workdir>/optimization-run-<ts>/sandbox/`).
     *  Levers write patched files under `sandbox/agents/<schemaName>/`. */
    sandboxDir: string;
    /** Resolves a schema to its sandbox file paths. Levers use this to
     *  locate the file to edit. */
    schemaSourceLookup(schemaName: string): {
        tsPath?: string;
        pasPath?: string;
        manifestPath: string;
    };
    /** Whole-file SHA-1 checksums of the sandbox's `.original/` snapshot,
     *  keyed by `${schemaName}:schema` or `${schemaName}:manifest`. Levers
     *  verify against this before writing edits — drift between the case
     *  loop's snapshot capture and apply time throws. The case loop
     *  populates this from `CaseDescription.originalChecksum`. */
    checksums: Record<string, string>;
}

export interface ApplyResult {
    /** Absolute paths of files written/modified in the sandbox. */
    filesWritten: string[];
    /** Optional path to a `.patch` file (unified diff vs. the live tree)
     *  the lever produced for operator review. */
    patchPath?: string;
}

// =============================================================================
// LeverPlugin
// =============================================================================

export type LeverConsumes =
    | "neighborhoods"
    | "corpus"
    | "translation"
    | "gravity";

export type LeverProbeType = "translator";

export interface LeverPlugin {
    /** Lowercase, unique. Used as the `--lever` CLI argument and in
     *  `proposal.json`. */
    name: string;
    /** One-line human-readable description. Shown in `list-levers`. */
    description: string;
    /** Which inputs this lever's `proposeHypotheses` consumes. Used by the
     *  pattern miner to attribute signals back to the input source. */
    consumes: LeverConsumes[];
    /** Which probe harness validates this lever's hypotheses. v1: always
     *  "translator". */
    probeType: LeverProbeType;

    /**
     * Generate up to K hypotheses for the given case. `priorAttempts` is
     * empty at depth 0; for depth > 0 the case loop populates it with the
     * prior depth's attempts (used by recursive refinement to nudge the
     * LLM toward a different mechanism).
     */
    proposeHypotheses(
        caseDesc: CaseDescription,
        priorAttempts: AttemptRecord[],
        ctx: ProposeContext,
    ): Promise<Hypothesis[]>;

    /**
     * Apply `hypothesis.payload` to the sandbox. Should verify
     * `caseDesc.originalChecksum` matches the live source before writing
     * (drift guard). Returns the file paths it wrote so the evaluator can
     * log them.
     */
    applyToSandbox(
        hypothesis: Hypothesis,
        ctx: ApplyContext,
    ): Promise<ApplyResult>;
}

// =============================================================================
// Registry
// =============================================================================

const registry = new Map<string, LeverPlugin>();

/** Register a lever. Throws if a lever with the same name is already
 *  registered — duplicate registration is a programming error. */
export function registerLever(lever: LeverPlugin): void {
    if (registry.has(lever.name)) {
        throw new Error(
            `Lever '${lever.name}' is already registered. Each lever name must be unique.`,
        );
    }
    registry.set(lever.name, lever);
}

/** Return a lever by name, or undefined if not registered. */
export function getLever(name: string): LeverPlugin | undefined {
    return registry.get(name);
}

/** Return all registered levers, sorted by name. */
export function listLevers(): LeverPlugin[] {
    return [...registry.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
    );
}

/** Testing-only: clear the registry. Tests register their fixtures, then
 *  call this in afterEach. Production code never calls this. */
export function _clearRegistryForTest(): void {
    registry.clear();
}
