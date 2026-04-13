// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { OnboardingActions } from "./onboardingSchema.js";
import { DiscoveryActions } from "./discovery/discoverySchema.js";
import { PhraseGenActions } from "./phraseGen/phraseGenSchema.js";
import { SchemaGenActions } from "./schemaGen/schemaGenSchema.js";
import { GrammarGenActions } from "./grammarGen/grammarGenSchema.js";
import { ScaffolderActions } from "./scaffolder/scaffolderSchema.js";
import { TestingActions } from "./testing/testingSchema.js";
import { PackagingActions } from "./packaging/packagingSchema.js";
import { executeDiscoveryAction } from "./discovery/discoveryHandler.js";
import { executePhraseGenAction } from "./phraseGen/phraseGenHandler.js";
import { executeSchemaGenAction } from "./schemaGen/schemaGenHandler.js";
import { executeGrammarGenAction } from "./grammarGen/grammarGenHandler.js";
import { executeScaffolderAction } from "./scaffolder/scaffolderHandler.js";
import { executeTestingAction } from "./testing/testingHandler.js";
import { executePackagingAction } from "./packaging/packagingHandler.js";
import {
    createWorkspace,
    loadState,
    listIntegrations,
} from "./lib/workspace.js";

type AllActions =
    | OnboardingActions
    | DiscoveryActions
    | PhraseGenActions
    | SchemaGenActions
    | GrammarGenActions
    | ScaffolderActions
    | TestingActions
    | PackagingActions;

export function instantiate(): AppAgent {
    return {
        executeAction,
    };
}

async function executeAction(
    action: TypeAgentAction<AllActions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const { actionName } = action as TypeAgentAction<AllActions>;

    // Top-level coordination actions
    if (
        actionName === "startOnboarding" ||
        actionName === "resumeOnboarding" ||
        actionName === "getOnboardingStatus" ||
        actionName === "listIntegrations"
    ) {
        return executeOnboardingAction(
            action as TypeAgentAction<OnboardingActions>,
            context,
        );
    }

    // Discovery phase
    if (
        actionName === "crawlDocUrl" ||
        actionName === "parseOpenApiSpec" ||
        actionName === "listDiscoveredActions" ||
        actionName === "approveApiSurface"
    ) {
        return executeDiscoveryAction(
            action as TypeAgentAction<DiscoveryActions>,
            context,
        );
    }

    // Phrase generation phase
    if (
        actionName === "generatePhrases" ||
        actionName === "addPhrase" ||
        actionName === "removePhrase" ||
        actionName === "approvePhrases"
    ) {
        return executePhraseGenAction(
            action as TypeAgentAction<PhraseGenActions>,
            context,
        );
    }

    // Schema generation phase
    if (
        actionName === "generateSchema" ||
        actionName === "refineSchema" ||
        actionName === "approveSchema"
    ) {
        return executeSchemaGenAction(
            action as TypeAgentAction<SchemaGenActions>,
            context,
        );
    }

    // Grammar generation phase
    if (
        actionName === "generateGrammar" ||
        actionName === "compileGrammar" ||
        actionName === "approveGrammar"
    ) {
        return executeGrammarGenAction(
            action as TypeAgentAction<GrammarGenActions>,
            context,
        );
    }

    // Scaffolder phase
    if (
        actionName === "scaffoldAgent" ||
        actionName === "scaffoldPlugin" ||
        actionName === "listTemplates"
    ) {
        return executeScaffolderAction(
            action as TypeAgentAction<ScaffolderActions>,
            context,
        );
    }

    // Testing phase
    if (
        actionName === "generateTests" ||
        actionName === "runTests" ||
        actionName === "getTestResults" ||
        actionName === "proposeRepair" ||
        actionName === "approveRepair"
    ) {
        return executeTestingAction(
            action as TypeAgentAction<TestingActions>,
            context,
        );
    }

    // Packaging phase
    if (
        actionName === "packageAgent" ||
        actionName === "validatePackage" ||
        actionName === "generateDemo" ||
        actionName === "generateReadme"
    ) {
        return executePackagingAction(
            action as TypeAgentAction<PackagingActions>,
            context,
        );
    }

    return { error: `Unknown action: ${actionName}` };
}

