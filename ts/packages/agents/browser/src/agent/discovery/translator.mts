// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import path from "path";
import fs from "fs";
import { openai as ai } from "aiclient";
import { fileURLToPath } from "node:url";
import { SchemaDiscoveryActions } from "./schema/discoveryActions.mjs";

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

export async function createDiscoveryPageTranslator(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
    const packageRoot = path.join("..", "..", "..");

    const userActionsPoolSchema = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/discovery/schema/userActionsPool.mts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );

    const pageTypesSchema = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/discovery/schema/pageTypes.mts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );

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
        screenshot?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const componentsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/pageComponents.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            componentTypeName,
            componentsSchema,
        );

        const promptSections = this.getCssSelectorForElementPrompt(
            bootstrapTranslator,
            userRequest,
            fragments,
            screenshot,
        ) as ContentSection[];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getCandidateUserActions(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
        pageSummary?: string,
    ) {
        // prompt - present html, optional screenshot and list of candidate actions
        const bootstrapTranslator = this.getBootstrapTranslator(
            "UserActionsList",
            this.userActionsPoolSchema,
        );

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
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getPageSummary(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/pageSummary.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageDescription",
            resultsSchema,
        );

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
        Examine the layout information provided and determine the content of the page and the actions users can take on it.
        Once you have this list, a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
                
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
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

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getPageLayout(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/PageLayout.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageLayout",
            resultsSchema,
        );

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
        Examine the layout information provided and determine the content of the page and the actions users can take on it.
        Once you have this list, a SINGLE "${bootstrapTranslator.validator.getTypeName()}" response using the typescript schema below.
                
        '''
        ${bootstrapTranslator.validator.getSchemaText()}
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

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getPageType(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
        pageSummary?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/pageTypes.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "KnownPageTypes",
            resultsSchema,
        );

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
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getSiteType(
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
        pageSummary?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/siteTypes.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "WebsiteCategory",
            resultsSchema,
        );

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
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getIntentSchemaFromRecording(
        recordedActionName: string,
        recordedActionDescription: string,
        recordedActionSteps?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/recordedActions.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "UserIntent",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
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
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async getActionStepsSchemaFromRecording(
        recordedActionName: string,
        recordedActionDescription: string,
        intentSchema?: any,
        recordedActionSteps?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const packageRoot = path.join("..", "..", "..");
        const resultsSchema = await fs.promises.readFile(
            fileURLToPath(
                new URL(
                    path.join(
                        packageRoot,
                        "./src/agent/discovery/schema/recordedActions.mts",
                    ),
                    import.meta.url,
                ),
            ),
            "utf8",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            "PageManipulationActionsList",
            resultsSchema,
        );

        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
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
            {
                type: "text",
                text: `
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }
}
