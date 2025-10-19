// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActions.mjs";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { openai as ai } from "aiclient";
import { PageQuestionResponse, SuggestedQuestion } from "./schema/pageQuestionSchema.mjs";
import registerDebug from "debug";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const debug = registerDebug("typeagent:browser:page-qna");

function getSchemaFileContents(fileName: string): string {
    const packageRoot = path.join("..", "..", "..");
    return fs.readFileSync(
        fileURLToPath(
            new URL(
                path.join(packageRoot, "./src/agent/schema", fileName),
                import.meta.url,
            ),
        ),
        "utf8",
    );
}

/**
 * QuestionGenerator creates suggested questions for page Q&A interface
 * following TypeChat patterns used throughout the project
 */
export class QuestionGenerator {
    private questionTranslator: TypeChatJsonTranslator<PageQuestionResponse> | null = null;
    private isInitialized: boolean = false;
    private schemaText: string;

    constructor() {
        this.schemaText = getSchemaFileContents("pageQuestionSchema.ts");
    }

    /**
     * Generate page-specific questions based on extracted knowledge
     */
    async generatePageQuestions(
        pageKnowledge: any,
        url: string,
    ): Promise<SuggestedQuestion[]> {
        try {
            await this.ensureInitialized();

            if (!this.questionTranslator) {
                debug("Question translator not available, returning empty array");
                return [];
            }

            debug(`Generating page questions for URL: ${url}`);

            const requestData = {
                url: url,
                entities: pageKnowledge.entities || [],
                topics: pageKnowledge.keyTopics || [],
                summary: pageKnowledge.summary || "",
                scope: "page",
                contentMetrics: pageKnowledge.contentMetrics || {},
            };

            const response = await this.questionTranslator.translate(
                JSON.stringify(requestData, null, 2)
            );

            if (!response.success) {
                debug(`Page question generation failed: ${response.message}`);
                return [];
            }

            const pageQuestions = response.data.questions.filter(
                (q: SuggestedQuestion) => q.scope === "page"
            );

            debug(`Generated ${pageQuestions.length} page-specific questions`);
            return pageQuestions;

        } catch (error) {
            debug(`Error generating page questions: ${error}`);
            return [];
        }
    }

    /**
     * Generate broader questions based on knowledge graph connections
     */
    async generateGraphQuestions(
        relatedEntities: any[],
        relatedTopics: any[],
        url: string,
    ): Promise<SuggestedQuestion[]> {
        try {
            await this.ensureInitialized();

            if (!this.questionTranslator) {
                debug("Question translator not available, returning empty array");
                return [];
            }

            debug(`Generating graph questions for URL: ${url}`);

            const requestData = {
                url: url,
                relatedEntities: relatedEntities.slice(0, 10), // Limit for performance
                relatedTopics: relatedTopics.slice(0, 10),
                scope: "broader",
            };

            const response = await this.questionTranslator.translate(
                JSON.stringify(requestData, null, 2)
            );

            if (!response.success) {
                debug(`Graph question generation failed: ${response.message}`);
                return [];
            }

            const graphQuestions = response.data.questions.filter(
                (q: SuggestedQuestion) => q.scope === "broader"
            );

            debug(`Generated ${graphQuestions.length} graph-based questions`);
            return graphQuestions;

        } catch (error) {
            debug(`Error generating graph questions: ${error}`);
            return [];
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            const model = ai.createJsonChatModel(
                ai.apiSettingsFromEnv(ai.ModelType.Chat),
                ["pageQuestionGeneration"],
            );

            const validator = createTypeScriptJsonValidator<PageQuestionResponse>(
                this.schemaText,
                "PageQuestionResponse",
            );

            this.questionTranslator = createJsonTranslator(model, validator);

            // Set minimal TypeChat-style prompt
            this.questionTranslator.createRequestPrompt = (request: string) => {
                return (
                    `You are a service that generates suggested questions about web page content into JSON objects of type "PageQuestionResponse" according to the following TypeScript definitions:\n` +
                    `\`\`\`\n${this.schemaText}\`\`\`\n` +
                    `The following is page content and context:\n` +
                    `"""\n${request}\n"""\n` +
                    `The following is the suggested questions response as a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
                );
            };

            this.isInitialized = true;
            debug("QuestionGenerator initialized successfully");

        } catch (error) {
            debug(`Failed to initialize QuestionGenerator: ${error}`);
            throw error;
        }
    }
}

// Global instance for efficiency
let questionGeneratorInstance: QuestionGenerator | null = null;

function getQuestionGenerator(): QuestionGenerator {
    if (!questionGeneratorInstance) {
        questionGeneratorInstance = new QuestionGenerator();
    }
    return questionGeneratorInstance;
}

// ============================================================================
// Exported Action Functions
// ============================================================================

/**
 * Generate page-specific questions based on extracted knowledge
 */
export async function generatePageQuestions(
    parameters: {
        url: string;
        pageKnowledge: any;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<PageQuestionResponse> {
    try {
        debug(`Generating page questions for: ${parameters.url}`);

        const generator = getQuestionGenerator();
        const questions = await generator.generatePageQuestions(
            parameters.pageKnowledge,
            parameters.url,
        );

        const response: PageQuestionResponse = {
            questions: questions,
            contentSummary: parameters.pageKnowledge.summary || "",
            primaryTopics: parameters.pageKnowledge.keyTopics || [],
            primaryEntities: parameters.pageKnowledge.entities?.map((e: any) => e.name) || [],
        };

        debug(`Successfully generated ${questions.length} page questions`);
        return response;

    } catch (error) {
        debug(`Error in generatePageQuestions action: ${error}`);
        
        // Return fallback response
        return {
            questions: [],
            contentSummary: parameters.pageKnowledge.summary || "",
            primaryTopics: parameters.pageKnowledge.keyTopics || [],
            primaryEntities: parameters.pageKnowledge.entities?.map((e: any) => e.name) || [],
        };
    }
}

/**
 * Generate broader questions based on knowledge graph connections
 */
export async function generateGraphQuestions(
    parameters: {
        url: string;
        relatedEntities: any[];
        relatedTopics: any[];
    },
    context: SessionContext<BrowserActionContext>,
): Promise<PageQuestionResponse> {
    try {
        debug(`Generating graph questions for: ${parameters.url}`);

        const generator = getQuestionGenerator();
        const questions = await generator.generateGraphQuestions(
            parameters.relatedEntities,
            parameters.relatedTopics,
            parameters.url,
        );

        const response: PageQuestionResponse = {
            questions: questions,
            contentSummary: `Related content from knowledge graph`,
            primaryTopics: parameters.relatedTopics.map((t: any) => t.topicName || t.name).slice(0, 5),
            primaryEntities: parameters.relatedEntities.map((e: any) => e.name).slice(0, 5),
        };

        debug(`Successfully generated ${questions.length} graph questions`);
        return response;

    } catch (error) {
        debug(`Error in generateGraphQuestions action: ${error}`);
        
        // Return fallback response
        return {
            questions: [],
            contentSummary: "Failed to generate graph-based questions",
            primaryTopics: parameters.relatedTopics.map((t: any) => t.topicName || t.name).slice(0, 5),
            primaryEntities: parameters.relatedEntities.map((e: any) => e.name).slice(0, 5),
        };
    }
}