// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createJsonTranslator,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
    PromptSection,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { Crossword } from "./schema/pageSchema.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { openai as ai } from "aiclient";

export type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

function getBootstrapPrefixPromptSection() {
    let prefixSection = [];
    prefixSection.push({
        role: "system",
        content:
            "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
    });
    return prefixSection;
}

function getHtmlPromptSection(fragments: HtmlFragments[] | undefined) {
    let htmlSection = [];
    if (fragments) {
        const textFragments = fragments.map((a) => a.content);
        const inputHtml = JSON.stringify(textFragments, undefined, 2);
        htmlSection.push({
            role: "user",
            content: `
          Here are HTML fragments from the page.
          '''
          ${inputHtml}
          '''
      `,
        });
    }
    return htmlSection;
}

function getHtmlTextOnlyPromptSection(fragments: HtmlFragments[] | undefined) {
    let htmlSection = [];
    if (fragments) {
        const textFragments = fragments.map((a) => a.text);
        const inputText = JSON.stringify(textFragments, undefined, 2);
        htmlSection.push({
            role: "user",
            content: `
          Here are Text fragments from the page.
          '''
          ${inputText}
          '''
      `,
        });
    }
    return htmlSection;
}

export async function createCrosswordPageTranslator(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
    const packageRoot = path.join("..", "..", "..");
    const pageSchema = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/crossword/schema/pageSchema.mts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );

    const presenceSchema = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/crossword/schema/pageFrame.mts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );

    const agent = new CrosswordPageTranslator<Crossword>(
        pageSchema,
        presenceSchema,
        "Crossword",
        model,
    );
    return agent;
}

export class CrosswordPageTranslator<T extends object> {
    schema: string;
    schemaName: string;
    model: TypeChatLanguageModel;
    translator: TypeChatJsonTranslator<T>;
    presenceSchema: string;

    constructor(
        schema: string,
        presenceSchema: string,
        schemaName: string,
        fastModelName: string,
    ) {
        this.schema = schema;
        this.schemaName = schemaName;
        this.presenceSchema = presenceSchema;

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            fastModelName,
        );
        this.model = ai.createChatModel(apiSettings, undefined, undefined, [
            "crossword",
        ]);

        const validator = createTypeScriptJsonValidator<T>(
            this.schema,
            schemaName,
        );
        this.translator = createJsonTranslator(this.model, validator);
    }

    getCluesTextOnlyPromptSections(fragments?: HtmlFragments[]) {
        const htmlSection = getHtmlTextOnlyPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...htmlSection,
            {
                role: "user",
                content: `
            Use the layout information provided to generate a "${this.schemaName}" response using the typescript schema below.Note that you must include the complete response.
            This MUST include all the clues in the crossword. 
            
            '''
            ${this.schema}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined. Look carefuly at the
            schema definition and make sure no extra properties that are not part of the target type are returned:          
        `,
            },
        ];
        return promptSections;
    }

    getSelectorsForCluesTextSections(
        fragments: HtmlFragments[],
        partialData: Crossword,
    ) {
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...htmlSection,
            {
                role: "user",
                content: `
            Here is the existing "Crossword" data generated from previous interactions. 
            
            '''
            ${JSON.stringify(partialData, undefined, 2)}
            '''
        `,
            },
            {
                role: "user",
                content: `
            Use the layout information provided to generate updated "Crossword" response by adding CSS Selector information. Use the crossword clue information
            already identified above to locate the HTML elements that should be used in CSS Selectors. Here is the Typescript Schema for Crossword elements" 
            
            '''
            ${this.schema}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined. Look carefuly at the
            schema definition and make sure no extra properties that are not part of the target type are returned:          
        `,
            },
        ];
        return promptSections;
    }

    getCluesTextWithSelectorsPromptSections(fragments?: HtmlFragments[]) {
        const htmlSection = getHtmlPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...htmlSection,
            {
                role: "user",
                content: `
            Use the layout information provided to generate a "${this.schemaName}" response using the typescript schema below.Note that you must include the complete response.
            This MUST include all the clues in the crossword. 
            
            '''
            ${this.schema}
            '''
            
            The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined. Look carefuly at the
            schema definition and make sure no extra properties that are not part of the target type are returned:          
        `,
            },
        ];
        return promptSections;
    }

    getIsCrosswordPresentPromptSections(fragments?: HtmlFragments[]) {
        const htmlSection = getHtmlPromptSection(fragments);
        // const htmlSection = getHtmlTextOnlyPromptSection(fragments);
        const prefixSection = getBootstrapPrefixPromptSection();
        const promptSections = [
            ...prefixSection,
            ...htmlSection,
            {
                role: "user",
                content: `
        Use the layout information provided to generate a "CrosswordPresence" response using the typescript schema below:
        
        '''
        ${this.presenceSchema}
        '''
        
        The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:            
        `,
            },
        ];
        return promptSections;
    }

    async getCluesTextWithSelectors(fragments: HtmlFragments[]) {
        const promptSections = this.getCluesTextWithSelectorsPromptSections(
            fragments,
        ) as PromptSection[];

        // overtride default create prompt
        this.translator.createRequestPrompt = (input: string) => {
            return "";
        };

        const response = await this.translator.translate("", promptSections);
        return response;
    }

    async getCluesText(fragments?: HtmlFragments[]) {
        const promptSections = this.getCluesTextOnlyPromptSections(
            fragments,
        ) as PromptSection[];

        // overtride default create prompt
        this.translator.createRequestPrompt = (input: string) => {
            return "";
        };

        const response = await this.translator.translate("", promptSections);
        return response;
    }

    async getCluesSelectorsForText(
        fragments: HtmlFragments[],
        partialData: Crossword,
    ) {
        const promptSections = this.getSelectorsForCluesTextSections(
            fragments,
            partialData,
        ) as PromptSection[];

        // overtride default create prompt
        this.translator.createRequestPrompt = (input: string) => {
            return "";
        };

        const response = await this.translator.translate("", promptSections);
        return response;
    }

    async getCluesTextThenSelectors(fragments: HtmlFragments[]) {
        console.time("getting clues text");
        const cluesTextResult = await this.getCluesText(fragments);
        console.timeEnd("getting clues text");

        if (cluesTextResult.success) {
            console.time("getting clues css selectors");
            const cluesTextPortion = cluesTextResult.data as Crossword;
            // return this.getCluesSelectorsForText(fragments, cluesTextPortion);
            const cluesTextWithSelectorsResult =
                await this.getCluesSelectorsForText(
                    fragments,
                    cluesTextPortion,
                );
            console.timeEnd("getting clues css selectors");

            return cluesTextWithSelectorsResult;

            /*
      if(cluesTextWithSelectorsResult.success){
        const consolidatedCrossword = cluesTextWithSelectorsResult.data as Crossword;
        return consolidatedCrossword;
      }
        */
        }

        return;
    }

    async checkIsCrosswordOnPage(fragments?: HtmlFragments[]) {
        const promptSections = this.getIsCrosswordPresentPromptSections(
            fragments,
        ) as PromptSection[];

        const validator = createTypeScriptJsonValidator(
            this.presenceSchema,
            "CrosswordPresence",
        );
        const bootstrapTranslator = createJsonTranslator(this.model, validator);

        bootstrapTranslator.createRequestPrompt = (input: string) => {
            return "";
        };

        const response = await bootstrapTranslator.translate(
            "",
            promptSections,
        );
        return response;
    }
}
