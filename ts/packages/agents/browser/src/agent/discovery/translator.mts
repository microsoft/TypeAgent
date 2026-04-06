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
import { SchemaDiscoveryActions } from "./schema/discoveryActions.mjs";
import { PageDescription } from "./schema/pageSummary.mjs";
import registerDebug from "debug";

const debugPerf = registerDebug("typeagent:browser:discover:perf");

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
    screenshots: string[] | undefined,
    fragments: HtmlFragments[] | undefined,
) {
    let screenshotSection = [];
    if (
        screenshots !== undefined &&
        Array.isArray(screenshots) &&
        screenshots.length > 0
    ) {
        screenshots.forEach((screenshot) => {
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
        });

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
    }
    return screenshotSection;
}

async function getSchemaFileContents(fileName: string): Promise<string> {
    const packageRoot = path.join("..", "..", "..");
    return await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/discovery/schema",
                    fileName,
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

export async function createDiscoveryPageTranslator(
    model:
        | "GPT_35_TURBO"
        | "GPT_4"
        | "GPT_v"
        | "GPT_4_O"
        | "GPT_5_MINI"
        | "GPT_5_2",
) {
    const pageSummarySchema = await getSchemaFileContents("pageSummary.mts");

    const agent = new SchemaDiscoveryAgent<SchemaDiscoveryActions>(
        pageSummarySchema,
        model,
    );
    return agent;
}

export class SchemaDiscoveryAgent<T extends object> {
    defaultSchema: string;

    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<T>;

    constructor(defaultSchema: string, fastModelName: string) {
        this.defaultSchema = defaultSchema;

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            fastModelName,
        );
        this.model = ai.createChatModel(
            apiSettings,
            { temperature: 1 },
            undefined,
            ["schemaDiscovery"],
        );
        const validator = createTypeScriptJsonValidator<T>(
            this.defaultSchema,
            "PageDescription",
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    private getCssSelectorForElementPrompt<U extends object>(
        translator: TypeChatJsonTranslator<U>,
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
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
        Use the layout information provided and the user request below to generate a SINGLE "${translator.validator.getTypeName()}" response using the typescript schema below.
        For schemas that include CSS selectors, construct the selector based on the element's Id attribute if the id is present.
        You should stop searching and return current result as soon as you find a result that matches the user's criteria:
        
        '''
        ${translator.validator.getSchemaText()}
        '''
        `,
            },
            ...requestSection,
            ...suffixSection,
        ];
        return promptSections;
    }

    private getBootstrapTranslator(targetType: string, targetSchema?: string) {
        const pageSchema = targetSchema ?? this.defaultSchema;

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
        screenshots?: string[],
    ) {
        const componentsSchema =
            await getSchemaFileContents("pageComponents.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            componentTypeName,
            componentsSchema,
        );

        const promptSections = this.getCssSelectorForElementPrompt(
            bootstrapTranslator,
            userRequest,
            fragments,
            screenshots,
        ) as ContentSection[];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getCandidateUserActions(
        discoverySchema: string,
        fragments?: HtmlFragments[],
    ) {
        const bootstrapTranslator = this.getBootstrapTranslator(
            "CandidateActionList",
            discoverySchema,
        );

        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getPrefixPromptSection();
        const suffixSection = getSuffixPromptSection();

        const promptSections = [
            ...prefixSection,
            ...htmlSection,
            {
                type: "text",
                text: `
        You are given a list of known user actions for this website. Determine which actions are relevant
        by examining the page and considering the action descriptions.

        Include an action if EITHER:
        1. It can be performed directly on this page (e.g., there is a matching button, form, or element), OR
        2. Its description indicates it can navigate or search to reach the right context (e.g., "Search for
           a product and add it to cart" is relevant on any page that has a search input, even if no product
           is currently shown).

        Exclude an action only if it is clearly unrelated to this website's purpose (e.g., restaurant
        reservation actions on an e-commerce site).

        If none of the known actions apply, return an empty actions array.
        Return a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.

        '''
        ${bootstrapTranslator.validator.getSchemaText()}
        '''
        `,
            },
            ...suffixSection,
        ];

        const promptChars = promptSections.reduce(
            (sum, s: any) => sum + (s.text?.length || 0),
            0,
        );
        debugPerf(`  [getCandidateUserActions] prompt: ${promptChars} chars`);
        const llmStart = Date.now();
        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        debugPerf(
            `  [getCandidateUserActions] LLM translate: ${Date.now() - llmStart}ms`,
        );
        return response;
    }

    async unifyUserActions(
        candidateActions: { actions: any[] },
        pageDescription?: PageDescription,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const unifiedActionsSchema =
            await getSchemaFileContents("unifiedActions.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "UnifiedActionsList",
            unifiedActionsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshots,
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
        You need to create a unified, de-duplicated list of user actions from two sources:
        
        1. Page Summary Actions (high-level user capabilities):
        '''
        ${JSON.stringify(pageDescription?.possibleUserAction, null, 2)}
        '''
        
        2. Candidate Actions (detailed schema-based actions):
        '''
        ${JSON.stringify(candidateActions.actions, null, 2)}
        '''
        
        Create a de-duplicated list combining these inputs. Rules for deduplication:
        - Combine similar actions (e.g., "purchase item" and "buy product" → "buy product")
        - Prefer more specific descriptions from candidate actions
        - If page summary has high-level action like "order food" and candidate has "add item to cart", 
          create unified action "add food to cart" that captures both intents
        - Include originalCount (total from both sources) and finalCount (after deduplication)
        
        Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
        
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
        return response;
    }

    async getPageSummary(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents("pageSummary.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageDescription",
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

    async getIntentSchemaFromRecording(
        recordedActionName: string,
        existingActionNames: string[],
        recordedActionDescription: string,
        recordedActionSteps?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents(
            "recordedActions.mts",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "UserIntent",
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
        requestSection.push({
            type: "text",
            text: `
               
            The user provided an example of how they would complete the ${recordedActionName} action on the webpage. 
            They provided a description of the task below:
            '''
            ${recordedActionDescription}
            '''
            `,
        });

        if (recordedActionSteps) {
            requestSection.push({
                type: "text",
                text: `
               
            Here are the recorded steps that the user went through on the webpage to complete the action.
            '''
            ${recordedActionSteps}
            '''
            `,
            });
        }

        if (
            existingActionNames !== undefined &&
            existingActionNames.length > 0
        ) {
            requestSection.push({
                type: "text",
                text: `

            IMPORTANT: Here are existing intent names. When picking a name for the new user intent, make sure you use a unique value that is not similar to the values on this list.
            '''
            ${[...existingActionNames]}
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
        Examine the layout information provided as well as the user action information. Based on this
        generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
                
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
        '''
        `,
            },
            ...requestSection,
            ...suffixSection,
        ];

        const response = await bootstrapTranslator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getActionStepsSchemaFromRecording(
        recordedActionName: string,
        recordedActionDescription: string,
        intentSchema?: any,
        recordedActionSteps?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents(
            "recordedActions.mts",
        );
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageActionsPlan",
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
        requestSection.push({
            type: "text",
            text: `
               
            The user provided an example of how they would complete the ${recordedActionName} action on the webpage. 
            They provided a description of the task below:
            '''
            ${recordedActionDescription}
            '''

            Here is a JSON representation of the parameters that a user can provide when invoking the ${recordedActionName} action.

            '''
            ${JSON.stringify(intentSchema, undefined, 2)}
            '''

            `,
        });

        if (recordedActionSteps) {
            requestSection.push({
                type: "text",
                text: `
               
            Here are the recorded steps that the user went through on the webpage to complete the action.
            '''
            ${recordedActionSteps}
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
        Examine the layout information provided as well as the user action information. Based on this
        generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
                
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
        '''
        `,
            },
            ...requestSection,
            ...suffixSection,
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
