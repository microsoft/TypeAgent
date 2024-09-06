// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    //createLanguageModel,
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    MultimodalPromptContent,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import path from "path";
import fs from "fs";
import { HtmlFragments } from "../common/translator.js";
import { openai as ai } from "aiclient";

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
        //const inputHtml = JSON.stringify(contentFragments, undefined, 2);
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

export class ECommerceSiteAgent<T extends object> {
    schema: string;
    pageSchema: string;

    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<T>;

    constructor(schema: string, schemaName: string, fastModelName: string) {
        this.schema = schema;
        this.model = ai.createJsonChatModel(fastModelName);
        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);

        this.pageSchema = fs.readFileSync(
            path.join("src", "commerce", "schema", "landingPage.ts"),
            "utf8",
        );
    }

    private getPagePromptSections<U extends object>(
        translator: TypeChatJsonTranslator<U>,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
            Use the layout information provided to generate a "${translator.validator.getTypeName()}" response using the typescript schema below:
            
            '''
            ${translator.validator.getSchemaText()}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
            `,
            },
        ];
        return promptSections;
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
            Use the layout information provided and the user request below to generate a SINGLE "${translator.validator.getTypeName()}" response using the typescript schema below:
            
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

    private getPageChatResponsePrompt<U extends object>(
        translator: TypeChatJsonTranslator<U>,
        userQuestion: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const screenshotSection = getScreenshotPromptSection(
            screenshot,
            fragments,
        );
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
            Use the layout information provided to generate a "${translator.validator.getTypeName()}" response using the typescript schema below:
            
            '''
            ${translator.validator.getSchemaText()}
            '''

            Here is the user's question about the page:
            '''
            ${userQuestion}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
            `,
            },
        ];
        return promptSections;
    }

    private getBootstrapTranslator(schemaPath: string, targetType: string) {
        const pageSchema = fs.readFileSync(schemaPath, "utf8");

        const validator = createTypeScriptJsonValidator(pageSchema, targetType);
        const bootstrapTranslator = createJsonTranslator(this.model, validator);

        bootstrapTranslator.createRequestPrompt = (input: string) => {
            console.log(input);
            return "";
        };

        return bootstrapTranslator;
    }

    async getPageData(
        pageType: CommercePageType,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        let pagePath = "";
        let pageSchemaType = "";

        switch (pageType) {
            case CommercePageType.Landing: {
                pagePath = path.join(
                    "src",
                    "commerce",
                    "schema",
                    "landingPage.ts",
                );
                pageSchemaType = "LandingPage";
                break;
            }
            case CommercePageType.SearchResults: {
                pagePath = path.join(
                    "src",
                    "commerce",
                    "schema",
                    "searchResultsPage.ts",
                );
                pageSchemaType = "SearchPage";
                break;
            }
            case CommercePageType.ProductDetails: {
                pagePath = path.join(
                    "src",
                    "commerce",
                    "schema",
                    "productDetailsPage.ts",
                );
                pageSchemaType = "ProductDetailsPage";
                break;
            }
            default: {
                throw new Error("Invalid page type");
                break;
            }
        }

        const bootstrapTranslator = this.getBootstrapTranslator(
            pagePath,
            pageSchemaType,
        );

        const promptSections = this.getPagePromptSections(
            bootstrapTranslator,
            fragments,
            screenshot,
        ) as MultimodalPromptContent[];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: promptSections },
        ]);
        return response;
    }

    async getPageChatResponse(
        question: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const schemaPath = path.join(
            "src",
            "commerce",
            "schema",
            "pageChatSchema.ts",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            schemaPath,
            "PageChat",
        );

        const promptSections = this.getPageChatResponsePrompt(
            bootstrapTranslator,
            question,
            fragments,
            screenshot,
        ) as MultimodalPromptContent[];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: promptSections },
        ]);
        return response;
    }

    async getPageComponentSchema(
        componentTypeName: string,
        userRequest?: string,
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const schemaPath = path.join(
            "src",
            "commerce",
            "schema",
            "pageComponents.ts",
        );

        const bootstrapTranslator = this.getBootstrapTranslator(
            schemaPath,
            componentTypeName,
        );

        const promptSections = this.getCssSelectorForElementPrompt(
            bootstrapTranslator,
            userRequest,
            fragments,
            screenshot,
        ) as MultimodalPromptContent[];

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: promptSections },
        ]);
        return response;
    }
}
