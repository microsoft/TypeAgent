// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
import {
    BrowseProductCategoriesAction,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { handleCommerceAction } from "../commerce/actionHandler.mjs";
import {
    DropdownControl,
    Element,
    NavigationLink,
    TextInput,
} from "./schema/pageComponents.mjs";
import {
    PageManipulationActions,
    PageManipulationActionsList,
    UserIntent,
} from "./schema/recordedActions.mjs";

export function createTempAgentForSchema(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    return {
        async executeAction(action: any, tempContext: any): Promise<undefined> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "addToCartAction":
                case "viewShoppingCartAction":
                case "findNearbyStoreAction":
                case "getLocationInStore":
                case "searchForProductAction":
                case "selectSearchResult":
                    handleCommerceAction(action, context);
                    break;
                case "browseProductCategoriesAction":
                    handleBrowseProductCategory(action);
                    break;
                case "filterProductsAction":
                    break;
                case "navigateToPage":
                    handleNavigateToPage(action);
                    break;
                case "navigateToProductPage":
                    break;
                case "removeFromCartAction":
                    break;
                case "signUpForNewsletterAction":
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

    async function handleNavigateToPage(action: NavigateToPage) {
        const link = (await getComponentFromPage(
            "NavigationLink",
            `link text ${action.parameters.keywords}`,
        )) as NavigationLink;
        console.log(link);

        await followLink(link?.linkCssSelector);
    }

    async function handleBrowseProductCategory(
        action: BrowseProductCategoriesAction,
    ) {
        let linkText = action.parameters?.categoryName
            ? `link text ${action.parameters.categoryName}`
            : "";
        const link = (await getComponentFromPage(
            "NavigationLink",
            linkText,
        )) as NavigationLink;
        console.log(link);

        await followLink(link?.linkCssSelector);
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
        ) as PageManipulationActionsList;

        console.log(`Running ${targetPlan.planName}`);

        targetPlan.steps.forEach(async (step: PageManipulationActions) => {
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
        });
    }
}
