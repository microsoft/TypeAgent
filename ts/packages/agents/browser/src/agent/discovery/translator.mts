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
import { UserActionsList } from "./schema/userActionsPool.mjs";


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
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
    const userActionsPoolSchema = await getSchemaFileContents(
        "userActionsPool.mts",
    );
    const pageTypesSchema = await getSchemaFileContents("pageTypes.mts");

    const agent = new SchemaDiscoveryAgent<SchemaDiscoveryActions>(
        userActionsPoolSchema,
        pageTypesSchema,
        "UserPageActions",
        model,
    );
    return agent;
}

export class SchemaDiscoveryAgent<T extends object> {
    pageTypesSchema: string;
    userActionsPoolSchema: string;

    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<T>;

    constructor(
        userActionsPoolSchema: string,
        pageTypesSchema: string,
        schemaName: string,
        fastModelName: string,
    ) {
        this.userActionsPoolSchema = userActionsPoolSchema;
        this.pageTypesSchema = pageTypesSchema;

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            fastModelName,
        );
        this.model = ai.createChatModel(apiSettings, undefined, undefined, [
            "schemaDiscovery",
        ]);
        const validator = createTypeScriptJsonValidator<T>(
            this.userActionsPoolSchema,
            schemaName,
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
        const pageSchema = targetSchema ?? this.userActionsPoolSchema;

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
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
        pageSummary?: string,
    ) {
        // prompt - present html, optional screenshot and list of candidate actions
        const bootstrapTranslator = this.getBootstrapTranslator(
            "UserActionsList",
            this.userActionsPoolSchema,
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
        if (pageSummary) {
            requestSection.push({
                type: "text",
                text: `
               
            Here is a previously-generated summary of the page
            '''
            ${pageSummary}
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
        Examine the layout information provided and determine the set of possible UserPageActions users can take on the page.
        Once you have this list, a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
        If there are multiple UserPageActions of the same type, only return the first one in the output object.
        
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

    async unifyUserActions(
        candidateActions: UserActionsList,
        pageDescription?: PageDescription,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const unifiedActionsSchema = await getSchemaFileContents("unifiedActions.mts");
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

    async getPageLayout(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents("PageLayout.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageLayout",
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
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getPageType(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
        pageSummary?: string,
    ) {
        const resultsSchema = await getSchemaFileContents("pageTypes.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "KnownPageTypes",
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
        if (pageSummary) {
            requestSection.push({
                type: "text",
                text: `
               
            Here is a previously-generated summary of the page
            '''
            ${pageSummary}
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
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);
        return response;
    }

    async getSiteType(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
        pageSummary?: string,
    ) {
        const resultsSchema = await getSchemaFileContents("siteTypes.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "WebsiteCategory",
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
        if (pageSummary) {
            requestSection.push({
                type: "text",
                text: `
               
            Here is a previously-generated summary of the page
            '''
            ${pageSummary}
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
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
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
               
            Here are existing intent names. When picking a name for the new user intent, make sure you use a unique value that is not similar to the values on this list.
            '''
            ${JSON.stringify(existingActionNames)}
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

    async getDetailedStepsFromDescription(
        recordedActionName: string,
        recordedActionDescription: string,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents(
            "expandDescription.mts",
        );
        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageActionsList",
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

        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
        Examine the layout information provided as well as the user action description. Use this information to create a detailed set of steps, including
        the HTML elements that the user would need to interact with. Based on this
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

    async getWebPlanRunResult(
        recordedActionName: string,
        recordedActionDescription: string,
        parameters: Map<string, any>,
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents("evaluatePlan.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "WebPlanResult",
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

        Thw task was run on the page using the parameters:
        '''
        ${JSON.stringify(Object.fromEntries(parameters))}
        '''
        `,
        });

        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
    Examine the layout information provided as well as the user action description. Use this information to determine whether the task goal has
    been met in the provided webpage. Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
            
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

    async getWebPlanSuggestedSteps(
        recordedActionName: string,
        recordedActionDescription: string,
        currentSteps?: string[],
        fragments?: HtmlFragments[],
        screenshots?: string[],
    ) {
        const resultsSchema = await getSchemaFileContents("evaluatePlan.mts");
        const bootstrapTranslator = this.getBootstrapTranslator(
            "WebPlanSuggestions",
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
        if (currentSteps !== undefined && currentSteps.length > 0) {
            requestSection.push({
                type: "text",
                text: `
               
            Here are the steps that are already included in the plan
            '''
            ${JSON.stringify(currentSteps)}
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
    Examine the layout information provided as well as the user action description. Use this information to determine whether the task goal has
    been met in the provided webpage. If the goal has not been met, or if there are steps missing from the current list, suggest the next steps the user can take in the UI.
    Generate a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
            
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
