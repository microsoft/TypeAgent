// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    MultimodalPromptContent,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import path from "path";
import fs from "fs";
import { openai as ai } from "aiclient";
import { fileURLToPath } from "node:url";
import { ShoppingActions } from "./schema/userActions.mjs";
import { PurchaseResults } from "./schema/shoppingResults.mjs";
import type {
    ElementDescriptionResult,
    PageStateMatchResult,
    PageContentQueryResult,
} from "./schema/queryResults.mjs";

export type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

export interface ContentSection {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}

export enum CommercePageType {
    Landing,
    SearchResults,
    ProductDetails,
}

function getPrefixPromptSection() {
    // TODO: update this to use system role
    let prefixSection = [];
    prefixSection.push({
        type: "text",
        text: "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
    });
    return prefixSection;
}

function getSuffixPromptSection() {
    let suffixSection = [];
    suffixSection.push({
        type: "text",
        text: `
The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
`,
    });
    return suffixSection;
}

function getHtmlPromptSection(fragments: HtmlFragments[] | undefined) {
    let htmlSection = [];
    if (fragments) {
        const contentFragments = fragments.map((a) => a.content);
        htmlSection.push({
            type: "text",
            text: `
          Here are HTML fragments from the page.
          '''
          ${contentFragments}
          '''
      `,
        });
    }
    return htmlSection;
}

function getScreenshotPromptSection(
    screenshot: string | undefined,
    fragments: HtmlFragments[] | undefined,
) {
    let screenshotSection = [];
    if (screenshot) {
        screenshotSection.push({
            type: "text",
            text: "Here is a screenshot of the currently visible webpage",
        });

        screenshotSection.push({
            type: "image_url",
            image_url: {
                url: screenshot,
            },
        });
    }
    if (fragments) {
        const textFragments = fragments.map((a) => a.text);
        screenshotSection.push({
            type: "text",
            text: `Here is the text content of the page
            '''
            ${textFragments}
            '''            
            `,
        });
    }
    return screenshotSection;
}

