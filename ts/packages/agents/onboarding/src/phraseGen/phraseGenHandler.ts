// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 2 — Phrase Generation handler.
// Generates natural language sample phrases for each discovered action
// using an LLM, saved to ~/.typeagent/onboarding/<name>/phraseGen/phrases.json

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { PhraseGenActions } from "./phraseGenSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifactJson,
    readArtifactJson,
} from "../lib/workspace.js";
import { getPhraseGenModel } from "../lib/llm.js";
import { ApiSurface, DiscoveredAction } from "../discovery/discoveryHandler.js";

export type PhraseSet = {
    integrationName: string;
    generatedAt: string;
    // Map from actionName to array of sample phrases
    phrases: Record<string, string[]>;
    approved?: boolean;
    approvedAt?: string;
};

export async function executePhraseGenAction(
    action: TypeAgentAction<PhraseGenActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generatePhrases":
            return handleGeneratePhrases(
                action.parameters.integrationName,
                action.parameters.phrasesPerAction ?? 5,
                action.parameters.forActions,
            );

        case "addPhrase":
            return handleAddPhrase(
                action.parameters.integrationName,
                action.parameters.actionName,
                action.parameters.phrase,
            );

        case "removePhrase":
            return handleRemovePhrase(
                action.parameters.integrationName,
                action.parameters.actionName,
                action.parameters.phrase,
            );

        case "approvePhrases":
            return handleApprovePhrases(action.parameters.integrationName);
    }
}

async function handleGeneratePhrases(
    integrationName: string,
    phrasesPerAction: number,
    forActions?: string[],
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) {
        return { error: `Integration "${integrationName}" not found.` };
    }
    if (state.phases.discovery.status !== "approved") {
        return {
            error: `Discovery phase must be approved before generating phrases. Run approveApiSurface first.`,
        };
    }

    const surface = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    if (!surface) {
        return { error: `No API surface found for "${integrationName}".` };
    }

    await updatePhase(integrationName, "phraseGen", { status: "in-progress" });

    const model = getPhraseGenModel();
    const existing = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    const phraseMap: Record<string, string[]> = existing?.phrases ?? {};

    const actionsToProcess = forActions
        ? surface.actions.filter((a) => forActions.includes(a.name))
        : surface.actions;

    for (const discoveredAction of actionsToProcess) {
        const prompt = buildPhrasePrompt(
            integrationName,
            discoveredAction,
            phrasesPerAction,
            state.config.description,
        );
        const result = await model.complete(prompt);
        if (!result.success) continue;

        const phrases = extractPhraseList(result.data);
        phraseMap[discoveredAction.name] = [
            ...(phraseMap[discoveredAction.name] ?? []),
            ...phrases,
        ];
    }

    const phraseSet: PhraseSet = {
        integrationName,
        generatedAt: new Date().toISOString(),
        phrases: phraseMap,
    };

    await writeArtifactJson(
        integrationName,
        "phraseGen",
        "phrases.json",
        phraseSet,
    );

    const totalPhrases = Object.values(phraseMap).reduce(
        (sum, p) => sum + p.length,
        0,
    );

    return createActionResultFromMarkdownDisplay(
        `## Phrases generated: ${integrationName}\n\n` +
            `**Actions covered:** ${Object.keys(phraseMap).length}\n` +
            `**Total phrases:** ${totalPhrases}\n\n` +
            Object.entries(phraseMap)
                .slice(0, 10)
                .map(
                    ([name, phrases]) =>
                        `**${name}:**\n` +
                        phrases.map((p) => `  - "${p}"`).join("\n"),
                )
                .join("\n\n") +
            (Object.keys(phraseMap).length > 10
                ? `\n\n_...and ${Object.keys(phraseMap).length - 10} more actions_`
                : "") +
            `\n\nReview, add/remove phrases as needed, then \`approvePhrases\` to proceed.`,
    );
}

async function handleAddPhrase(
    integrationName: string,
    actionName: string,
    phrase: string,
): Promise<ActionResult> {
    const existing = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    const phraseMap = existing?.phrases ?? {};
    if (!phraseMap[actionName]) phraseMap[actionName] = [];
    if (!phraseMap[actionName].includes(phrase)) {
        phraseMap[actionName].push(phrase);
    }

    await writeArtifactJson(integrationName, "phraseGen", "phrases.json", {
        ...(existing ?? {
            integrationName,
            generatedAt: new Date().toISOString(),
        }),
        phrases: phraseMap,
    });

    return createActionResultFromTextDisplay(
        `Added phrase "${phrase}" to action "${actionName}" for ${integrationName}.`,
    );
}

async function handleRemovePhrase(
    integrationName: string,
    actionName: string,
    phrase: string,
): Promise<ActionResult> {
    const existing = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    if (!existing) {
        return { error: `No phrases found for "${integrationName}".` };
    }

    const phrases = existing.phrases[actionName] ?? [];
    existing.phrases[actionName] = phrases.filter((p) => p !== phrase);
    await writeArtifactJson(
        integrationName,
        "phraseGen",
        "phrases.json",
        existing,
    );

    return createActionResultFromTextDisplay(
        `Removed phrase "${phrase}" from action "${actionName}" for ${integrationName}.`,
    );
}

async function handleApprovePhrases(
    integrationName: string,
): Promise<ActionResult> {
    const phraseSet = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    if (!phraseSet) {
        return {
            error: `No phrases found for "${integrationName}". Run generatePhrases first.`,
        };
    }

    const updated: PhraseSet = {
        ...phraseSet,
        approved: true,
        approvedAt: new Date().toISOString(),
    };

    await writeArtifactJson(
        integrationName,
        "phraseGen",
        "phrases.json",
        updated,
    );
    await updatePhase(integrationName, "phraseGen", { status: "approved" });

    const totalPhrases = Object.values(phraseSet.phrases).reduce(
        (sum, p) => sum + p.length,
        0,
    );

    return createActionResultFromMarkdownDisplay(
        `## Phrases approved: ${integrationName}\n\n` +
            `**Actions:** ${Object.keys(phraseSet.phrases).length}\n` +
            `**Total phrases:** ${totalPhrases}\n\n` +
            `**Next step:** Phase 3 — use \`generateSchema\` to produce the TypeScript action schema.`,
    );
}

function buildPhrasePrompt(
    integrationName: string,
    action: DiscoveredAction,
    count: number,
    appDescription?: string,
): { role: "system" | "user"; content: string }[] {
    return [
        {
            role: "system",
            content:
                "You are a UX writer generating natural language phrases that users would say to an AI assistant to perform an API action. " +
                "Produce varied, conversational phrases — include different phrasings, politeness levels, and levels of specificity. " +
                "Return a JSON array of strings.",
        },
        {
            role: "user",
            content:
                `Generate ${count} distinct natural language phrases a user would say to perform this action in ${integrationName}` +
                (appDescription ? ` (${appDescription})` : "") +
                `.\n\n` +
                `Action: ${action.name}\n` +
                `Description: ${action.description}\n` +
                (action.parameters?.length
                    ? `Parameters: ${action.parameters.map((p) => `${p.name} (${p.type})`).join(", ")}`
                    : "") +
                `\n\nReturn only a JSON array of strings.`,
        },
    ];
}

function extractPhraseList(llmResponse: string): string[] {
    try {
        const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed)) {
                return parsed.filter((p) => typeof p === "string");
            }
        }
    } catch {}
    // Fallback: extract quoted strings
    return [...llmResponse.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
