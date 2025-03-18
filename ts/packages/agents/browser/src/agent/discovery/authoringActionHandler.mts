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
import { UpdateWebPlan } from "./schema/authoringActions.mjs";

export function createSchemaAuthoringAgent(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    return {
        async executeAction(action: any, actionContext: any): Promise<any> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "updateWebPlan":
                    const result = await handleUpdateWebPlan(
                        action,
                        actionContext,
                    );
                    return result;
                    break;
                default:
                    handleUserDefinedAction(action);
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

        const question = await getCurrentStateQuestion(action);
        actionContext.actionIO.appendDisplay({
            type: "text",
            speak: true,
            content: question,
        });

        const result = createActionResultNoDisplay(question);
        if (!action.parameters.isPlanComplete) {
            result.additionalInstructions = [
                `Asked the user for additional data for the web plan. Current web plan data: ${JSON.stringify({ name: action.parameters.webPlanName, description: action.parameters.webPlanDescription, steps: action.parameters.webPlanSteps })}`,
            ];
        }

        return result;
    }

    async function getCurrentStateQuestion(action: UpdateWebPlan) {
        // TODO: run assessment to figure out the current authoring state and the next question to ask.
        let question =
            "Check the output in the browser. Is the task completed?";
        if (action.parameters.webPlanName === undefined) {
            question = "What name would you like to use for the new task?";
        } else if (action.parameters.webPlanDescription === undefined) {
            question = "Give a short description of the what the task does";
        } else if (action.parameters.webPlanSteps === undefined) {
            question =
                "How would you complete this task? Describe the steps involved.";
        }
        if (action.parameters.isPlanComplete) {
            question = "The new task has been added.";
        }
        return question;
    }

    async function handleUserDefinedAction(action: any) {
        const url = await browser.getPageUrl();
        const intentJson = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "authoredIntentJson",
                )) ?? {},
            ),
        );

        const actionsJson = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "authoredActionsJson",
                )) ?? {},
            ),
        );

        if (
            !intentJson.has(action.actionName) ||
            !actionsJson.has(action.actionName)
        ) {
            console.log(
                `Action ${action.actionName} was not found on the list of user-defined actions`,
            );
            return;
        }

        const targetIntent = intentJson.get(action.actionName) as UserIntent;
        const targetPlan = actionsJson.get(
            action.actionName,
        ) as PageActionsPlan;

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

                    const userProvidedTextValue =
                        action.parameters[step.parameters.textParameter];

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

                    const userProvidedValue =
                        action.parameters[step.parameters.valueTextParameter];

                    if (userProvidedValue !== undefined) {
                        const selectElement = (await getComponentFromPage(
                            "DropdownControl",
                            `text ${selectParameter?.name}`,
                        )) as DropdownControl;

                        await browser.clickOn(selectElement.cssSelector);
                        const selectValue = selectElement.values.find(
                            (value) =>
                                value.text ===
                                action.parameters[
                                    step.parameters.valueTextParameter
                                ],
                        );
                        if (selectValue) {
                            await browser.setDropdown(
                                selectElement.cssSelector,
                                selectValue.text,
                            );
                        } else {
                            console.error(`Could not find a dropdown option with text ${action.parameters[step.parameters.valueTextParameter]} 
                                on the ${selectElement.title} dropdown.`);
                        }
                    }

                    break;
            }
        }
    }
}
