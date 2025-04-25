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

function getBootstrapPrefixPromptSection() {
    // TODO: update this to use system role
    let prefixSection = [];
    prefixSection.push({
        type: "text",
        text: "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
    });
    return prefixSection;
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
        const prefixSection = getBootstrapPrefixPromptSection();
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

        const prefixSection = getBootstrapPrefixPromptSection();
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
  1. If you believe the user's request has been FULLY completed, you can respond with actionName: "PlanCompleted" and no parameters.
  
  
  # Instructions
  1. Analyze the user's request and the current browser state
  2. Determine the most appropriate next action to take
  3. Select the action from the available actions list
  4. Provide the necessary parameters for the selected action
  5. Respond with ONLY a JSON object containing the actionName and parameters
  
  Always ensure that:
- The actionName corresponds to one of the available actions or "PlanCompleted"
- All required parameters for the action are provided
- Parameter types match what's expected (string, number, boolean)
- Your reasoning is deliberate and goal-oriented towards completing the user's request
- You select "PlanCompleted" only when you are certain the user's request has been fully completed

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
}
