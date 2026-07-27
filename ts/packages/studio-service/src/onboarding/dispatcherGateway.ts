// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Production wiring for the onboarding phase runner.
 *
 * This bridges the pure {@link createOnboardingPhaseRunner} orchestration to a
 * real onboarding-only dispatcher (built lazily on first use) and the
 * onboarding agent's on-disk workspace.
 *
 * Like {@link ./../wildcardValidation}, the dispatcher factory lives in
 * `default-agent-provider` and is loaded by a **lazy, external, dynamic
 * import** — `default-agent-provider` is intentionally NOT a package.json
 * dependency of this service (that would close a studio-service →
 * default-agent-provider → studio-agent → studio-service build cycle). The
 * import resolves from the bundling extension's `node_modules` on the in-repo
 * `typeagent-studio serve` path, and cleanly throws inside the packaged `.vsix`
 * (which ships without `node_modules`) — surfaced as an actionable error the
 * first time a phase runs.
 */

import * as os from "node:os";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import {
    createOnboardingPhaseRunner,
    type OnboardingArtifactReader,
    type OnboardingDispatch,
    type OnboardingPhaseOutputs,
} from "./phaseRunner.js";
import {
    createUtteranceProver,
    type ProveUtteranceOptions,
    type PhrasesReader,
    type UtteranceProofResult,
    type UtteranceTranslate,
    type UtteranceTranslateOutcome,
} from "./utteranceProver.js";
import type {
    OnboardingPhaseName,
    OnboardingState,
} from "@typeagent/core/onboardingBridge";

/** Plain-data outcome shape returned by the dispatcher handle. */
interface DispatchResultLike {
    actions: { actionName: string; schemaName?: string }[];
    error?: string;
}

/** Minimal structural view of the default-agent-provider handle. */
interface OnboardingDispatcherHandleLike {
    submitUtterance(text: string): Promise<DispatchResultLike>;
    submitAction(
        actionName: string,
        parameters: Record<string, unknown>,
    ): Promise<DispatchResultLike>;
    close(): Promise<void>;
}

interface DefaultAgentProviderOnboardingModule {
    createOnboardingOnlyDispatcher(options?: {
        hostName?: string;
    }): Promise<OnboardingDispatcherHandleLike>;
}

let handlePromise: Promise<OnboardingDispatcherHandleLike> | undefined;

/**
 * Build (once) the onboarding-only dispatcher handle by lazily importing
 * `default-agent-provider`. Throws an actionable error when the module can't be
 * resolved (e.g. the packaged extension with `node_modules` stripped).
 */
async function getHandle(): Promise<OnboardingDispatcherHandleLike> {
    if (handlePromise === undefined) {
        handlePromise = (async () => {
            let mod: DefaultAgentProviderOnboardingModule;
            try {
                // Indirect the specifier through a variable so TypeScript does
                // not statically resolve the module (see file header).
                const specifier = "default-agent-provider";
                mod = (await import(
                    specifier
                )) as DefaultAgentProviderOnboardingModule;
            } catch (e) {
                throw new Error(
                    "Onboarding dispatcher is unavailable: could not load " +
                        "'default-agent-provider'. This is expected in a packaged " +
                        "build without node_modules; run the extension against a " +
                        `built repo. (${(e as Error).message})`,
                );
            }
            return mod.createOnboardingOnlyDispatcher();
        })();
    }
    return handlePromise;
}

/** A {@link OnboardingDispatch} backed by the lazy onboarding dispatcher. */
const dispatch: OnboardingDispatch = async (step) => {
    const handle = await getHandle();
    const result =
        step.kind === "utterance"
            ? await handle.submitUtterance(step.text)
            : await handle.submitAction(step.actionName, step.parameters);
    const out: Awaited<ReturnType<OnboardingDispatch>> = {
        actions: result.actions.map((a) => ({ actionName: a.actionName })),
    };
    if (result.error !== undefined) {
        out.error = result.error;
    }
    return out;
};

/** Base directory of the onboarding agent's per-integration workspace. */
function onboardingBaseDir(): string {
    return path.join(os.homedir(), ".typeagent", "onboarding");
}

/**
 * Read a phase artifact from the onboarding workspace
 * (`~/.typeagent/onboarding/<integrationName>/<phaseDir>/<filename>`). Returns
 * undefined when the file is absent.
 */
const readArtifact: OnboardingArtifactReader = async (
    integrationName,
    phaseDir,
    filename,
) => {
    const file = path.join(
        onboardingBaseDir(),
        integrationName,
        phaseDir,
        filename,
    );
    try {
        return await readFile(file, "utf-8");
    } catch {
        return undefined;
    }
};

