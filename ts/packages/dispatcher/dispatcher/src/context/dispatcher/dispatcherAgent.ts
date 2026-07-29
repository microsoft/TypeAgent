// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import { RequestCommandHandler } from "./handlers/requestCommandHandler.js";
import { TranslateCommandHandler } from "./handlers/translateCommandHandler.js";
import { ExplainCommandHandler } from "./handlers/explainCommandHandler.js";
import {
    ActionContext,
    ActionResult,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../commandHandlerContext.js";
import {
    createActionResultFromError,
    createActionResultFromMarkdownDisplay,
    createActionResultFromTextDisplay,
    createActionResultNoDisplay,
    createPickRememberChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { DispatcherActions } from "./schema/dispatcherActionSchema.js";
import {
    ClarifyRequestAction,
    ClarifyMultipleAgentMatches,
    ClarifyUnresolvedReference,
} from "./schema/clarifyActionSchema.js";
import { loadAgentJsonTranslator } from "../../translation/agentTranslators.js";
import { lookupAndAnswer } from "../../search/search.js";
import {
    LookupAction,
    LookupActivity,
    LookupAndAnswerConversation,
} from "./schema/lookupActionSchema.js";
import { translateRequest } from "../../translation/translateRequest.js";
import { ActivityActions } from "./schema/activityActionSchema.js";
import { ClarifyEntityAction } from "../../execute/pendingActions.js";
import { MatchCommandHandler } from "./handlers/matchCommandHandler.js";
import { DispatcherEmoji } from "./dispatcherUtils.js";
import { getHistoryContext } from "../../translation/interpretRequest.js";
import { processCommandNoLock } from "../../command/command.js";
import { PreferenceMember } from "../collisionPreferences.js";
import { ReasoningAction } from "./schema/reasoningActionSchema.js";
import {
    executeReasoningAction as executeClaudeReasoningAction,
    executeReasoning as executeClaudeReasoning,
} from "../../reasoning/claude.js";
import {
    executeReasoningAction as executeCopilotReasoningAction,
    executeReasoning as executeCopilotReasoning,
} from "../../reasoning/copilot.js";
import { ReasonCommandHandler } from "./handlers/reasonCommandHandler.js";
import registerDebug from "debug";

const debugConversationAnswer = registerDebug(
    "typeagent:dispatcher:conversationAnswer",
);

const dispatcherHandlers: CommandHandlerTable = {
    description: "Type Agent Dispatcher Commands",
    commands: {
        request: new RequestCommandHandler(),
        match: new MatchCommandHandler(),
        translate: new TranslateCommandHandler(),
        reason: new ReasonCommandHandler(),
        reasoning: new ReasonCommandHandler(),
        explain: new ExplainCommandHandler(),
    },
};

/**
 * Run the configured reasoning engine to answer a request. Returns undefined
 * when reasoning is unavailable — either disabled for this request
 * (noReasoning) or the engine is set to "none" — so callers can fall back to
 * another path. Sets the engine-specific display icon for the duration of the
 * call so reasoning bubbles show the engine brand instead of the dispatcher.
 */
async function runReasoningFallback(
    context: ActionContext<CommandHandlerContext>,
    request: string,
): Promise<ActionResult | undefined> {
    const systemContext = context.sessionContext.agentContext;
    const engine = systemContext.session.getConfig().execution.reasoning;
    if (systemContext.noReasoning || engine === "none") {
        return undefined;
    }
    const reasoningIcons: Record<string, string> = {
        claude: "\uD83E\uDDE0",
        copilot: "\u2728",
    };
    systemContext.reasoningSourceIcon = reasoningIcons[engine] ?? undefined;
    const reason =
        engine === "copilot" ? executeCopilotReasoning : executeClaudeReasoning;
    try {
        return await reason(request, context);
    } finally {
        systemContext.reasoningSourceIcon = undefined;
    }
}

async function executeDispatcherAction(
    action: TypeAgentAction<
        | DispatcherActions
        | ClarifyRequestAction
        | LookupAction
        | LookupActivity
        | ActivityActions
        | ClarifyEntityAction
        | ReasoningAction
    >,
    context: ActionContext<CommandHandlerContext>,
) {
    switch (action.schemaName) {
        case "dispatcher.clarify":
            switch (action.actionName) {
                case "clarifyMultiplePossibleActionName":
                case "clarifyMissingParameter":
                    return clarifyRequestAction(action, context);
                case "clarifyMultipleAgentMatches":
                    return clarifyAgentMatchesAction(action, context);
                case "clarifyUnresolvedReference":
                    const result = await clarifyWithLookup(action, context);
                    // If we fail to clarify with lookup, just ask the user.
                    return result ?? clarifyRequestAction(action, context);
                case "clarifyEntities":
                    return clarifyEntityAction(action, context);
            }
            break;
        case "dispatcher.lookup":
            switch (action.actionName) {
                case "lookupAndAnswerConversation": {
                    const systemContext = context.sessionContext.agentContext;
                    const config = systemContext.session.getConfig();
                    const strategy = config.execution.conversationAnswer;
                    const reasoningAvailable =
                        !systemContext.noReasoning &&
                        config.execution.reasoning !== "none";

                    // reasoning-first / reasoning-only: hand the request to the
                    // reasoning agent, which already receives recent chat
                    // context in-prompt and can call search_memory on demand.
                    // If reasoning throws, degrade to the resilient lookup path
                    // below rather than surfacing a raw error.
                    //
                    // TODO (deferred): "conditional-eager" hybrid — best-effort
                    // pre-run the conversation-memory lookup here using the
                    // translator's structured `question`, and inject the answer
                    // into the reasoning prompt only on success (swallowing
                    // errors), so reasoning-first does not depend on the agent
                    // remembering to call search_memory. Revisit if measurement
                    // shows the agent under-uses memory for older history.
                    let reasoningTried = false;
                    let reasoningError: unknown;
                    if (strategy !== "lookup" && reasoningAvailable) {
                        reasoningTried = true;
                        try {
                            return await runReasoningFallback(
                                context,
                                action.parameters.originalRequest,
                            );
                        } catch (e) {
                            // Reasoning is the primary path for this strategy
                            // but it failed (e.g. the engine is unreachable or
                            // needs re-authentication). Remember the error so we
                            // can surface it if the lookup fallback also can't
                            // answer, and degrade to the lookup meanwhile.
                            reasoningError = e;
                            debugConversationAnswer(
                                `reasoning-first failed; falling back to conversation lookup: ${
                                    e instanceof Error ? e.message : String(e)
                                }`,
                            );
                        }
                    }

                    // lookup mode, or a fallback when reasoning is unavailable
                    // or threw: run the conversation-memory lookup, but never
                    // let a transient failure surface raw — treat a thrown
                    // error the same as a returned error result and fall back
                    // to reasoning when it has not already been tried.
                    let lookupResult: ActionResult;
                    try {
                        lookupResult = await lookupAndAnswer(action, context);
                    } catch (e) {
                        lookupResult = createActionResultFromError(
                            e instanceof Error ? e.message : String(e),
                        );
                    }
                    if (lookupResult.error !== undefined) {
                        if (reasoningAvailable && !reasoningTried) {
                            const reasoningResult = await runReasoningFallback(
                                context,
                                action.parameters.originalRequest,
                            );
                            if (reasoningResult !== undefined) {
                                return reasoningResult;
                            }
                        }
                        // If reasoning was the intended primary path and it
                        // threw, surface that failure (the real problem)
                        // instead of the lookup's misleading "not answered".
                        if (reasoningError !== undefined) {
                            return createActionResultFromError(
                                `Reasoning failed: ${
                                    reasoningError instanceof Error
                                        ? reasoningError.message
                                        : String(reasoningError)
                                }`,
                            );
                        }
                    }
                    return lookupResult;
                }
                case "startLookup":
                    const location =
                        action.parameters.lookup.source === "internet"
                            ? action.parameters.lookup.site !== undefined
                                ? `on internet sites ${action.parameters.lookup.site.join(", ")}`
                                : `on the internet`
                            : `in the conversation`;

                    const displayText = `Ok. What do you want to look up ${location}?`;
                    const result = createActionResultFromTextDisplay(
                        displayText,
                        displayText,
                    );
                    // TODO: formalize the schema for activityContext
                    result.activityContext = {
                        activityName: "lookup",
                        description: `Looking up ${location}`,
                        state: {
                            ...action.parameters.lookup,
                        },
                    };
                    return result;
            }
            break;
        case "dispatcher.activity":
            switch (action.actionName) {
                case "exitActivity":
                    const result =
                        createActionResultFromTextDisplay("Ok.  What's next?");

                    const systemContext = context.sessionContext.agentContext;
                    const endAction =
                        systemContext.activityContext?.activityEndAction;
                    if (endAction !== undefined) {
                        result.additionalActions = [endAction];
                    }
                    result.activityContext = null; // clear the activity context.

                    return result;
            }
            break;
        case "dispatcher.reasoning":
            if (action.actionName === "reasoningAction") {
                const systemContext = context.sessionContext.agentContext;
                const config = systemContext.session.getConfig();
                const engine = config.execution.reasoning;

                // Map reasoning engine to a display icon so reasoning
                // bubbles show the engine brand instead of the dispatcher 🤖.
                const reasoningIcons: Record<string, string> = {
                    claude: "🧠",
                    copilot: "✨",
                };
                systemContext.reasoningSourceIcon =
                    reasoningIcons[engine] ?? undefined;

                try {
                    switch (engine) {
                        case "claude":
                            return await executeClaudeReasoningAction(
                                action,
                                context,
                            );
                        case "copilot":
                            return await executeCopilotReasoningAction(
                                action,
                                context,
                            );
                        default:
                            throw new Error(
                                `Unsupported reasoning engine: ${engine}`,
                            );
                    }
                } finally {
                    systemContext.reasoningSourceIcon = undefined;
                }
            }
            break;
    }

    throw new Error(
        `Unknown dispatcher action: ${action.schemaName}.${action.actionName}`,
    );
}

function clarifyRequestAction(
    action: ClarifyRequestAction,
    context: ActionContext<CommandHandlerContext>,
) {
    const { request, clarifyingQuestion } = action.parameters;
    context.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: clarifyingQuestion,
    });

    const result = createActionResultNoDisplay(clarifyingQuestion);
    result.additionalInstructions = [
        `Asked the user to clarify the request '${request}'`,
    ];
    return result;
}

