// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { BrowserControl } from "../../common/browserControl.mjs";
import { getCurrentPageScreenshot } from "../browserActions.mjs";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import {
    CreateOrUpdateWebPlan,
    PlanAuthoringActions,
    RunCurrentWebPlan,
} from "./schema/authoringActions.mjs";
import { setupAuthoringActions } from "./authoringUtilities.mjs";
import { UserIntent } from "./schema/recordedActions.mjs";
import { SchemaDiscoveryActions } from "./schema/discoveryActions.mjs";
import { SchemaDiscoveryAgent } from "./translator.mjs";
import { WebPlanResult, WebPlanSuggestions } from "./schema/evaluatePlan.mjs";
import { BrowserActionContext } from "../browserActions.mjs";
import { WebFlowDefinition } from "../webFlows/types.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:authoring");

// Context interface for authoring action handler functions
interface AuthoringActionHandlerContext {
    browser: BrowserControl;
    agent: SchemaDiscoveryAgent<SchemaDiscoveryActions>;
    sessionContext: SessionContext<BrowserActionContext>;
    actionUtils: ReturnType<typeof setupAuthoringActions>;
    state: {
        intentInfo?: { intentJson: UserIntent; actions: any };
        webPlanDraft: WebPlanInfo;
    };
}

type WebPlanInfo = {
    webPlanName?: string | undefined;
    webPlanDescription?: string | undefined;
    webPlanSteps?: string[] | undefined;
    requiredParameterNames?: string[] | undefined;
};

function setQuestionWithFallback(
    action: CreateOrUpdateWebPlan,
    fallback: string,
): string {
    if (
        action.parameters.nextPrompt !== undefined &&
        action.parameters.nextPrompt.length > 0
    ) {
        return action.parameters.nextPrompt;
    } else {
        return fallback;
    }
}

async function getNextAuthoringQuestion(
    action: CreateOrUpdateWebPlan,
    ctx: AuthoringActionHandlerContext,
): Promise<{ question: string; additionalInstructions: string[] }> {
    let question = "Check the output in the browser. Is the task completed?";

    ctx.state.webPlanDraft = {
        webPlanName: action.parameters.webPlanName,
        webPlanDescription: action.parameters.webPlanDescription,
        webPlanSteps: action.parameters.webPlanSteps,
        requiredParameterNames: action.parameters.requiredParameterNames,
    };
    let additionalInstructions = [
        `Current web plan data: ${JSON.stringify(ctx.state.webPlanDraft)}`,
    ];
    if (
        action.parameters.webPlanName === undefined ||
        action.parameters.webPlanName.length === 0
    ) {
        question = setQuestionWithFallback(
            action,
            "What name would you like to use for the new task?",
        );
    } else if (
        action.parameters.webPlanDescription === undefined ||
        action.parameters.webPlanDescription.length === 0
    ) {
        question = setQuestionWithFallback(
            action,
            "Give a short description of the what the task does",
        );
    } else if (
        action.parameters.webPlanSteps === undefined ||
        action.parameters.webPlanSteps.length === 0
    ) {
        const htmlFragments = await ctx.browser.getHtmlFragments();
        let screenshot = "";
        try {
            screenshot = await getCurrentPageScreenshot(ctx.browser);
        } catch (error) {
            console.warn(
                "Screenshot capture failed, continuing without screenshot:",
                (error as Error)?.message,
            );
        }

        // Only include screenshot if it's not empty
        const screenshots = screenshot ? [screenshot] : [];

        const suggestedStepsResponse = await ctx.agent.getWebPlanSuggestedSteps(
            action.parameters.webPlanName!,
            action.parameters.webPlanDescription!,
            action.parameters.webPlanSteps,
            htmlFragments,
            screenshots,
        );

        if (suggestedStepsResponse.success) {
            const suggestedSteps =
                suggestedStepsResponse.data as WebPlanSuggestions;

            console.log(suggestedSteps);
        }
        if (question === "") {
            question = setQuestionWithFallback(
                action,
                "How would you complete this task? Describe the steps involved.",
            );
        }
    } else {
        question =
            "I updated the task. Would you like to refine further or run the current plan?";
        additionalInstructions.push(
            `Ensure the user response addresses the question "${question}". Otherwise, ask for clarification using the nextPrompt field.`,
        );

        const description = `${action.parameters.webPlanDescription}. Steps: ${JSON.stringify(action.parameters.webPlanSteps)}`;
        ctx.state.intentInfo = (await ctx.actionUtils.getIntentFromDescription(
            action.parameters.webPlanName,
            description,
        )) as { intentJson: UserIntent; actions: any };
    }

    additionalInstructions.push(`The assistant asked the user: ${question}`);

    return { question, additionalInstructions };
}

