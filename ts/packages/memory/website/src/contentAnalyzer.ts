// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChatTranslator, loadSchema } from "typeagent";
import { ChatModel } from "aiclient";
import { ContentAnalysis } from "./schemas/contentAnalysisSchema.js";
import {
    PageContent,
    MetaTagCollection,
    StructuredDataCollection,
} from "./contentExtractor.js";

export class ContentAnalyzer {
    private translator: any;

    constructor(model: ChatModel) {
        this.translator = createChatTranslator<ContentAnalysis>(
            model,
            loadSchema(["schemas/contentAnalysisSchema.ts"], import.meta.url),
            "ContentAnalysis",
        );
    }

    async analyzeContent(
        url: string,
        pageContent?: PageContent,
        metaTags?: MetaTagCollection,
        structuredData?: StructuredDataCollection,
    ): Promise<ContentAnalysis | null> {
        try {
            const analysisPrompt = this.buildAnalysisPrompt(
                url,
                pageContent,
                metaTags,
                structuredData,
            );
            const result = await this.translator.translate(analysisPrompt);

            if (result.success) {
                return result.data;
            } else {
                console.warn(
                    `Content analysis failed for ${url}: ${result.message}`,
                );
                return null;
            }
        } catch (error) {
            console.warn(`Content analysis error for ${url}:`, error);
            return null;
        }
    }

    private buildAnalysisPrompt(
        url: string,
        pageContent?: PageContent,
        metaTags?: MetaTagCollection,
        structuredData?: StructuredDataCollection,
    ): string {
        let prompt = `Analyze the following web page content and provide a structured analysis using the ContentAnalysis schema.

URL: ${url}

`;

        if (pageContent) {
            prompt += `TITLE: ${pageContent.title}

MAIN CONTENT (${pageContent.wordCount} words, ${pageContent.readingTime} min read):
${pageContent.mainContent.substring(0, 2000)}${pageContent.mainContent.length > 2000 ? "..." : ""}

`;

            if (pageContent.headings.length > 0) {
                prompt += `HEADINGS:
${pageContent.headings.slice(0, 10).join("\n")}

`;
            }

            if (pageContent.codeBlocks && pageContent.codeBlocks.length > 0) {
                prompt += `CODE EXAMPLES (${pageContent.codeBlocks.length} blocks):
${pageContent.codeBlocks
    .slice(0, 3)
    .map((code) => code.substring(0, 200))
    .join("\n---\n")}

`;
            }
        }

        if (metaTags) {
            if (metaTags.description) {
                prompt += `META DESCRIPTION: ${metaTags.description}

`;
            }

            if (metaTags.keywords && metaTags.keywords.length > 0) {
                prompt += `KEYWORDS: ${metaTags.keywords.join(", ")}

`;
            }
        }

        if (structuredData?.schemaType) {
            prompt += `STRUCTURED DATA TYPE: ${structuredData.schemaType}

`;
        }

        return prompt;
    }
}
