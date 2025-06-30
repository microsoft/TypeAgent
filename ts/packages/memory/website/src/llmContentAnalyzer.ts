// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, ChatModel } from "aiclient";
import { ContentAnalysis } from "./schemas/contentAnalysisSchema.js";
import { PageContent, MetaTagCollection, ActionInfo } from "./contentExtractor.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AnalysisInput {
    url: string;
    title?: string;
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    actions?: ActionInfo[];
}

export class LLMContentAnalyzer {
    private chatModel: ChatModel;
    private contentAnalysisSchema: string = '';
    private pageTypeSchema: string = '';
    
    constructor() {
        this.chatModel = openai.createChatModel();
        this.loadSchemas();
    }

    private loadSchemas(): void {
        // Load the content analysis schema file
        const contentSchemaPath = path.join(__dirname, 'schemas', 'contentAnalysisSchema.ts');
        this.contentAnalysisSchema = fs.readFileSync(contentSchemaPath, 'utf-8');
        
        // Load the page type schema file
        const pageTypeSchemaPath = path.join(__dirname, 'schemas', 'pageTypeSchema.ts');
        this.pageTypeSchema = fs.readFileSync(pageTypeSchemaPath, 'utf-8');
    }

    /**
     * Analyze content using LLM to extract structured information
     */
    async analyzeContent(input: AnalysisInput): Promise<ContentAnalysis | null> {
        try {
            const prompt = this.buildAnalysisPrompt(input);
            const response = await this.chatModel.complete([
                {
                    role: "system",
                    content: this.getSystemPrompt()
                },
                {
                    role: "user", 
                    content: prompt
                }
            ]);

            if (!response.success) {
                throw new Error(response.message || 'LLM request failed');
            }

            return this.parseAnalysisResponse(response.data);
        } catch (error) {
            console.warn("LLM content analysis failed:", error);
            return null;
        }
    }

    private getSystemPrompt(): string {
        return `You are a content analysis expert. Your task is to analyze web page content and extract structured information about it.

You must respond with ONLY a valid JSON object matching this exact TypeScript interface:

${this.contentAnalysisSchema}

Rules:
- contentLength: quick_read (<3min), short (3-7min), medium (7-15min), long (15-30min), comprehensive (30+min)
- technologies: specific tech like ["React", "TypeScript", "Python"], max 10 items
- domains: broad areas like ["web development", "machine learning"], max 5 items  
- concepts: specific topics like ["authentication", "state management"], max 8 items
- targetAudience: specific groups like ["developers", "beginners", "React developers"], max 5 items
- mainTopics: 3-5 primary topics from the content
- secondaryTopics: additional relevant topics, max 10 items
- primaryPurpose: single sentence describing main goal
- Respond with ONLY the JSON, no explanations or markdown formatting`;
    }

    private buildAnalysisPrompt(input: AnalysisInput): string {
        let prompt = `Analyze this web page content:\n\n`;
        
        prompt += `URL: ${input.url}\n`;
        
        if (input.title) {
            prompt += `Title: ${input.title}\n`;
        }
        
        if (input.metaTags?.description) {
            prompt += `Description: ${input.metaTags.description}\n`;
        }
        
        if (input.metaTags?.keywords && input.metaTags.keywords.length > 0) {
            prompt += `Keywords: ${input.metaTags.keywords.join(", ")}\n`;
        }
        
        if (input.pageContent) {
            prompt += `\nContent Analysis:\n`;
            prompt += `Word Count: ${input.pageContent.wordCount}\n`;
            prompt += `Reading Time: ${input.pageContent.readingTime} minutes\n`;
            
            if (input.pageContent.headings.length > 0) {
                prompt += `\nHeadings:\n${input.pageContent.headings.slice(0, 10).join("\n")}\n`;
            }
            
            if (input.pageContent.codeBlocks && input.pageContent.codeBlocks.length > 0) {
                prompt += `\nHas ${input.pageContent.codeBlocks.length} code blocks\n`;
                // Include first code block sample for analysis
                if (input.pageContent.codeBlocks[0]) {
                    const sample = input.pageContent.codeBlocks[0].substring(0, 200);
                    prompt += `Sample code: ${sample}${input.pageContent.codeBlocks[0].length > 200 ? "..." : ""}\n`;
                }
            }
            
            if (input.pageContent.images && input.pageContent.images.length > 0) {
                prompt += `\nHas ${input.pageContent.images.length} images\n`;
            }
            
            // Include content sample for analysis
            if (input.pageContent.mainContent) {
                const contentSample = input.pageContent.mainContent.substring(0, 1500);
                prompt += `\nContent Sample:\n${contentSample}${input.pageContent.mainContent.length > 1500 ? "..." : ""}\n`;
            }
        }
        
        if (input.actions && input.actions.length > 0) {
            prompt += `\nInteractive Elements: ${input.actions.length} forms/buttons/actions\n`;
            const actionSummary = input.actions.slice(0, 5).map(a => `${a.type}: ${a.text || a.action || "N/A"}`).join(", ");
            prompt += `Actions: ${actionSummary}\n`;
        }
        
        return prompt;
    }

