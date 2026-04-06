// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl } from "../../common/browserControl.mjs";
import { WebFlowScope } from "./types.js";
import { openai as ai } from "aiclient";
import { createJsonTranslator, MultimodalPromptContent } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflow:api");

export interface ComponentDefinition {
    typeName: string;
    schema: string;
}

export type ExtractComponentFn = (
    componentDef: ComponentDefinition,
    userRequest?: string,
) => Promise<unknown>;

export interface WebFlowBrowserAPI {
    navigateTo(url: string): Promise<void>;
    goBack(): Promise<void>;
    awaitPageLoad(timeout?: number): Promise<void>;
    awaitPageInteraction(timeout?: number): Promise<void>;
    getCurrentUrl(): Promise<string>;

    click(cssSelector: string): Promise<void>;
    clickAndWait(cssSelector: string, timeout?: number): Promise<void>;
    followLink(cssSelector: string): Promise<void>;

    enterText(cssSelector: string, text: string): Promise<void>;
    enterTextOnPage(text: string, submitForm?: boolean): Promise<void>;
    clearAndType(cssSelector: string, text: string): Promise<void>;
    pressKey(key: string): Promise<void>;
    selectOption(cssSelector: string, value: string): Promise<void>;

    getPageText(): Promise<string>;
    captureScreenshot(): Promise<string>;

    waitForNavigation(timeout?: number): Promise<void>;

    extractComponent<T = unknown>(
        componentDef: ComponentDefinition,
        userRequest?: string,
    ): Promise<T>;

    checkPageState(expectedStateDescription: string): Promise<{
        matched: boolean;
        explanation: string;
    }>;

    queryContent(question: string): Promise<{
        answered: boolean;
        answerText?: string;
        confidence?: number;
    }>;
}

export class WebFlowBrowserAPIImpl implements WebFlowBrowserAPI {
    private scope: WebFlowScope | undefined;
    private extractComponentFn: ExtractComponentFn | undefined;

    constructor(
        private browser: BrowserControl,
        scope?: WebFlowScope,
        extractComponentFn?: ExtractComponentFn,
    ) {
        this.scope = scope;
        this.extractComponentFn = extractComponentFn;
    }

    async navigateTo(url: string): Promise<void> {
        if (this.scope?.type === "site" && this.scope.domains?.length) {
            const targetDomain = new URL(url).hostname;
            const allowed = this.scope.domains.some((d) =>
                targetDomain.endsWith(d),
            );
            if (!allowed) {
                throw new Error(
                    `Navigation to ${targetDomain} blocked: flow is scoped to ${this.scope.domains.join(", ")}`,
                );
            }
        }
        await this.browser.openWebPage(url);
    }

    async goBack(): Promise<void> {
        await this.browser.goBack();
    }

    async awaitPageLoad(timeout?: number): Promise<void> {
        await this.browser.awaitPageLoad(timeout);
    }

    async awaitPageInteraction(timeout?: number): Promise<void> {
        await this.browser.awaitPageInteraction(timeout);
    }

    async getCurrentUrl(): Promise<string> {
        return this.browser.getPageUrl();
    }

    async click(cssSelector: string): Promise<void> {
        await this.browser.clickOn(cssSelector);
    }

    async clickAndWait(cssSelector: string, timeout?: number): Promise<void> {
        await this.browser.clickOn(cssSelector);
        await this.browser.awaitPageInteraction(timeout);
        await this.browser.awaitPageLoad(timeout);
    }

    async followLink(cssSelector: string): Promise<void> {
        await this.clickAndWait(cssSelector);
    }

    async enterText(cssSelector: string, text: string): Promise<void> {
        await this.browser.enterTextIn(text, cssSelector, false);
    }

    async enterTextOnPage(text: string, submitForm?: boolean): Promise<void> {
        await this.browser.enterTextIn(text, undefined, submitForm);
    }

    async clearAndType(cssSelector: string, text: string): Promise<void> {
        await this.browser.enterTextIn(text, cssSelector, false);
    }

    async pressKey(key: string): Promise<void> {
        if (key === "Enter") {
            await this.browser.enterTextIn("", undefined, true);
        }
    }

    async selectOption(cssSelector: string, value: string): Promise<void> {
        await this.browser.setDropdown(cssSelector, value);
    }

    async getPageText(): Promise<string> {
        return this.browser.getPageTextContent();
    }

    async captureScreenshot(): Promise<string> {
        return this.browser.captureScreenshot();
    }

    async waitForNavigation(timeout?: number): Promise<void> {
        await this.browser.awaitPageLoad(timeout);
    }

    async extractComponent<T = unknown>(
        componentDef: ComponentDefinition,
        userRequest?: string,
    ): Promise<T> {
        if (!this.extractComponentFn) {
            throw new Error(
                "extractComponent is not available: no extraction function was provided",
            );
        }
        const result = await this.extractComponentFn(componentDef, userRequest);
        return result as T;
    }

    async checkPageState(expectedStateDescription: string): Promise<{
        matched: boolean;
        explanation: string;
    }> {
        return semanticPageQuery<{ matched: boolean; explanation: string }>(
            this.browser,
            "PageStateCheck",
            `export type PageStateCheck = {
    matched: boolean;
    explanation: string;
};`,
            `Determine if the current page state matches the expected condition.
Expected state: "${expectedStateDescription}"
Analyze the page and set matched=true if the core aspects of the expected state are present.
Provide a brief explanation of what you found.`,
        );
    }

    async queryContent(question: string): Promise<{
        answered: boolean;
        answerText?: string;
        confidence?: number;
    }> {
        return semanticPageQuery<{
            answered: boolean;
            answerText?: string;
            confidence?: number;
        }>(
            this.browser,
            "PageContentAnswer",
            `export type PageContentAnswer = {
    answered: boolean;
    answerText?: string;
    confidence?: number;
};`,
            `Answer the following question about the current page content.
Question: "${question}"
If the answer is found, set answered=true with the answerText and a confidence score (0-1).
If not found, set answered=false.`,
        );
    }
}

async function semanticPageQuery<T extends object>(
    browser: BrowserControl,
    typeName: string,
    schema: string,
    instruction: string,
): Promise<T> {
    const htmlFragments = await browser.getHtmlFragments(
        false,
        "knowledgeExtraction",
    );

    let screenshot: string | undefined;
    try {
        screenshot = await browser.captureScreenshot();
    } catch {
        debug("Screenshot capture failed for semantic query");
    }

    const apiSettings = ai.azureApiSettingsFromEnv(
        ai.ModelType.Chat,
        undefined,
        "GPT_4_O_MINI",
    );
    const model = ai.createChatModel(apiSettings);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
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

    promptSections.push({
        type: "text",
        text: `${instruction}

Generate a SINGLE "${translator.validator.getTypeName()}" response using the schema:
\`\`\`
${translator.validator.getSchemaText()}
\`\`\``,
    });

    const response = await translator.translate("", [
        {
            role: "user",
            content: promptSections as MultimodalPromptContent[],
        },
    ]);

    if (!response.success) {
        throw new Error(`Semantic page query failed: ${response.message}`);
    }

    return response.data as T;
}

export function createFrozenBrowserApi(
    browser: BrowserControl,
    scope?: WebFlowScope,
    extractComponentFn?: ExtractComponentFn,
): WebFlowBrowserAPI {
    const api = new WebFlowBrowserAPIImpl(browser, scope, extractComponentFn);
    return Object.freeze(api);
}
