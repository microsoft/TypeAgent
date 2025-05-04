// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserConnector } from "../browserConnector.mjs";

import {
    DropdownControl,
    Element,
    NavigationLink,
    TextInput,
} from "./schema/pageComponents.mjs";
import { PageActionsPlan, UserIntent } from "./schema/recordedActions.mjs";
import { createExecutionTracker } from "../planVisualizationClient.mjs";

export function setupAuthoringActions(
    browser: BrowserConnector,
    agent: any,
    context: any,
) {
    return {
        getComponentFromPage: getComponentFromPage,
        followLink: followLink,
        getIntentFromDescription: getIntentFromDescription,
        runDynamicAction: runDynamicAction,
    };

    async function getComponentFromPage(
        componentType: string,
        selectionCondition?: string,
    ) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();
        const response = await agent.getPageComponentSchema(
            componentType,
            selectionCondition,
            htmlFragments,
            screenshot,
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

    async function getIntentFromDescription(
        actionName: string,
        description: string,
    ) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();
        let recordedSteps = "";
        const descriptionResponse = await agent.getDetailedStepsFromDescription(
            actionName,
            description,
            htmlFragments,
            screenshot,
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
            screenshot,
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
            screenshot,
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

    async function runDynamicAction(
        targetIntent: UserIntent,
        targetPlan: PageActionsPlan,
        userSuppliedParameters: Map<string, any>,
    ) {
        const { trackState, reset } = createExecutionTracker(
            context.sessionContext.agentContext.planVisualizationEndpoint!,
            targetPlan.planName,
        );
        await reset(true);

        console.log(`Running ${targetPlan.planName}`);

        for (const step of targetPlan.steps) {
            switch (step.actionName) {
                case "ClickOnLink":
                    const linkParameter = targetIntent.parameters.find(
                        (param) =>
                            param.shortName ==
                            step.parameters.linkTextParameter,
                    );
                    await trackState("", `Click on ${linkParameter?.name}`);

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
                        await trackState(
                            "",
                            `Click on ${step.parameters?.elementText}`,
                        );

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
                        await trackState(
                            "",
                            `Click on ${step.parameters?.buttonText}`,
                        );

                        await browser.clickOn(button.cssSelector);
                        await browser.awaitPageInteraction();
                        await browser.awaitPageLoad();
                    }
                    break;
                case "enterText":
                case "enterTextAtPageScope":
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

                    await trackState(
                        "",
                        `Enter text "${userProvidedTextValue}" in ${textParameter?.name}`,
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
                        await trackState(
                            "",
                            `Select "${userProvidedValue}" in ${selectParameter?.name}`,
                        );

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

        await trackState("Completed", "", "end");
    }
}
