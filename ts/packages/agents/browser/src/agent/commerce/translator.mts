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
import { ShoppingActions } from "./schema/userActions.mjs";

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

export async function createCommercePageTranslator(
  model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
  const packageRoot = path.join("..", "..", "..");
  const pageSchema = await fs.promises.readFile(
    fileURLToPath(
      new URL(
        path.join(packageRoot, "./src/agent/commerce/schema/userActions.mts"),
        import.meta.url,
      ),
    ),
    "utf8",
  );

  const agent = new ECommerceSiteAgent<ShoppingActions>(
    pageSchema,
    "ShoppingActions",
    model,
  );
  return agent;
}

export class ECommerceSiteAgent<T extends object> {
  schema: string;

  model: TypeChatLanguageModel;
  translator: TypeChatJsonTranslator<T>;

  constructor(schema: string, schemaName: string, fastModelName: string) {
    this.schema = schema;

    const apiSettings = ai.azureApiSettingsFromEnv(
      ai.ModelType.Chat,
      undefined,
      fastModelName,
    );
    this.model = ai.createChatModel(apiSettings, undefined, undefined, [
      "commerce",
    ]);
    const validator = createTypeScriptJsonValidator<T>(this.schema, schemaName);
    this.translator = createJsonTranslator(this.model, validator);
  }

  private getCssSelectorForElementPrompt<U extends object>(
    translator: TypeChatJsonTranslator<U>,
    userRequest?: string,
    fragments?: HtmlFragments[],
    screenshot?: string,
  ) {
    const screenshotSection = getScreenshotPromptSection(screenshot, fragments);
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

  private getPageChatResponsePrompt<U extends object>(
    translator: TypeChatJsonTranslator<U>,
    userQuestion: string,
    fragments?: HtmlFragments[],
    screenshot?: string,
  ) {
    const screenshotSection = getScreenshotPromptSection(screenshot, fragments);
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

  private getBootstrapTranslator(fileName: string, targetType: string) {
    const packageRoot = path.join("..", "..", "..");
    const schemaPath = fileURLToPath(
      new URL(
        path.join(packageRoot, `./src/agent/commerce/schema/${fileName}`),
        import.meta.url,
      ),
    );

    const pageSchema = fs.readFileSync(schemaPath, "utf8");

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
    const bootstrapTranslator = this.getBootstrapTranslator(
      "pageComponents.mts",
      componentTypeName,
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

  async getPageChatResponse(
    question: string,
    fragments?: HtmlFragments[],
    screenshot?: string,
  ) {
    const bootstrapTranslator = this.getBootstrapTranslator(
      "pageChatSchema.mts",
      "PageChat",
    );

    const promptSections = this.getPageChatResponsePrompt(
      bootstrapTranslator,
      question,
      fragments,
      screenshot,
    ) as ContentSection[];

    const response = await bootstrapTranslator.translate("", [
      { role: "user", content: JSON.stringify(promptSections) },
    ]);
    return response;
  }
}