// Interactive cross-agent collision clarify. When the two-tier
// `preference-clarify` feature is enabled, render a single card with the
// candidate (schema, action) options plus a "remember this" checkbox instead
// of a text question. Picking a candidate auto-executes it (the original
// request is re-run, pinned to the chosen schema via a one-shot override);
// checking "remember" persists the pick as a learned preference so Tier 1
// resolves it silently next time. Falls back to the plain text clarify when
// the feature is off, learning is disabled, or there are no candidates.
function clarifyAgentMatchesAction(
    action: ClarifyMultipleAgentMatches,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    const cfg = systemContext.session.getConfig().collision.preference;
    const { request, candidates, clarifyingQuestion } = action.parameters;

    if (!cfg.enabled || cfg.remember === "never" || candidates.length === 0) {
        return clarifyRequestAction(action, context);
    }

    const members: PreferenceMember[] = candidates.map((c) => ({
        schemaName: c.schemaName,
        actionName: c.actionName,
    }));
    // The radio list below already shows each option, so drop the numbered
    // list that buildClarifyMultipleAgentMatches embeds in the question and
    // keep only the prompt line. Scores (when present) move onto the labels.
    const question = clarifyingQuestion.split("\n")[0];
    const choiceLabels = candidates.map((c) =>
        c.score !== undefined
            ? `${c.schemaName} → ${c.actionName}  (${c.score.toFixed(2)})`
            : `${c.schemaName} → ${c.actionName}`,
    );

    return createPickRememberChoiceResult(
        systemContext.choiceManager,
        question,
        choiceLabels,
        "Remember this choice for next time",
        async (selected, remember, liveActionContext) => {
            // Cancelled (no candidate picked).
            if (selected < 0 || selected >= members.length) {
                return createActionResultFromTextDisplay(
                    "Okay, I won't run anything.",
                );
            }

            const liveSystemContext = (
                liveActionContext as ActionContext<CommandHandlerContext>
            ).sessionContext.agentContext;
            const chosen = members[selected];

            // Persist the pick when configured to learn from it.
            const shouldRemember =
                cfg.remember === "always" ||
                (cfg.remember === "prompt" && remember);
            if (shouldRemember) {
                liveSystemContext.collisionPreferences.set(
                    members,
                    chosen,
                    "learned",
                );
            }

            // One-shot override so the re-translation of the original request
            // resolves deterministically to the chosen candidate, even when we
            // didn't persist a durable preference.
            liveSystemContext.collisionOneShotPicks.add(
                `${chosen.schemaName}.${chosen.actionName}`,
            );

            // Clear the clarify card's text before re-running. Any display the
            // re-run produces (e.g. a follow-up sign-in prompt) is appended to
            // this same action bubble, so without resetting it the stale
            // "Multiple agents..." question stays stacked above the new prompt.
            liveActionContext.actionIO.setDisplay({
                type: "text",
                content: `Selected ${chosen.schemaName} → ${chosen.actionName}.`,
            });

            // Re-run the original request through the normal pipeline. We're
            // already inside respondToChoice's command lock, so use the
            // no-lock entry point to avoid a self-deadlock.
            await processCommandNoLock(request, liveSystemContext);
            return undefined;
        },
    );
}