async function executeOnboardingAction(
    action: TypeAgentAction<OnboardingActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "startOnboarding": {
            const { integrationName, description, apiType } = action.parameters;
            const existing = await loadState(integrationName);
            if (existing) {
                return createActionResultFromTextDisplay(
                    `Integration "${integrationName}" already exists (current phase: ${existing.currentPhase}). Use resumeOnboarding to continue.`,
                );
            }
            await createWorkspace({
                integrationName,
                ...(description !== undefined ? { description } : undefined),
                ...(apiType !== undefined ? { apiType } : undefined),
            });
            return createActionResultFromMarkdownDisplay(
                `## Onboarding started: ${integrationName}\n\n` +
                    `**Next step:** Phase 1 — Discovery\n\n` +
                    `Use \`crawlDocUrl\` or \`parseOpenApiSpec\` to enumerate the API surface.\n\n` +
                    `Workspace: \`~/.typeagent/onboarding/${integrationName}/\``,
            );
        }

        case "resumeOnboarding": {
            const { integrationName, fromPhase } = action.parameters;
            const state = await loadState(integrationName);
            if (!state) {
                return {
                    error: `Integration "${integrationName}" not found. Use startOnboarding to create it.`,
                };
            }
            const phase = fromPhase ?? state.currentPhase;
            return createActionResultFromMarkdownDisplay(
                `## Resuming: ${integrationName}\n\n` +
                    `**Current phase:** ${phase}\n\n` +
                    `${phaseNextStepHint(phase)}`,
            );
        }

        case "getOnboardingStatus": {
            const { integrationName } = action.parameters;
            const state = await loadState(integrationName);
            if (!state) {
                return {
                    error: `Integration "${integrationName}" not found.`,
                };
            }
            const lines = [
                `## ${integrationName} — Onboarding Status`,
                ``,
                `**Current phase:** ${state.currentPhase}`,
                `**Started:** ${state.createdAt}`,
                `**Updated:** ${state.updatedAt}`,
                ``,
                `| Phase | Status |`,
                `|---|---|`,
                ...Object.entries(state.phases).map(
                    ([phase, ps]) =>
                        `| ${phase} | ${statusIcon(ps.status)} ${ps.status} |`,
                ),
            ];
            return createActionResultFromMarkdownDisplay(lines.join("\n"));
        }

        case "listIntegrations": {
            const { status } = action.parameters;
            const names = await listIntegrations();
            if (names.length === 0) {
                return createActionResultFromTextDisplay(
                    "No integrations found. Use startOnboarding to begin.",
                );
            }
            const lines = [`## Integrations`, ``];
            for (const name of names) {
                const state = await loadState(name);
                if (!state) continue;
                if (status === "complete" && state.currentPhase !== "complete")
                    continue;
                if (
                    status === "in-progress" &&
                    state.currentPhase === "complete"
                )
                    continue;
                lines.push(
                    `- **${name}** — ${state.currentPhase} (updated ${state.updatedAt})`,
                );
            }
            return createActionResultFromMarkdownDisplay(lines.join("\n"));
        }
    }
}

function phaseNextStepHint(phase: string): string {
    const hints: Record<string, string> = {
        discovery:
            "Use `crawlDocUrl` or `parseOpenApiSpec` to enumerate the API surface.",
        phraseGen:
            "Use `generatePhrases` to create natural language samples for each action.",
        schemaGen:
            "Use `generateSchema` to produce the TypeScript action schema.",
        grammarGen:
            "Use `generateGrammar` to produce the .agr grammar file, then `compileGrammar` to validate.",
        scaffolder:
            "Use `scaffoldAgent` to stamp out the agent package infrastructure.",
        testing:
            "Use `generateTests` then `runTests` to validate phrase-to-action mapping.",
        packaging: "Use `packageAgent` to prepare the agent for distribution.",
        complete: "Onboarding is complete.",
    };
    return hints[phase] ?? "";
}

function statusIcon(status: string): string {
    switch (status) {
        case "pending":
            return "⏳";
        case "in-progress":
            return "🔄";
        case "approved":
            return "✅";
        case "skipped":
            return "⏭️";
        default:
            return "❓";
    }
}