async function getSchemaFileContents(fileName: string): Promise<string> {
    const packageRoot = path.join("..", "..", "..");
    return await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/commerce/schema", fileName),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

export async function createCommercePageTranslator(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
    const actionSchema = await getSchemaFileContents("userActions.mts");
    const pageSchema = await getSchemaFileContents("pageComponents.mts");

    const agent = new ECommerceSiteAgent<ShoppingActions>(
        pageSchema,
        actionSchema,
        "ShoppingActions",
        model,
    );
    return agent;
}

export class ECommerceSiteAgent<T extends object> {
    schema: string;
    pageComponentsSchema: string;

    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<T>;

    constructor(
        pageComponentsSchema: string,
        actionSchema: string,
        schemaName: string,
        fastModelName: string,
    ) {
        this.pageComponentsSchema = pageComponentsSchema;
        this.schema = actionSchema;

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            fastModelName,
        );
        this.model = ai.createChatModel(apiSettings, undefined, undefined, [
            "commerce",
        ]);
        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    private getCssSelectorForElementPrompt<U extends object>(
        translator: TypeChatJsonTranslator<U>,
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        let requestSection = [];
        if (userRequest) {
            requestSection.push({
                type: "text",
                text: `
               
            Here is  user request
            '''
            ${userRequest}
            '''
            `,
            });
        }
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
        Use the layout information provided and the user request below to generate a SINGLE "${translator.validator.getTypeName()}" response using the typescript schema below.
        For schemas that include CSS selectors, construct the selector based on the element's Id attribute if the id is present.
        You should stop searching and return current result as soon as you find a result that matches the user's criteria:
        
        '''
        ${translator.validator.getSchemaText()}
        '''
        `,
            },
            ...requestSection,
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];
        return promptSections;
    }

    private getBootstrapTranslator(targetType: string, targetSchema?: string) {
        const pageSchema = targetSchema ?? this.pageComponentsSchema;

        const validator = createTypeScriptJsonValidator(pageSchema, targetType);
        const bootstrapTranslator = createJsonTranslator(this.model, validator);

        bootstrapTranslator.createRequestPrompt = (input: string) => {
            console.log(input);
            return "";
        };

        return bootstrapTranslator;
    }

    async getPageComponentSchema(
        componentTypeName: string,
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const bootstrapTranslator =
            this.getBootstrapTranslator(componentTypeName);

        const promptSections = this.getCssSelectorForElementPrompt(
            bootstrapTranslator,
            userRequest,
            fragments,
            screenshot,
        ) as ContentSection[];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getFriendlyPurchaseSummary(rawResults: PurchaseResults) {
        const resultsSchema = await getSchemaFileContents(
            "shoppingResults.mts",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "PurchaseSummary",
            resultsSchema,
        );

        const prefixSection = getPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            {
                type: "text",
                text: `
        Use the user request below to generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
        '''
        `,
            },
            {
                type: "text",
                text: `
               
            Here is  user request
            '''
            ${JSON.stringify(rawResults, undefined, 2)}
            '''
            `,
            },
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getPageState(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string,
    ) {
        const resultsSchema = await getSchemaFileContents("pageStates.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageState",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshots,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        const suffixSection = getSuffixPromptSection();
        let requestSection = [];
        if (userRequest) {
            requestSection.push({
                type: "text",
                text: `
               
            Here is  user request
            '''
            ${userRequest}
            '''
            `,
            });
        }
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
        Examine the layout information provided and determine the content of the page and the actions users can take on it.
        Once you have this list, a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
                
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
        '''
        `,
            },
            ...requestSection,
            ...suffixSection,
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getNextPageAction(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
        pastActions?: string,
        lastAction?: any,
    ) {
        const resultsSchema = await getSchemaFileContents("planActions.mts");

        const bootstrapTranslator = this.getBootstrapTranslator(
            "ShoppingPlanActions",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);

        let requestSection = [];
        requestSection.push({
            type: "text",
            text: `
            # User Request
            ${userRequest}
        `,
        });
        if (pastActions !== undefined && pastActions.length > 0) {
            requestSection.push({
                type: "text",
                text: `
               
            # Execution History
            '''
            ${JSON.stringify(pastActions)}
            '''
            `,
            });
        }

        if (lastAction !== undefined) {
            requestSection.push({
                type: "text",
                text: `
               
            Last Action: ${lastAction.actionName})
            `,
            });
        }

        const promptSections = [
            {
                type: "text",
                text: `
"You are a browser automation planning assistant for an e-commerce website. Your task is to determine the next best action to execute based on the user's request and the current state of the browser."
`,
            },
            ...screenshotSection,
            ...htmlSection,
            ...requestSection,
            {
                type: "text",
                text: `
Use the user request below to generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
'''
${bootstrapTranslator.validator.getSchemaText()}
'''
`,
            },
            {
                type: "text",
                text: `
       
    # Special Actions
  1. If you believe the user's request has been FULLY completed, you can respond with actionName: "planCompleted" and no parameters.
  
  
  # Instructions
  1. Analyze the user's request and the current browser state
  2. Determine the most appropriate next action to take
  3. Select the action from the available actions list
  4. Provide the necessary parameters for the selected action
  5. Respond with ONLY a JSON object containing the actionName and parameters
  
  Always ensure that:
- The actionName corresponds to one of the available actions or "planCompleted"
- All required parameters for the action are provided
- Parameter types match what's expected (string, number, boolean)
- Your reasoning is deliberate and goal-oriented towards completing the user's request
- You select "planCompleted" only when you are certain the user's request has been fully completed

  Think step-by-step before making your decision. Consider what has been done so far and what remains to be done to fulfill the user's request.
    `,
            },
            {
                type: "text",
                text: `
The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
`,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    /**
     * Get element information by natural language description
     * Uses HTML fragments and optional screenshot to locate element
     */
    async getElementByDescription(
        elementDescription: string,
        elementTypeHint?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ): Promise<{
        success: boolean;
        data?: ElementDescriptionResult;
        message?: string;
    }> {
        const resultsSchema = await getSchemaFileContents("queryResults.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "ElementDescriptionResult",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        const suffixSection = getSuffixPromptSection();

        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
# Task: Locate Element by Description

You are tasked with finding a specific UI element on the webpage based on a natural language description.

## Element to Find
Description: "${elementDescription}"
${elementTypeHint ? `Type Hint: ${elementTypeHint}` : ""}

## Instructions
1. Examine the HTML fragments and screenshot provided
2. Identify the element that best matches the description
3. Extract the following information:
   - Element name (short descriptive label)
   - Element HTML (complete outerHTML of the element)
   - CSS selector (prefer ID-based, fallback to other unique selectors)
   - Element type (button, input, link, div, etc.)
   - Visible text content (if any)
   - Key attributes (id, class, data-*, aria-*, etc.)

4. If the element cannot be found:
   - Set found: false
   - Provide a clear reason in notFoundReason

## CSS Selector Guidelines
- Prefer selectors in this order:
  1. ID-based: #element-id
  2. Data attribute: [data-testid="value"]
  3. Unique class: .unique-class-name
  4. Combination: button.class-name[type="submit"]
- Ensure selector is specific enough to uniquely identify the element
- Test mentally: would this selector match only one element?

Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the schema below:

'''
${bootstrapTranslator.validator.getSchemaText()}
'''
`,
            },
            ...suffixSection,
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response as {
            success: boolean;
            data?: ElementDescriptionResult;
            message?: string;
        };
    }

    /**
     * Check if current page state matches expected description
     * Returns both current state and match result
     */
    async checkPageStateMatch(
        expectedStateDescription: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ): Promise<{
        success: boolean;
        data?: PageStateMatchResult;
        message?: string;
    }> {
        const resultsSchema = await getSchemaFileContents("queryResults.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageStateMatchResult",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        const suffixSection = getSuffixPromptSection();

        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
# Task: Verify Page State

You are tasked with determining if the current page state matches an expected condition.

## Expected State
"${expectedStateDescription}"

## Instructions
1. Analyze the current page using the HTML fragments and screenshot
2. Determine the current page state:
   - Page type (e.g., homePage, searchResults, productDetails, shoppingCart)
   - Description of what's currently shown
   - Key elements visible on the page
   - Possible user actions

3. Compare current state to expected state:
   - Does the page type match?
   - Are the expected elements present?
   - Does the content align with expectations?
   - Calculate confidence score (0.0 to 1.0)

4. Set matched: true only if:
   - Core aspects of expected state are present
   - Confidence >= 0.7

5. Provide clear explanation:
   - If matched: "The page shows [current state] which matches the expected [expected state]"
   - If not matched: "The page shows [current state] but expected [expected state]. Missing: [details]"

6. List matched and unmatched aspects for debugging

Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the schema below:

'''
${bootstrapTranslator.validator.getSchemaText()}
'''
`,
            },
            ...suffixSection,
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response as {
            success: boolean;
            data?: PageStateMatchResult;
            message?: string;
        };
    }

    /**
     * Query page content to answer a user question
     * Extracts information from visible page content
     */
    async queryPageContent(
        query: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ): Promise<{
        success: boolean;
        data?: PageContentQueryResult;
        message?: string;
    }> {
        const resultsSchema = await getSchemaFileContents("queryResults.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageContentQueryResult",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        const suffixSection = getSuffixPromptSection();

        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
# Task: Answer Question About Page Content

You are tasked with answering a user's question using only information visible on the current webpage.

## User Question
"${query}"

## Instructions
1. Examine the HTML fragments and screenshot to locate relevant information
2. Extract data that answers the question:
   - Look for specific values, counts, prices, status information
   - Consider both text content and element attributes
   - Check for data in tables, lists, product cards, etc.

3. If the answer can be found:
   - Set answered: true
   - Provide clear, concise answer text
   - Include supporting evidence (relevant text snippets)
   - Provide CSS selectors for elements containing the evidence
   - Estimate confidence (0.0 to 1.0)

4. If the answer cannot be found:
   - Set answered: false
   - Provide reason in unableToAnswerReason
   - Suggest next steps if applicable (e.g., "Navigate to product details page")

## Answer Guidelines
- Be precise and factual
- Use the exact values/text from the page
- Include units for numbers (e.g., "$19.99", "5 items", "3.5 stars")
- If multiple answers exist, enumerate them
- Don't infer information not present on the page
- Don't use external knowledge

## Examples
Question: "How many batteries are in stock?"
- Found: "150 in stock" → Answer: "150 batteries are in stock"
- Found: "Out of stock" → Answer: "The batteries are currently out of stock"
- Not found → Unable to answer: "Stock information is not displayed on this page. Navigate to the product details page to see stock levels."

Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the schema below:

'''
${bootstrapTranslator.validator.getSchemaText()}
'''
`,
            },
            ...suffixSection,
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response as {
            success: boolean;
            data?: PageContentQueryResult;
            message?: string;
        };
    }
}