// Cache the lookup clarify translator per systemContext since it is expensive
// to create and only depends on the agents + promptLogger for the session.
const lookupClarifyTranslatorCache = new WeakMap<
    CommandHandlerContext,
    ReturnType<typeof loadAgentJsonTranslator>
>();

function getLookupClarifyTranslator(systemContext: CommandHandlerContext) {
    const cached = lookupClarifyTranslatorCache.get(systemContext);
    if (cached !== undefined) {
        return cached;
    }
    const agents = systemContext.agents;
    const actionConfigs = [
        agents.getActionConfig("dispatcher.lookup"),
        agents.getActionConfig("dispatcher"),
    ];
    const translator = loadAgentJsonTranslator(
        actionConfigs,
        [],
        agents,
        undefined,
        undefined,
        undefined,
        systemContext.promptLogger,
    );
    lookupClarifyTranslatorCache.set(systemContext, translator);
    return translator;
}

async function clarifyWithLookup(
    action: ClarifyUnresolvedReference,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult | undefined> {
    const systemContext = context.sessionContext.agentContext;
    // Entity-reference clarification consults conversation memory directly and
    // builds its own translator, so it does not depend on the dispatcher.lookup
    // action being active in translation — which the "reasoning-only" answer
    // strategy disables. Only bail when there is no conversation memory at all.
    if (
        systemContext.conversationMemory === undefined &&
        systemContext.conversationManager === undefined
    ) {
        return undefined;
    }

    const translator = getLookupClarifyTranslator(systemContext);

    const question = `What is ${action.parameters.reference}?`;
    const result = await translator.translate(question);

    if (!result.success) {
        return undefined;
    }
    const lookupAction = result.data as LookupAndAnswerConversation;
    if (lookupAction.actionName !== "lookupAndAnswerConversation") {
        return undefined;
    }
    const lookupResult = await lookupAndAnswer(
        lookupAction as LookupAndAnswerConversation,
        context,
    );

    if (
        lookupResult.error !== undefined ||
        lookupResult.historyText === undefined
    ) {
        return undefined;
    }

    // TODO: This translation can probably more scoped based on the `actionName` field.
    const history = getHistoryContext(systemContext);
    if (history === undefined) {
        // Can't do clarify without history.
        return undefined;
    }

    history.promptSections.push({
        role: "assistant",
        content: lookupResult.historyText,
    });

    const translationResult = await translateRequest(
        context,
        action.parameters.request,
        history,
    );

    if (!translationResult) {
        // undefined means not found or not translated
        // null means cancelled because of replacement parse error.
        return undefined;
    }

    if (translationResult.requestAction.actions.length > 1) {
        // REVIEW: Expect only one action?.
        return undefined;
    }

    return {
        additionalActions: [translationResult.requestAction.actions[0].action],
        entities: [],
    };
}

function clarifyEntityAction(
    action: ClarifyEntityAction,
    context: ActionContext<CommandHandlerContext>,
): ActionResult {
    const { type, name, result } = action.parameters;

    if (result.entities.length < 2) {
        throw new Error(
            "ClarifyEntityAction should not be called with empty or single entity.",
        );
    }

    const question = [
        `Multiple ${type.toLowerCase()} entities named '${name}' were found`,
        ...result.entities.map((entity) => `- ${entity.name}`),
        "", // markdown needs an extra line to start a new paragraph
        `Please clarify which one you meant.`,
    ];

    return createActionResultFromMarkdownDisplay(
        question,
        undefined,
        result.entities,
    );
}

export const dispatcherManifest: AppAgentManifest = {
    emojiChar: DispatcherEmoji,
    description: "Built-in agent to dispatch requests",
    schema: {
        description: "",
        schemaType: "DispatcherActions",
        schemaFile: "./src/context/dispatcher/schema/dispatcherActionSchema.ts",
        injected: true,
        cached: false,
    },
    subActionManifests: {
        clarify: {
            schema: {
                description: "Action that helps you clarify your request.",
                schemaFile:
                    "./src/context/dispatcher/schema/clarifyActionSchema.ts",
                schemaType: "ClarifyRequestAction",
                injected: true,
                cached: false,
            },
        },
        lookup: {
            schema: {
                description:
                    "Action that helps you look up information to answer user questions.",
                schemaFile:
                    "./src/context/dispatcher/schema/lookupActionSchema.ts",
                schemaType: {
                    action: "LookupAction",
                    activity: "LookupActivity",
                },
                injected: true,
                cached: false,
            },
        },
        activity: {
            transient: true,
            schema: {
                description: "Action that manages activity context.",
                schemaFile:
                    "./src/context/dispatcher/schema/activityActionSchema.ts",
                schemaType: "ActivityActions",
                injected: true,
                cached: false,
            },
        },
        reasoning: {
            schema: {
                description:
                    "Action that helps you reason through requests that require multiple steps.",
                schemaFile:
                    "./src/context/dispatcher/schema/reasoningActionSchema.ts",
                schemaType: "ReasoningAction",
                injected: true,
                cached: false,
            },
        },
    },
};

export const dispatcherAgent: AppAgent = {
    executeAction: executeDispatcherAction,
    handleChoice: async (choiceId, response, context) => {
        const systemContext = (context as ActionContext<CommandHandlerContext>)
            .sessionContext.agentContext;
        return systemContext.choiceManager.handleChoice(
            choiceId,
            response,
            context,
        );
    },
    ...getCommandInterface(dispatcherHandlers),
};