async function handleUpdateWebPlan(
    action: CreateOrUpdateWebPlan,
    ctx: AuthoringActionHandlerContext,
    actionContext: any,
): Promise<any> {
    console.log(action);

    const { question, additionalInstructions } = await getNextAuthoringQuestion(
        action,
        ctx,
    );
    actionContext.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: question,
    });

    const result = createActionResultNoDisplay(question);
    if (additionalInstructions.length > 0) {
        result.additionalInstructions = additionalInstructions;
    }

    result.entities;
    return result;
}

async function getNextPlanRunningQuestion(
    action: RunCurrentWebPlan,
    ctx: AuthoringActionHandlerContext,
): Promise<{ question: string; additionalInstructions: string[] }> {
    let question = "Check the output in the browser. Is the task completed?";
    let additionalInstructions: string[] = [];

    let paramsMap = new Map<string, any>();
    if (
        action.parameters.taskRunParameters !== undefined &&
        action.parameters.taskRunParameters !== ""
    ) {
        paramsMap = new Map(
            Object.entries(JSON.parse(action.parameters.taskRunParameters)),
        );
    }

    if (ctx.state.intentInfo !== undefined) {
        let missingRequiredParameters: string[] = [];
        ctx.state.intentInfo.intentJson.parameters.forEach((param) => {
            if (param.required && !paramsMap.has(param.shortName)) {
                paramsMap.set(param.shortName, "");
                missingRequiredParameters.push(param.shortName);
            }
        });
        if (missingRequiredParameters.length > 0) {
            // ask model to provide values for required parameters
            question = `To run the task, please provide values for ${missingRequiredParameters.join(",")}`;
        } else {
            // ready to run
            await ctx.actionUtils.runDynamicAction(
                ctx.state.intentInfo.intentJson,
                ctx.state.intentInfo.actions,
                paramsMap,
            );

            const htmlFragments = await ctx.browser.getHtmlFragments();
            let screenshot = "";
            try {
                screenshot = await getCurrentPageScreenshot(ctx.browser);
            } catch (error) {
                console.warn(
                    "Screenshot capture failed, continuing without screenshot:",
                    (error as Error)?.message,
                );
            }

            // Only include screenshot if it's not empty
            const screenshots = screenshot ? [screenshot] : [];

            const evaluationResult = await ctx.agent.getWebPlanRunResult(
                action.parameters.webPlanName!,
                action.parameters.webPlanDescription!,
                paramsMap,
                htmlFragments,
                screenshots,
            );

            if (evaluationResult.success) {
                const resultData = evaluationResult.data as WebPlanResult;
                question = resultData.message;
            } else {
                question =
                    "Check the output in the browser. Is the task completed?";
            }
        }
    } else {
        question =
            "I could not run the current task. Please provide more information to refine the current plan?";
    }

    additionalInstructions.push(`The assistant asked the user: ${question}`);

    return { question, additionalInstructions };
}

async function handleRunWebPlan(
    action: RunCurrentWebPlan,
    ctx: AuthoringActionHandlerContext,
    actionContext: any,
): Promise<any> {
    console.log(action);

    const { question, additionalInstructions } =
        await getNextPlanRunningQuestion(action, ctx);
    actionContext.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: question,
    });

    const result = createActionResultNoDisplay(question);
    if (additionalInstructions.length > 0) {
        result.additionalInstructions = additionalInstructions;
    }

    return result;
}