/**
 * The service's onboarding phase runner: drives each Studio wizard phase through
 * the real onboarding-only dispatcher and reads its artifacts back. Injected
 * into the service's `InMemoryOnboardingBridge`.
 */
export function createServiceOnboardingPhaseRunner(): (
    session: OnboardingState,
    phase: OnboardingPhaseName,
    inputs: unknown,
) => Promise<OnboardingPhaseOutputs> {
    return createOnboardingPhaseRunner({ dispatch, readArtifact });
}

/** Tear down the lazily-built dispatcher, if one was created. */
export async function closeOnboardingDispatcher(): Promise<void> {
    if (handlePromise === undefined) {
        return;
    }
    const pending = handlePromise;
    handlePromise = undefined;
    try {
        const handle = await pending;
        await handle.close();
    } catch {
        // Best-effort teardown.
    }
}

// ---------------------------------------------------------------------------
// t4 — "Try it": prove the generated agent answers a PhraseGen example.
// ---------------------------------------------------------------------------

/** Minimal structural view of the generated-agent translator handle. */
interface GeneratedAgentTranslatorHandleLike {
    translateUtterance(text: string): Promise<{
        actions: { schemaName?: string; actionName?: string }[];
        error?: string;
    }>;
    close(): Promise<void>;
}

interface DefaultAgentProviderTranslatorModule {
    createGeneratedAgentTranslator(options: {
        agentName: string;
        agentDir: string;
        hostName?: string;
    }): Promise<GeneratedAgentTranslatorHandleLike>;
}

/**
 * Lazily import `default-agent-provider` and build a translate-only dispatcher
 * loaded with just the generated agent (see the file header for why the import
 * is indirected and external). Throws an actionable error in a packaged build
 * without `node_modules`.
 */
async function buildGeneratedAgentTranslator(options: {
    agentName: string;
    agentDir: string;
}): Promise<GeneratedAgentTranslatorHandleLike> {
    let mod: DefaultAgentProviderTranslatorModule;
    try {
        const specifier = "default-agent-provider";
        mod = (await import(
            specifier
        )) as DefaultAgentProviderTranslatorModule;
    } catch (e) {
        throw new Error(
            "Generated-agent translator is unavailable: could not load " +
                "'default-agent-provider'. This is expected in a packaged " +
                "build without node_modules; run the extension against a " +
                `built repo. (${(e as Error).message})`,
        );
    }
    return mod.createGeneratedAgentTranslator({
        agentName: options.agentName,
        agentDir: options.agentDir,
    });
}

/**
 * Read the PhraseGen artifact (`phraseGen/phrases.json`) and return its
 * `phrases` map (action name → example utterances), or undefined when it is
 * absent or has no phrases.
 */
const readPhrases: PhrasesReader = async (integrationName) => {
    const raw = await readArtifact(integrationName, "phraseGen", "phrases.json");
    if (raw === undefined) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as {
            phrases?: Record<string, string[]>;
        };
        return parsed.phrases ?? undefined;
    } catch {
        return undefined;
    }
};

/**
 * Build the service's utterance prover for a specific generated agent. The
 * returned function takes the same agent name and proves that a PhraseGen
 * example phrase (or an explicit utterance) resolves to one of the agent's
 * typed actions. Each proof stands up a translate-only dispatcher for the agent
 * and tears it down afterward — a "Try it" click is a single utterance.
 */
export function createServiceUtteranceProver(options: {
    agentName: string;
    agentDir: string;
}): (
    integrationName: string,
    proveOptions?: ProveUtteranceOptions,
) => Promise<UtteranceProofResult> {
    const translate: UtteranceTranslate = async (utterance) => {
        const translator = await buildGeneratedAgentTranslator(options);
        try {
            const result = await translator.translateUtterance(utterance);
            const outcome: UtteranceTranslateOutcome = {
                actions: result.actions.map((a) => {
                    const resolved: { schemaName?: string; actionName?: string } =
                        {};
                    if (a.schemaName !== undefined) {
                        resolved.schemaName = a.schemaName;
                    }
                    if (a.actionName !== undefined) {
                        resolved.actionName = a.actionName;
                    }
                    return resolved;
                }),
            };
            if (result.error !== undefined) {
                outcome.error = result.error;
            }
            return outcome;
        } finally {
            await translator.close();
        }
    };
    return createUtteranceProver({ translate, readPhrases });
}
