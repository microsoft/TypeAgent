// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Onboarding phase-runner adapter.
 *
 * This is the orchestration half of onboarding channelization: it turns a
 * Studio wizard phase into the concrete sequence of
 * `onboarding-agent` actions that produce the on-disk artifacts, keyed to the
 * session's chosen agent name. The heavy machinery (an onboarding-only
 * dispatcher) is injected as a plain {@link OnboardingDispatch} function so this
 * module stays pure and unit-testable with a stub — no LLM, network, or
 * dispatcher required in tests.
 *
 * Two dispatch shapes are used:
 *  - Discovery translates the user's free-text description into a source action
 *    ({@link DISCOVERY_SOURCE_ACTIONS}) via natural language, then approves it.
 *    Success is detected by reading the on-disk `api-surface.json` artifact — the
 *    dispatcher's reported `actions` are unreliable in the service's
 *    silent/headless mode (empty even when the crawl ran), so the artifact is the
 *    source of truth. NL translation is occasionally nondeterministic (the LLM
 *    may re-pick `startOnboarding`), so when it yields no source artifact we fall
 *    back to a deterministic {@link extractDiscoverySource} of the description
 *    and dispatch the typed crawl action directly. If neither produces a source,
 *    the description carried no crawlable API and we surface a clear, actionable
 *    error (the design's "error if none exists").
 *  - Phases 2–7 are deterministic parameterized actions, so they are dispatched
 *    directly (no NL translation) to avoid model nondeterminism.
 */

import type {
    OnboardingPhaseName,
    OnboardingState,
} from "@typeagent/core/onboardingBridge";

/**
 * On-disk phase directory name used by `onboarding-agent`'s workspace
 * (`~/.typeagent/onboarding/<integrationName>/<dir>/`). These are the
 * lowercased phase names; Studio's {@link OnboardingPhaseName} is capitalized.
 */
export type OnboardingPhaseDir =
    | "discovery"
    | "phraseGen"
    | "schemaGen"
    | "grammarGen"
    | "scaffolder"
    | "testing"
    | "packaging";

/** A single action the dispatcher reported executing for a command. */
export interface OnboardingActionResult {
    actionName: string;
    schemaName?: string;
}

/**
 * A normalized unit of work handed to the injected dispatcher. `utterance`
 * requests natural-language translation + execution; `action` requests direct
 * execution of a known, typed onboarding action.
 */
export type OnboardingDispatchStep =
    | { kind: "utterance"; text: string }
    | {
          kind: "action";
          actionName: string;
          parameters: Record<string, unknown>;
      };

/** The dispatcher's report for one dispatched step. */
export interface OnboardingDispatchOutcome {
    /** Actions the dispatcher actually executed (empty if none). */
    actions: OnboardingActionResult[];
    /** Set when the command failed; halts the phase with this message. */
    error?: string;
}

export type OnboardingDispatch = (
    step: OnboardingDispatchStep,
) => Promise<OnboardingDispatchOutcome>;

export type OnboardingArtifactReader = (
    integrationName: string,
    phaseDir: OnboardingPhaseDir,
    filename: string,
) => Promise<string | undefined>;

export interface OnboardingPhaseRunnerDeps {
    dispatch: OnboardingDispatch;
    readArtifact: OnboardingArtifactReader;
    now?: () => number;
}

/** Structured result stored as a Studio phase's `outputs`. */
export interface OnboardingPhaseOutputs {
    phase: OnboardingPhaseName;
    integrationName: string;
    /** Names of the actions the dispatcher executed, in order. */
    actions: string[];
    /** Parsed JSON (when the artifact is JSON) or the raw text of the artifact. */
    artifact?: unknown | undefined;
    /** The artifact filename that was read back, when present. */
    artifactFile?: string | undefined;
    generatedAt: number;
}

/**
 * Discovery source actions — the natural-language description must translate to
 * one of these (each writes `discovery/api-surface.json`), otherwise there is
 * nothing to build an agent from. Kept as documentation of the contract;
 * detection itself is artifact-based (see {@link runDiscovery}).
 */
export const DISCOVERY_SOURCE_ACTIONS: ReadonlySet<string> = new Set([
    "crawlDocUrl",
    "parseOpenApiSpec",
    "crawlCliHelp",
]);

/** Minimal shape of `discovery/api-surface.json` we depend on. */
interface ApiSurface {
    actions?: unknown[];
}

/**
 * Report the action names the dispatcher executed, falling back to the requested
 * action name when it reports none. The dispatcher's `actions` are unreliable in
 * the service's silent/headless mode (often empty even when the action ran), so
 * for typed actions we know the name we asked for and can name it deterministically.
 */
function namesOrFallback(
    outcome: OnboardingDispatchOutcome,
    requested: string,
): string[] {
    const names = outcome.actions.map((a) => a.actionName);
    return names.length > 0 ? names : [requested];
}

interface PhasePlan {
    dir: OnboardingPhaseDir;
    /** Primary artifact read back as the phase's output, if any. */
    artifactFile?: string;
    /** Parse the artifact as JSON when reading it back. */
    artifactJson?: boolean;
}

const PHASE_PLANS: Record<OnboardingPhaseName, PhasePlan> = {
    Discovery: {
        dir: "discovery",
        artifactFile: "api-surface.json",
        artifactJson: true,
    },
    PhraseGen: {
        dir: "phraseGen",
        artifactFile: "phrases.json",
        artifactJson: true,
    },
    SchemaGen: { dir: "schemaGen", artifactFile: "schema.ts" },
    GrammarGen: { dir: "grammarGen", artifactFile: "schema.agr" },
    Scaffolder: { dir: "scaffolder", artifactFile: "scaffolded-to.txt" },
    Testing: {
        dir: "testing",
        artifactFile: "test-results.json",
        artifactJson: true,
    },
    Packaging: { dir: "packaging" },
};

function action(
    actionName: string,
    integrationName: string,
): OnboardingDispatchStep {
    return { kind: "action", actionName, parameters: { integrationName } };
}

/**
 * The deterministic action sequence for phases 2–7 (Discovery is handled
 * separately because it requires NL translation of the description). Every
 * action is keyed to the session's agent name so the whole walk targets one
 * workspace.
 */
function deterministicSteps(
    phase: OnboardingPhaseName,
    integrationName: string,
): OnboardingDispatchStep[] {
    switch (phase) {
        case "PhraseGen":
            return [
                action("generatePhrases", integrationName),
                action("approvePhrases", integrationName),
            ];
        case "SchemaGen":
            return [
                action("generateSchema", integrationName),
                action("approveSchema", integrationName),
            ];
        case "GrammarGen":
            return [
                action("generateGrammar", integrationName),
                action("compileGrammar", integrationName),
                action("approveGrammar", integrationName),
            ];
        case "Scaffolder":
            return [action("scaffoldAgent", integrationName)];
        case "Testing":
            return [
                action("generateTests", integrationName),
                action("runTests", integrationName),
            ];
        case "Packaging":
            return [
                action("packageAgent", integrationName),
                action("validatePackage", integrationName),
            ];
        default:
            return [];
    }
}

/**
 * Build the Discovery utterance. The exact agent name is embedded so the
 * translated action targets the session's workspace (the onboarding discovery
 * schema requires an explicit `integrationName` on every action); the
 * description carries the API source (doc URL / OpenAPI spec / CLI command).
 */
export function buildDiscoveryUtterance(
    agentName: string,
    description: string,
): string {
    return `Crawl the API documentation to enumerate the available actions for the integration "${agentName}". ${description}`;
}

/**
 * Deterministically extract an API source from the free-text description and map
 * it to the concrete discovery action that consumes it. This is the fallback for
 * when NL translation does not select a crawl action: the LLM is occasionally
 * distracted by the just-created integration workspace and re-picks
 * `startOnboarding` instead, which would leave Discovery with no api-surface.
 * Returns the typed discovery step to dispatch, or undefined when the
 * description contains no recognizable source (a doc/spec URL or a CLI command).
 */
export function extractDiscoverySource(
    integrationName: string,
    description: string,
): Extract<OnboardingDispatchStep, { kind: "action" }> | undefined {
    const urlMatch = description.match(/https?:\/\/[^\s)>\]]+/i);
    if (urlMatch) {
        // Trim trailing sentence punctuation the regex may have captured.
        const url = urlMatch[0].replace(/[.,;:'"]+$/, "");
        const isSpec =
            /openapi|swagger|\.ya?ml(?:[?#]|$)|\.json(?:[?#]|$)/i.test(url);
        return isSpec
            ? {
                  kind: "action",
                  actionName: "parseOpenApiSpec",
                  parameters: { integrationName, specSource: url },
              }
            : {
                  kind: "action",
                  actionName: "crawlDocUrl",
                  parameters: { integrationName, url },
              };
    }
    // A CLI source: "<cmd> --help" or an explicit "CLI command <cmd>".
    const command =
        description.match(/\b([a-z][\w.-]*)\s+--help\b/i)?.[1] ??
        description.match(
            /\bCLI(?:\s+(?:command|tool))?\s+[`"]?([a-z][\w.-]*)[`"]?/i,
        )?.[1];
    if (command) {
        return {
            kind: "action",
            actionName: "crawlCliHelp",
            parameters: { integrationName, command },
        };
    }
    return undefined;
}

function safeJsonParse(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/**
 * Read and parse `discovery/api-surface.json`, returning the number of
 * discovered actions (0 when the file is absent, unparseable, or has no
 * actions). This is the authoritative signal that Discovery found a source.
 */
async function discoveredActionCount(
    session: OnboardingState,
    deps: OnboardingPhaseRunnerDeps,
): Promise<number> {
    const raw = await deps.readArtifact(
        session.agentName,
        "discovery",
        "api-surface.json",
    );
    if (raw === undefined) {
        return 0;
    }
    const parsed = safeJsonParse(raw);
    if (parsed === null || typeof parsed !== "object") {
        return 0;
    }
    const actions = (parsed as ApiSurface).actions;
    return Array.isArray(actions) ? actions.length : 0;
}

/**
 * The actionable error surfaced when Discovery cannot find an API source to
 * build the agent from — either the description contained none, or the crawl
 * produced no usable actions.
 */
function noApiSourceError(integrationName: string): Error {
    return new Error(
        `Discovery could not find an API source in the description for ` +
            `"${integrationName}". Include a documentation URL, an ` +
            `OpenAPI/Swagger spec URL, or a CLI command whose --help output ` +
            `can be crawled, then run Discovery again.`,
    );
}

async function runDiscovery(
    session: OnboardingState,
    deps: OnboardingPhaseRunnerDeps,
): Promise<string[]> {
    const integrationName = session.agentName;

    // 1. The onboarding agent requires the integration workspace to exist before
    // any discovery/phase action runs — every phase handler fails with
    // 'Integration "<name>" not found. Run startOnboarding first.' otherwise.
    // startOnboarding creates that workspace (seeded with the description so the
    // agent can pick appropriate templates) and is idempotent: if the workspace
    // already exists it returns a success message rather than an error, so it is
    // safe to run at the top of Discovery on every (re-)run.
    const started = await deps.dispatch({
        kind: "action",
        actionName: "startOnboarding",
        parameters: { integrationName, description: session.description },
    });
    if (started.error) {
        throw new Error(`startOnboarding failed: ${started.error}`);
    }
    const executed = namesOrFallback(started, "startOnboarding");

    // 2. Translate the free-text description into a source action (crawlDocUrl /
    // parseOpenApiSpec / crawlCliHelp) via natural language; the handler writes
    // discovery/api-surface.json. This is best-effort: NL is nondeterministic
    // and may report a benign "cancelled" (the LLM asked to clarify or re-picked
    // startOnboarding) — that is NOT a hard failure, so we don't throw here. The
    // artifact check plus the deterministic fallback below are the real gate; the
    // translation error is only surfaced if neither produces a surface (so a
    // genuine auth/key error is not swallowed).
    const translated = await deps.dispatch({
        kind: "utterance",
        text: buildDiscoveryUtterance(integrationName, session.description),
    });
    executed.push(...translated.actions.map((a) => a.actionName));

    // 3. Confirm a source was actually discovered by reading the on-disk
    // artifact. The dispatcher's reported `actions` are unreliable in the
    // service's silent/headless mode (empty even when the crawl ran), so
    // api-surface.json is the source of truth.
    let count = await discoveredActionCount(session, deps);
    if (count === 0) {
        // NL translation did not produce a surface (it re-picked startOnboarding,
        // asked to clarify, or was cancelled). Fall back to a deterministic
        // extraction of the source from the description and dispatch the typed
        // crawl action directly.
        const fallback = extractDiscoverySource(
            integrationName,
            session.description,
        );
        if (fallback !== undefined) {
            const crawled = await deps.dispatch(fallback);
            if (crawled.error) {
                throw new Error(
                    `${fallback.actionName} failed: ${crawled.error}`,
                );
            }
            executed.push(...namesOrFallback(crawled, fallback.actionName));
            count = await discoveredActionCount(session, deps);
        }
        if (count === 0) {
            // Neither NL nor the deterministic fallback produced an API surface.
            // If NL reported an error (e.g. an auth/key failure), surface it;
            // otherwise the description simply carried no crawlable source.
            if (translated.error) {
                throw new Error(
                    `Discovery translation failed: ${translated.error}`,
                );
            }
            throw noApiSourceError(integrationName);
        }
    }

    // 4. Approve the discovered surface (marks state.json discovery -> approved).
    const approve = await deps.dispatch(
        action("approveApiSurface", integrationName),
    );
    if (approve.error) {
        throw new Error(`approveApiSurface failed: ${approve.error}`);
    }
    executed.push(...namesOrFallback(approve, "approveApiSurface"));
    return executed;
}

/**
 * Create the phase runner injected into the service's onboarding bridge
 * (`new InMemoryOnboardingBridge({ phaseRunner })`). The returned function
 * matches the bridge's `phaseRunner(session, phase, inputs)` contract; its
 * return value is stored as the phase's `outputs`.
 */
export function createOnboardingPhaseRunner(
    deps: OnboardingPhaseRunnerDeps,
): (
    session: OnboardingState,
    phase: OnboardingPhaseName,
    inputs: unknown,
) => Promise<OnboardingPhaseOutputs> {
    const now = deps.now ?? Date.now;
    return async (session, phase) => {
        const plan = PHASE_PLANS[phase];
        if (plan === undefined) {
            throw new Error(`Unknown onboarding phase: ${String(phase)}`);
        }
        const integrationName = session.agentName;

        let actions: string[];
        if (phase === "Discovery") {
            actions = await runDiscovery(session, deps);
        } else {
            actions = [];
            for (const step of deterministicSteps(phase, integrationName)) {
                const outcome = await deps.dispatch(step);
                if (outcome.error) {
                    throw new Error(
                        `${step.kind === "action" ? step.actionName : "command"} failed: ${outcome.error}`,
                    );
                }
                actions.push(
                    ...namesOrFallback(
                        outcome,
                        step.kind === "action" ? step.actionName : "command",
                    ),
                );
            }
        }

        let artifact: unknown;
        let artifactFile: string | undefined;
        if (plan.artifactFile !== undefined) {
            const raw = await deps.readArtifact(
                integrationName,
                plan.dir,
                plan.artifactFile,
            );
            if (raw !== undefined) {
                artifactFile = plan.artifactFile;
                artifact = plan.artifactJson ? safeJsonParse(raw) : raw;
            }
        }

        return {
            phase,
            integrationName,
            actions,
            artifact,
            artifactFile,
            generatedAt: now(),
        };
    };
}