async function handleSaveCurrentWebPlan(
    ctx: AuthoringActionHandlerContext,
    actionContext: any,
): Promise<any> {
    const draft = ctx.state.webPlanDraft;
    const intentInfo = ctx.state.intentInfo;

    if (!draft.webPlanName || !draft.webPlanDescription) {
        const msg =
            "Cannot save: the plan needs at least a name and description. Please continue editing first.";
        actionContext.actionIO.appendDisplay({
            type: "text",
            speak: true,
            content: msg,
        });
        return createActionResultNoDisplay(msg);
    }

    const store = ctx.sessionContext.agentContext.webFlowStore;
    if (!store) {
        const msg =
            "WebFlow store is not available. The plan could not be saved.";
        actionContext.actionIO.appendDisplay({
            type: "text",
            speak: true,
            content: msg,
        });
        return createActionResultNoDisplay(msg);
    }

    // Build parameters from intent info
    const params: WebFlowDefinition["parameters"] = {};
    if (intentInfo?.intentJson?.parameters) {
        for (const p of intentInfo.intentJson.parameters) {
            params[p.shortName] = {
                type: p.type as "string" | "number" | "boolean",
                required: p.required,
                description: p.description,
                ...(p.defaultValue !== undefined && {
                    default: p.defaultValue,
                }),
            };
        }
    }

    // Build a script stub from the plan steps
    const lines: string[] = ["async function execute(browser, params) {"];
    if (draft.webPlanSteps) {
        for (const step of draft.webPlanSteps) {
            lines.push(`  // ${step}`);
        }
    }
    lines.push('  return { success: true, message: "Plan executed" };');
    lines.push("}");

    const flow: WebFlowDefinition = {
        name: toCamelCase(draft.webPlanName),
        description: draft.webPlanDescription,
        version: 1,
        parameters: params,
        script: lines.join("\n"),
        grammarPatterns: [],
        scope: { type: "global" },
        source: {
            type: "manual",
            timestamp: new Date().toISOString(),
        },
    };

    await store.save(flow);
    debug(`Saved web plan as webFlow: ${flow.name}`);

    const msg = `Plan "${draft.webPlanName}" saved as webFlow "${flow.name}". You can run it with the webFlows system.`;
    actionContext.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: msg,
    });
    return createActionResultNoDisplay(msg);
}

function toCamelCase(str: string): string {
    return str
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .split(/\s+/)
        .map((word, i) =>
            i === 0
                ? word.toLowerCase()
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join("");
}

function createAuthoringState(): AuthoringActionHandlerContext["state"] {
    return {
        webPlanDraft: {},
    };
}

export function createSchemaAuthoringAgent(
    browser: BrowserControl,
    agent: SchemaDiscoveryAgent<SchemaDiscoveryActions>,
    context: SessionContext<BrowserActionContext>,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent, context);
    const state = createAuthoringState();

    const ctx: AuthoringActionHandlerContext = {
        browser,
        agent,
        sessionContext: context,
        actionUtils,
        state,
    };

    return {
        async executeAction(
            action: TypeAgentAction<PlanAuthoringActions>,
            actionContext: any,
        ): Promise<any> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "createOrUpdateWebPlan":
                    let result = await handleUpdateWebPlan(
                        action,
                        ctx,
                        actionContext,
                    );
                    result.activityContext = {
                        activityName: "editingWebPlan",
                        description: "Editing a Web Plan",
                        state: {
                            webPlan: ctx.state.webPlanDraft,
                        },
                    };
                    return result;
                case "runCurrentWebPlan":
                    const runResult = await handleRunWebPlan(
                        action,
                        ctx,
                        actionContext,
                    );
                    return runResult;
                case "saveCurrentWebPlan":
                    return await handleSaveCurrentWebPlan(ctx, actionContext);
                default:
                    break;
            }
        },
    };
}
