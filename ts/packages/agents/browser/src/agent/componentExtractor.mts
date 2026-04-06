// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslator, MultimodalPromptContent } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";

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

export async function extractPageComponent(
    typeName: string,
    schema: string,
    userRequest?: string,
    fragments?: HtmlFragments[],
    screenshot?: string,
) {
    const apiSettings = ai.azureApiSettingsFromEnv(
        ai.ModelType.Chat,
        undefined,
        "GPT_5_MINI",
    );
    const model = ai.createChatModel(
        apiSettings,
        { temperature: 1 },
        undefined,
        ["componentExtraction"],
    );

    // Wrap schema in export type for TypeChat compatibility
    const fullSchema = schema.startsWith("export")
        ? schema
        : `export type ${typeName} = ${schema};`;

    const validator = createTypeScriptJsonValidator(fullSchema, typeName);
    const translator = createJsonTranslator(model, validator);

    translator.createRequestPrompt = () => "";

    const promptSections = buildExtractionPrompt(
        typeName,
        fullSchema,
        userRequest,
        fragments,
        screenshot,
    );

    const response = await translator.translate("", [
        { role: "user", content: promptSections as MultimodalPromptContent[] },
    ]);

    return response;
}

function buildExtractionPrompt(
    typeName: string,
    schema: string,
    userRequest?: string,
    fragments?: HtmlFragments[],
    screenshot?: string,
): ContentSection[] {
    const sections: ContentSection[] = [];

    // System context
    sections.push({
        type: "text",
        text: "You are a virtual assistant that can help users to complete requests by interacting with the UI of a webpage.",
    });

    // Screenshot if available
    if (screenshot) {
        sections.push({
            type: "text",
            text: "Here is a screenshot of the currently visible webpage:",
        });
        sections.push({
            type: "image_url",
            image_url: { url: screenshot },
        });
    }

    // Text content from fragments
    if (fragments) {
        const textContent = fragments.map((f) => f.text).filter(Boolean);
        if (textContent.length > 0) {
            sections.push({
                type: "text",
                text: `Here is the text content of the page:
'''
${textContent.join("\n")}
'''`,
            });
        }
    }

    // HTML fragments
    if (fragments) {
        const htmlContent = fragments.map((f) => f.content);
        sections.push({
            type: "text",
            text: `Here are HTML fragments from the page:
'''
${htmlContent.join("\n")}
'''`,
        });
    }

    // Schema and extraction instruction
    sections.push({
        type: "text",
        text: `Use the layout information provided and the user request below to generate a SINGLE "${typeName}" response using the typescript schema below.
For schemas that include CSS selectors, construct the selector based on the element's Id attribute if the id is present.
You should stop searching and return current result as soon as you find a result that matches the user's criteria:

'''
${schema}
'''`,
    });

    // User request context
    if (userRequest) {
        sections.push({
            type: "text",
            text: `Here is the user request:
'''
${userRequest}
'''`,
        });
    }

    sections.push({
        type: "text",
        text: "The following is the COMPLETE JSON response object with 2 spaces of indentation and no properties with the value undefined:",
    });

    return sections;
}