    private parseAnalysisResponse(response: string): ContentAnalysis | null {
        try {
            // Clean the response - remove any markdown formatting or extra text
            let cleanResponse = response.trim();
            
            // Find JSON object in response
            const jsonStart = cleanResponse.indexOf('{');
            const jsonEnd = cleanResponse.lastIndexOf('}') + 1;
            
            if (jsonStart === -1 || jsonEnd === 0) {
                throw new Error("No JSON object found in response");
            }
            
            cleanResponse = cleanResponse.substring(jsonStart, jsonEnd);
            
            const analysis = JSON.parse(cleanResponse) as ContentAnalysis;
            
            // Validate required fields
            if (!analysis.contentType || !analysis.technicalLevel || !analysis.contentLength) {
                throw new Error("Missing required fields in analysis");
            }
            
            // Ensure arrays are properly initialized
            analysis.technologies = analysis.technologies || [];
            analysis.domains = analysis.domains || [];
            analysis.concepts = analysis.concepts || [];
            analysis.targetAudience = analysis.targetAudience || [];
            analysis.mainTopics = analysis.mainTopics || [];
            analysis.secondaryTopics = analysis.secondaryTopics || [];
            
            // Ensure string fields are properly set
            analysis.primaryPurpose = analysis.primaryPurpose || "General web content";
            
            return analysis;
        } catch (error) {
            console.warn("Failed to parse LLM analysis response:", error);
            console.warn("Response was:", response);
            return null;
        }
    }

    /**
     * Determine page type using LLM analysis (replaces hardcoded determinePageType function)
     */
    async determinePageType(url: string, title?: string, description?: string): Promise<string> {
        try {
            const prompt = `Analyze this web page and determine its primary type:

URL: ${url}
${title ? `Title: ${title}` : ""}
${description ? `Description: ${description}` : ""}

Available page types and their definitions:
${this.extractPageTypeDefinitions()}

Choose the MOST SPECIFIC type from the available options based on the content and purpose.

Respond with ONLY the type name, no explanations.`;

            const response = await this.chatModel.complete([
                {
                    role: "system",
                    content: "You are a web content classifier. Respond with only the content type, no additional text."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]);

            if (!response.success) {
                throw new Error(response.message || 'LLM request failed');
            }

            const pageType = response.data.trim().toLowerCase();
            
            // Validate the response is one of our expected types
            const validTypes = this.getValidPageTypes();
            
            if (validTypes.includes(pageType)) {
                return pageType;
            }
            
            // Fallback to mapping common types
            return this.mapToValidPageType(pageType);
        } catch (error) {
            console.warn("LLM page type determination failed:", error);
            return "other";
        }
    }

    private extractPageTypeDefinitions(): string {
        // Extract the type definitions and examples from the page type schema
        const lines = this.pageTypeSchema.split('\n');
        let definitions = 'Available page types and their definitions:\n';
        let inTypeDefinition = false;
        let currentType = '';
        
        for (const line of lines) {
            if (line.includes('export type PageType =')) {
                inTypeDefinition = true;
                continue;
            }
            
            if (inTypeDefinition) {
                // Look for type definitions with comments
                const typeMatch = line.match(/\|\s*"([^"]+)"/);
                if (typeMatch) {
                    currentType = typeMatch[1];
                    continue;
                }
                
                // Look for description comments
                const commentMatch = line.match(/\/\*\*\s*(.+?)\s*\*\//);
                if (commentMatch && currentType) {
                    definitions += `- ${currentType}: ${commentMatch[1]}\n`;
                    currentType = '';
                }
                
                // End of type definition
                if (line.includes(';')) {
                    inTypeDefinition = false;
                    break;
                }
            }
        }
        
        return definitions;
    }

    private getValidPageTypes(): string[] {
        return [
            "tutorial", "documentation", "article", "guide", "reference", 
            "blog_post", "news", "product_page", "landing_page", 
            "interactive_demo", "code_example", "api_docs", "other"
        ];
    }

    private mapToValidPageType(pageType: string): string {
        if (pageType.includes("doc")) return "documentation";
        if (pageType.includes("tutorial")) return "tutorial";
        if (pageType.includes("guide")) return "guide";
        if (pageType.includes("article")) return "article";
        if (pageType.includes("blog")) return "blog_post";
        if (pageType.includes("news")) return "news";
        if (pageType.includes("product")) return "product_page";
        if (pageType.includes("api")) return "api_docs";
        if (pageType.includes("demo")) return "interactive_demo";
        if (pageType.includes("example")) return "code_example";
        if (pageType.includes("reference")) return "reference";
        if (pageType.includes("landing")) return "landing_page";
        
        return "other";
    }
}
