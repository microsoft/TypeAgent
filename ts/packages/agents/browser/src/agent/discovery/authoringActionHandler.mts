// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";

import {
    DropdownControl,
    Element,
    NavigationLink,
    TextInput,
} from "./schema/pageComponents.mjs";
import { PageActionsPlan, UserIntent } from "./schema/recordedActions.mjs";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { CreateOrUpdateWebPlan } from "./schema/authoringActions.mjs";

export function createSchemaAuthoringAgent(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    return {
        async executeAction(action: any, actionContext: any): Promise<any> {
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
                    // handleUserDefinedAction(action);
                    break;
            }
        },
    };

    async function getComponentFromPage(
        componentType: string,
        selectionCondition?: string,
    ) {
        const htmlFragments = await browser.getHtmlFragments();
        const response = await agent.getPageComponentSchema(
            componentType,
            selectionCondition,
            htmlFragments,
            undefined,
        );

        if (!response.success) {
            console.error(`Attempt to get ${componentType} failed`);
            console.error(response.message);
            return;
        }

        return response.data;
    }

    async function followLink(linkSelector: string | undefined) {
        if (!linkSelector) return;

        await browser.clickOn(linkSelector);
        await browser.awaitPageInteraction();
        await browser.awaitPageLoad();
    }

    async function handleUpdateWebPlan(action: any, actionContext: any) {
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
                    const intentInfo = await getIntentFromDescription(
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
                            await handleUserDefinedAction(
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

    async function getIntentFromDescription(
        actionName: string,
        description: string,
    ) {
        const htmlFragments = await browser.getHtmlFragments();
        let recordedSteps = "";
        const descriptionResponse = await agent.getDetailedStepsFromDescription(
            actionName,
            description,
            htmlFragments,
        );
        if (descriptionResponse.success) {
            console.log(descriptionResponse.data);
            recordedSteps = JSON.stringify(
                (descriptionResponse.data as any).actions,
            );
        }

        const intentResponse = await agent.getIntentSchemaFromRecording(
            actionName,
            [],
            description,
            recordedSteps,
            htmlFragments,
        );

        if (!intentResponse.success) {
            console.error("Attempt to process recorded action failed");
            console.error(intentResponse.message);
            return;
        }

        const intentData = intentResponse.data as UserIntent;

        const stepsResponse = await agent.getActionStepsSchemaFromRecording(
            intentData.actionName,
            description,
            intentData,
            recordedSteps,
            htmlFragments,
        );

        if (!stepsResponse.success) {
            console.error("Attempt to process recorded action failed");
            console.error(stepsResponse.message);
            return;
        }

        return {
            intentJson: intentData,
            actions: stepsResponse.data,
        };
    }

    async function handleUserDefinedAction(
        targetIntent: UserIntent,
        targetPlan: PageActionsPlan,
        userSuppliedParameters: Map<string, any>,
    ) {
        console.log(`Running ${targetPlan.planName}`);

        for (const step of targetPlan.steps) {
            switch (step.actionName) {
                case "ClickOnLink":
                    const linkParameter = targetIntent.parameters.find(
                        (param) =>
                            param.shortName ==
                            step.parameters.linkTextParameter,
                    );
                    const link = (await getComponentFromPage(
                        "NavigationLink",
                        `link text ${linkParameter?.name}`,
                    )) as NavigationLink;

                    await followLink(link?.linkCssSelector);
                    break;
                case "clickOnElement":
                    const element = (await getComponentFromPage(
                        "Element",
                        `element text ${step.parameters?.elementText}`,
                    )) as Element;
                    if (element !== undefined) {
                        await browser.clickOn(element.cssSelector);
                        await browser.awaitPageInteraction();
                        await browser.awaitPageLoad();
                    }
                    break;
                case "clickOnButton":
                    const button = (await getComponentFromPage(
                        "Element",
                        `element text ${step.parameters?.buttonText}`,
                    )) as Element;
                    if (button !== undefined) {
                        await browser.clickOn(button.cssSelector);
                        await browser.awaitPageInteraction();
                        await browser.awaitPageLoad();
                    }
                    break;
                case "enterText":
                    const textParameter = targetIntent.parameters.find(
                        (param) =>
                            param.shortName == step.parameters.textParameter,
                    );
                    const textElement = (await getComponentFromPage(
                        "TextInput",
                        `input label ${textParameter?.name}`,
                    )) as TextInput;

                    const userProvidedTextValue = userSuppliedParameters.get(
                        step.parameters.textParameter,
                    );

                    if (userProvidedTextValue !== undefined) {
                        await browser.enterTextIn(
                            userProvidedTextValue,
                            textElement?.cssSelector,
                        );
                    }
                    break;
                case "selectElementByText":
                    break;
                case "selectValueFromDropdown":
                    const selectParameter = targetIntent.parameters.find(
                        (param) =>
                            param.shortName ==
                            step.parameters.valueTextParameter,
                    );

                    const userProvidedValue = userSuppliedParameters.get(
                        step.parameters.valueTextParameter,
                    );

                    if (userProvidedValue !== undefined) {
                        const selectElement = (await getComponentFromPage(
                            "DropdownControl",
                            `text ${selectParameter?.name}`,
                        )) as DropdownControl;

                        await browser.clickOn(selectElement.cssSelector);
                        const selectValue = selectElement.values.find(
                            (value) =>
                                value.text ===
                                userSuppliedParameters.get(
                                    step.parameters.valueTextParameter,
                                ),
                        );
                        if (selectValue) {
                            await browser.setDropdown(
                                selectElement.cssSelector,
                                selectValue.text,
                            );
                        } else {
                            console.error(`Could not find a dropdown option with text ${userSuppliedParameters.get(step.parameters.valueTextParameter)}) 
                                on the ${selectElement.title} dropdown.`);
                        }
                    }

                    break;
            }
        }
    }
}
