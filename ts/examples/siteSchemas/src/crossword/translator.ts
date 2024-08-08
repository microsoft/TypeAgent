// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { ChatModelWithStreaming, openai as ai } from "aiclient";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { ContentSection, HtmlFragments } from "../common/translator.js";

import path from "path";
import fs from "fs";

import { CluesTextAndSelectorsList } from "./schema/bootstrapSchema.js";

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
        const inputHtml = JSON.stringify(fragments, undefined, 2);
        htmlSection.push({
            type: "text",
            text: `
          Here are HTML fragments from the page.
          '''
          ${inputHtml}
          '''
      `,
        });
    }
    return htmlSection;
}

function getScreenshotPromptSection(screenshot: string | undefined) {
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

        screenshotSection.push({
            type: "text",
            text: `Use the top left corner as coordinate 0,0 and draw a virtual grid of 1x1 pixels, 
                   where x values increase for each pixel as you go from left to right, and y values increase 
                   as you go from top to bottom. 
            `,
        });
    }
    return screenshotSection;
}

function getUpdataBoardPrefixPromptSection() {
    // TODO: update this to use system role
    let prefixSection = [];
    prefixSection.push({
        type: "text",
        text: `user: You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.
    system:
    IMPORTANT CONTEXT for the user request:
    `,
    });
    return prefixSection;
}

export class CrosswordAgent<T extends object> {
    schema: string;
    boardSchema: string;

    model: ChatModelWithStreaming;
    translator: TypeChatJsonTranslator<T>;

    constructor(
        schema: string,
        schemaName: string,
        vals: Record<string, string>,
    ) {
        this.schema = schema;
        const apiSettings = ai.azureApiSettingsFromEnv(ai.ModelType.Chat, vals);

        // this.model = createLanguageModel(vals);
        this.model = ai.createChatModel(apiSettings);
        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);

        this.boardSchema = fs.readFileSync(
            path.join("src", "crossword", "schema", "bootstrapSchema.ts"),
            "utf8",
        );
    }

    getIsCrosswordPresentPromptSections(
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const screenshotSection = getScreenshotPromptSection(screenshot);
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
            Use the layout information provided to generate a "CrosswordPresence" response using the typescript schema below:
            
            '''
            ${this.boardSchema}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
            `,
            },
        ];
        return promptSections;
    }

    getCluesTextWithSelectorsPromptSections(
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const screenshotSection = getScreenshotPromptSection(screenshot);
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...screenshotSection,
            ...htmlSection,
            {
                type: "text",
                text: `
            Use the layout information provided to generate a "CluesTextAndSelectorsList" response using the typescript schema below.Note that you must include the complete response.
            This MUST include all the clues in the crossword. 
            
            '''
            ${this.boardSchema}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined. Look carefuly at the
            schema definition and make sure no extra properties that are not part of the target type are returned:          
        `,
            },
        ];
        return promptSections;
    }

    changeBoardPromptSectionsFromClues(
        boardMetadata: CluesTextAndSelectorsList,
        intent: string,
    ) {
        const prefixSection = getUpdataBoardPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            {
                type: "text",
                text: `
          Here is a JSON object that presents the game board, including the clues and the CSS selectors for various elements.
          '''
          ${JSON.stringify(boardMetadata, undefined, 2)}
          '''
          Answer the user's request using the context provided above. Format your response into a series of "BoardActions" using the typescript schema below:
          '''
          ${this.schema}
          
          '''
          Remember that to enter a solution, you first need to click on the relevant clue then enter text.

          user:
          The following is a user request:
          '''
          ${intent}
          '''
          The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:     
       `,
            },
        ];
        return promptSections;
    }

    private getBootstrapTranslator(targetType: string) {
        const validator = createTypeScriptJsonValidator(
            this.boardSchema,
            targetType,
        );
        const bootstrapTranslator = createJsonTranslator(this.model, validator);

        bootstrapTranslator.createRequestPrompt = (input: string) => {
            console.log(input);
            return "";
        };

        return bootstrapTranslator;
    }

    async getCluesTextWithSelectors(
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const promptSections = this.getCluesTextWithSelectorsPromptSections(
            fragments,
            screenshot,
        ) as ContentSection[];

        const bootstrapTranslator = this.getBootstrapTranslator(
            "CluesTextAndSelectorsList",
        );

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async checkIsCrosswordOnPage(
        fragments?: HtmlFragments[],
        screenshot?: string,
    ) {
        const promptSections = this.getIsCrosswordPresentPromptSections(
            fragments,
            screenshot,
        ) as ContentSection[];

        const bootstrapTranslator =
            this.getBootstrapTranslator("CrosswordPresence");

        const response = await bootstrapTranslator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }

    async updateBoardFromCluesList(
        clues: CluesTextAndSelectorsList,
        intent: string,
    ) {
        const promptSections = this.changeBoardPromptSectionsFromClues(
            clues,
            intent,
        ) as ContentSection[];

        this.translator.createRequestPrompt = (input: string) => {
            console.log(input);
            return "";
        };
        const response = await this.translator.translate("", [
            { role: "user", content: JSON.stringify(promptSections) },
        ]);
        return response;
    }
}
