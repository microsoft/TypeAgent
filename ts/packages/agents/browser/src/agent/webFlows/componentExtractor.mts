// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl } from "../../common/browserControl.mjs";
import {
    ComponentDefinition,
    ExtractComponentFn,
} from "./webFlowBrowserApi.mjs";
import { openai as ai } from "aiclient";
import { createJsonTranslator, MultimodalPromptContent } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflow:extractor");

/**
 * Creates an extraction function that uses the browser and LLM to extract
 * UI components from the current page.
 */
export function createComponentExtractor(
    browser: BrowserControl,
): ExtractComponentFn {
    return async (
        componentDef: ComponentDefinition,
        userRequest?: string,
    ): Promise<unknown> => {
        const htmlFragments = await browser.getHtmlFragments(
            false,
            "knowledgeExtraction",
        );

        let screenshot: string | undefined;
        try {
            screenshot = await browser.captureScreenshot();
        } catch {
            debug("Screenshot capture failed for component extraction");
        }

        const apiSettings = ai.azureApiSettingsFromEnv(
            ai.ModelType.Chat,
            undefined,
            "GPT_4_O_MINI",
        );
        const model = ai.createChatModel(apiSettings);

        const schema = `export type ${componentDef.typeName} = ${componentDef.schema}`;
        const validator = createTypeScriptJsonValidator<object>(
            schema,
            componentDef.typeName,
        );
        const translator = createJsonTranslator(model, validator);

        const promptSections: any[] = [];

        if (screenshot) {
            promptSections.push({
                type: "image_url",
                image_url: { url: screenshot },
            });
        }

        if (htmlFragments) {
            const htmlText = Array.isArray(htmlFragments)
                ? htmlFragments
                      .map((f: any) => f.content || f.text || "")
                      .join("\n")
                : String(htmlFragments);
            promptSections.push({
                type: "text",
                text: `Page HTML:\n${htmlText.substring(0, 30000)}`,
            });
        }

        const instruction = userRequest
            ? `Find the UI component that matches: "${userRequest}"\n\nExtract a ${componentDef.typeName} object with the requested information, including CSS selectors that can be used to interact with the element.`
            : `Extract a ${componentDef.typeName} object from this page, including CSS selectors that can be used to interact with the element.`;

        promptSections.push({
            type: "text",
            text: `${instruction}

Important guidelines for CSS selectors:
- Use specific, stable selectors (prefer IDs, data attributes, unique class combinations)
- For buttons, include the title or text content
- For inputs, include placeholder text if available
- For dropdowns, include available option values if present

Generate a SINGLE "${translator.validator.getTypeName()}" response using the schema:
\`\`\`
${translator.validator.getSchemaText()}
\`\`\``,
        });

        debug(
            `Extracting component: ${componentDef.typeName} - "${userRequest}"`,
        );

        const response = await translator.translate("", [
            {
                role: "user",
                content: promptSections as MultimodalPromptContent[],
            },
        ]);

        if (!response.success) {
            throw new Error(`Component extraction failed: ${response.message}`);
        }

        debug(`Extracted component:`, response.data);
        return response.data;
    };
}
