// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import {
    CreateOrUpdateWebPlan,
    PlanAuthoringActions,
} from "./schema/authoringActions.mjs";
import { setupAuthoringActions } from "./authoringUtilities.mjs";

export function createSchemaAuthoringAgent(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent);

    return {
        async executeAction(
            action: TypeAgentAction<PlanAuthoringActions>,
            actionContext: any,
        ): Promise<any> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "createOrUpdateWebPlan":
                    const result = await handleUpdateWebPlan(
                        action,
                        actionContext,
                    );
                    return result;
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
            await getCurrentStateQuestion(action);
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

    async function getCurrentStateQuestion(action: CreateOrUpdateWebPlan) {
        // TODO: run assessment to figure out the current authoring state and the next question to ask.
        let question =
            "Check the output in the browser. Is the task completed?";

        let additionalInstructions = [
            `Current web plan data: ${JSON.stringify({
                name: action.parameters.webPlanName,
                description: action.parameters.webPlanDescription,
                steps: action.parameters.webPlanSteps,
            })}`,
        ];
        if (action.parameters.webPlanName === undefined) {
            question = "What name would you like to use for the new task?";
            additionalInstructions;
        } else if (action.parameters.webPlanDescription === undefined) {
            question = "Give a short description of the what the task does";
        } else if (action.parameters.webPlanSteps === undefined) {
            question =
                "How would you complete this task? Describe the steps involved.";
        } else {
            switch (action.parameters.userIntent) {
                case "createNew":
                    question =
                        "What name would you like to use for the new task? Give a short description of what the task does";
                    additionalInstructions.push(
                        `Ensure the user response addresses the question "${question}". Otherwise, ask for clarification using the nextPrompt field.`,
                    );
                    break;
                case "updateCurrentPlan":
                    question =
                        "I updated the task. Would you like to refine further or run the current plan?";
                    additionalInstructions.push(
                        `Ensure the user response addresses the question "${question}". Otherwise, ask for clarification using the nextPrompt field.`,
                    );
                    break;
                case "testCurrentPlan":
                    let paramsMap = new Map<string, any>();
                    const description = `${action.parameters.webPlanDescription}. Steps: ${JSON.stringify(action.parameters.webPlanSteps)}`;
                    const intentInfo =
                        await actionUtils.getIntentFromDescription(
                            action.parameters.webPlanName,
                            description,
                        );

                    if (
                        action.parameters.taskRunParameters !== undefined &&
                        action.parameters.taskRunParameters !== ""
                    ) {
                        paramsMap = new Map(
                            Object.entries(
                                JSON.parse(action.parameters.taskRunParameters),
                            ),
                        );
                    }
                    if (intentInfo !== undefined) {
                        let missingRequiredParameters: string[] = [];
                        intentInfo.intentJson.parameters.forEach((param) => {
                            if (
                                param.required &&
                                !paramsMap.has(param.shortName)
                            ) {
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
                            question =
                                "Check the output in the browser. Is the task completed?";
                        }
                    } else {
                        question =
                            "I could not run the current task. Please provide more information to refine the current plan?";
                    }
                    break;
                case "savePlanAndExit":
                    question = "The new task has been added.";
                    additionalInstructions = [];
                    break;
            }
        }

        if (additionalInstructions.length > 0) {
            additionalInstructions.push(
                `The assistant asked the user: ${question}`,
            );
        }

        return { question, additionalInstructions };
    }
}
