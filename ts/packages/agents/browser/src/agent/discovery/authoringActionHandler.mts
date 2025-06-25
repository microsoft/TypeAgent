// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
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
import { BrowserActionContext } from "../actionHandler.mjs";

type WebPlanInfo = {
    webPlanName?: string | undefined;
    webPlanDescription?: string | undefined;
    webPlanSteps?: string[] | undefined;
    requiredParameterNames?: string[] | undefined;
};

export function createSchemaAuthoringAgent(
    browser: BrowserConnector,
    agent: SchemaDiscoveryAgent<SchemaDiscoveryActions>,
    context: SessionContext<BrowserActionContext>,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent, context);

    let intentInfo: { intentJson: UserIntent; actions: any } | undefined =
        undefined;

    let webPlanDraft: WebPlanInfo = {};

    return {
        async executeAction(
            action: TypeAgentAction<PlanAuthoringActions>,
            actionContext: any,
        ): Promise<any> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "createOrUpdateWebPlan":
                    let result = await handleUpdateWebPlan(action, context);
                    result.activityContext = {
                        activityName: "editingWebPlan",
                        description: "Editing a Web Plan",
                        state: {
                            webPlan: webPlanDraft,
                        },
                    };
                    return result;
                    break;
                case "runCurrentWebPlan":
                    const runResult = await handleRunWebPlan(action, context);
                    return runResult;
                    break;
                default:
                    break;
            }
        },
    };

    async function handleUpdateWebPlan(
        action: CreateOrUpdateWebPlan,
        actionContext: any,
    ) {
        console.log(action);

        const { question, additionalInstructions } =
            await getNextAuthoringQuestion(action);
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

    function setQuestionWithFallback(
        action: CreateOrUpdateWebPlan,
        fallback: string,
    ) {
        if (
            action.parameters.nextPrompt !== undefined &&
            action.parameters.nextPrompt.length > 0
        ) {
            return action.parameters.nextPrompt;
        } else {
            return fallback;
        }
    }

    async function getNextAuthoringQuestion(action: CreateOrUpdateWebPlan) {
        // TODO: run assessment to figure out the current authoring state and the next question to ask.
        let question =
            "Check the output in the browser. Is the task completed?";

        webPlanDraft = {
            webPlanName: action.parameters.webPlanName,
            webPlanDescription: action.parameters.webPlanDescription,
            webPlanSteps: action.parameters.webPlanSteps,
            requiredParameterNames: action.parameters.requiredParameterNames,
        };
        let additionalInstructions = [
            `Current web plan data: ${JSON.stringify(webPlanDraft)}`,
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
            const htmlFragments = await browser.getHtmlFragments();
            const screenshot = await browser.getCurrentPageScreenshot();
            const suggestedStepsResponse = await agent.getWebPlanSuggestedSteps(
                action.parameters.webPlanName!,
                action.parameters.webPlanDescription!,
                action.parameters.webPlanSteps,
                htmlFragments,
                [screenshot],
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
            intentInfo = await actionUtils.getIntentFromDescription(
                action.parameters.webPlanName,
                description,
            );
        }

        additionalInstructions.push(
            `The assistant asked the user: ${question}`,
        );

        return { question, additionalInstructions };
    }

    async function handleRunWebPlan(
        action: RunCurrentWebPlan,
        actionContext: any,
    ) {
        console.log(action);

        const { question, additionalInstructions } =
            await getNextPlanRunningQuestion(action);
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

    async function getNextPlanRunningQuestion(action: RunCurrentWebPlan) {
        // TODO: run assessment to figure out the current authoring state and the next question to ask.
        let question =
            "Check the output in the browser. Is the task completed?";
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

        if (intentInfo !== undefined) {
            let missingRequiredParameters: string[] = [];
            intentInfo.intentJson.parameters.forEach((param) => {
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
                await actionUtils.runDynamicAction(
                    intentInfo.intentJson,
                    intentInfo.actions,
                    paramsMap,
                );

                const htmlFragments = await browser.getHtmlFragments();
                const screenshot = await browser.getCurrentPageScreenshot();

                const evaluationResult = await agent.getWebPlanRunResult(
                    action.parameters.webPlanName!,
                    action.parameters.webPlanDescription!,
                    paramsMap,
                    htmlFragments,
                    [screenshot],
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

        additionalInstructions.push(
            `The assistant asked the user: ${question}`,
        );

        return { question, additionalInstructions };
    }
}
