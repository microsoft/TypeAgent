// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Process-wide LLM provider mode override.
 *
 * When set, unprefixed `createChatModel` calls (and the settings loaders
 * they go through) get rewritten to route to the active mode's provider
 * and target model. Explicit `azure:` / `openai:` / `ollama:` / `copilot:`
 * prefixes and pre-resolved `ApiSettings` objects bypass the override.
 *
 * The built-in canonical name maps live here as module constants. They
 * are not user-overridable at runtime; users who need different
 * mappings can either pass an explicit prefix at the call site or
 * adjust this file. Per-mode default-model selection still flows
 * through the provider's existing config field (e.g.
 * `copilot.defaultModel`).
 */

export type ProviderMode = "azure" | "openai" | "ollama" | "copilot";

export const PROVIDER_MODES: readonly ProviderMode[] = [
    "azure",
    "openai",
    "ollama",
    "copilot",
] as const;

let active: ProviderMode | undefined;

export function getActiveModelProvider(): ProviderMode | undefined {
    return active;
}

export function setActiveModelProvider(mode: ProviderMode | undefined): void {
    active = mode;
}

/**
 * Canonical TypeAgent identifiers that callers across the codebase
 * pass to `createChatModel`. `"DEFAULT"` represents the no-name case
 * (`createChatModel(undefined, ...)`).
 */
const CANONICAL_NAMES = [
    "DEFAULT",
    "GPT_35_TURBO",
    "GPT_4_O",
    "GPT_5",
    "GPT_5_MINI",
    "GPT_5_NANO",
    "GPT_V",
] as const;

type CanonicalName = (typeof CANONICAL_NAMES)[number];

function isCanonicalName(s: string): s is CanonicalName {
    return (CANONICAL_NAMES as readonly string[]).includes(s);
}

/**
 * Built-in name maps per non-Azure mode. Azure mode is identity — the
 * canonical names already are Azure deployment names, so no rewriting.
 * OpenAI mode is identity for now (callers rarely use OpenAI-specific
 * names; the `openai:LOCAL` form is the explicit escape).
 */
const COPILOT_MAP: Record<CanonicalName, string> = {
    DEFAULT: "claude-sonnet-4.5",
    GPT_35_TURBO: "claude-haiku-4.5",
    GPT_4_O: "gpt-4o",
    GPT_5: "claude-sonnet-4.5",
    GPT_5_MINI: "gpt-4o-mini",
    GPT_5_NANO: "gpt-4o-mini",
    GPT_V: "gpt-4o",
};

const OLLAMA_MAP: Record<CanonicalName, string> = {
    DEFAULT: "llama3.2",
    GPT_35_TURBO: "llama3.2:3b",
    GPT_4_O: "llama3.1",
    GPT_5: "llama3.1:70b",
    GPT_5_MINI: "llama3.2:3b",
    GPT_5_NANO: "llama3.2:1b",
    GPT_V: "llava",
};

/**
 * Resolve a canonical TypeAgent identifier to a target model id for
 * the active provider mode. Unknown identifiers fall back to the
 * mode's `DEFAULT` target.
 */
export function resolveTarget(mode: ProviderMode, canonical: string): string {
    const key = canonical.toUpperCase();
    switch (mode) {
        case "copilot":
            return isCanonicalName(key)
                ? COPILOT_MAP[key]
                : COPILOT_MAP.DEFAULT;
        case "ollama":
            return isCanonicalName(key) ? OLLAMA_MAP[key] : OLLAMA_MAP.DEFAULT;
        case "azure":
        case "openai":
            // Identity: pass the original name through (callers already
            // use Azure-deployment-style names).
            return canonical;
    }
}
