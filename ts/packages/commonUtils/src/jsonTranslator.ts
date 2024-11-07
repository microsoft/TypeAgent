// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

import {
    createJsonTranslator,
    PromptSection,
    Result,
    success,
    TypeChatJsonTranslator,
    TypeChatLanguageModel,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { TypeChatConstraintsValidator } from "./constraints.js";
import registerDebug from "debug";
import { openai as ai } from "aiclient";
import {
    createIncrementalJsonParser,
    IncrementalJsonParser,
    IncrementalJsonValueCallBack,
} from "./incrementalJsonParser.js";
import { CachedImageWithDetails, extractRelevantExifTags } from "./image.js";

export type InlineTranslatorSchemaDef = {
    kind: "inline";
    typeName: string;
    schema: string;
};

export type TranslatorSchemaDef =
    | {
          kind: "file";
          typeName: string;
          fileName: string;
      }
    | {
          kind: "inline";
          typeName: string;
          schema: string;
      };

export function composeTranslatorSchemas(
    typeName: string,
    schemaDefs: TranslatorSchemaDef[],
) {
    const schemas = schemaDefs.map((schemaDef) => {
        if (schemaDef.kind === "file") {
            return readSchemaFile(schemaDef.fileName);
        }
        return schemaDef.schema;
    });
    const types = schemaDefs.map((schemaDef) => schemaDef.typeName);
    return `export type ${typeName} = ${types.join(" | ")};\n${schemas.join("\n")}`;
}

export interface TypeChatJsonTranslatorWithStreaming<T extends object>
    extends TypeChatJsonTranslator<T> {
    translate: (
        request: string,
        promptPreamble?: string | PromptSection[],
        cb?: IncrementalJsonValueCallBack,
        attachments?: CachedImageWithDetails[] | undefined,
    ) => Promise<Result<T>>;
}

// This rely on the fact that the prompt preamble based to typechat are copied to the final prompt.
// Add a internal section so we can pass information from the caller to the model.complete function.
type StreamingSection = {
    role: "streaming";
    content: IncrementalJsonParser;
};

function initializeStreamingParser(
    promptPreamble?: string | PromptSection[],
    cb?: IncrementalJsonValueCallBack,
) {
    if (cb === undefined) {
        return promptPreamble;
    }
    const prompts: (PromptSection | StreamingSection)[] =
        typeof promptPreamble === "string"
            ? [{ role: "user", content: promptPreamble }]
            : promptPreamble
              ? [...promptPreamble] // Make a copy so that we don't modify the original array
              : [];
    const parser = createIncrementalJsonParser(cb, {
        partial: true,
    });
    prompts.unshift({
        role: "streaming",
        content: parser,
    });

    return prompts as PromptSection[];
}

function getStreamingParser(
    prompt: string | ReadonlyArray<PromptSection | StreamingSection>,
) {
    if (typeof prompt === "string") {
        return undefined;
    }
    const internalIndex = prompt.findIndex((p) => p.role === "streaming");
    if (internalIndex === -1) {
        return undefined;
    }
    // Make a copy so that we don't modify the original array;
    const newPrompt = [...prompt];
    const internal = newPrompt.splice(internalIndex, 1) as [StreamingSection];
    return {
        parser: internal[0].content,
        actualPrompt: newPrompt as PromptSection[],
    };
}

export function enableJsonTranslatorStreaming<T extends object>(
    translator: TypeChatJsonTranslator<T>,
): TypeChatJsonTranslatorWithStreaming<T> {
    const model = translator.model;
    if (!ai.supportsStreaming(model)) {
        throw new Error("Model does not support streaming");
    }

    const originalComplete = model.complete;
    model.complete = async (prompt: string | PromptSection[]) => {
        const streamingParser = getStreamingParser(prompt);
        if (streamingParser === undefined) {
            return originalComplete(prompt);
        }
        const { parser, actualPrompt } = streamingParser;
        const chunks = [];
        const result = await model.completeStream(actualPrompt);
        if (!result.success) {
            return result;
        }
        for await (const chunk of result.data) {
            chunks.push(chunk);
            parser.parse(chunk);
        }
        parser.complete();
        return success(chunks.join(""));
    };

    const originalTranslate = translator.translate;
    const translatorWithStreaming =
        translator as TypeChatJsonTranslatorWithStreaming<T>;
    translatorWithStreaming.translate = async (
        request: string,
        promptPreamble?: string | PromptSection[],
        cb?: IncrementalJsonValueCallBack,
        attachments?: CachedImageWithDetails[],
    ) => {
        attachAttachments(attachments, promptPreamble);
        return originalTranslate(
            request,
            initializeStreamingParser(promptPreamble, cb),
        );
    };

    return translatorWithStreaming;
}

function attachAttachments(
    attachments: CachedImageWithDetails[] | undefined,
    promptPreamble?: string | PromptSection[],
) {
    let pp: PromptSection[] = promptPreamble as PromptSection[];

    if (attachments && attachments.length > 0 && pp) {
        for (let i = 0; i < attachments.length; i++) {
            pp.unshift({
                role: "user",
                content: [
                    {
                        type: "text",
                        text: `File Name: ${attachments![i].storageLocation}`,
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: attachments[i].image,
                            detail: "high",
                        },
                    },
                    {
                        type: "text",
                        text: `Image EXIF tags: \n${extractRelevantExifTags(attachments![i].exifTags)}`,
                    },
                ],
            });
        }
    }
}

/**
 *
 * @param schemas pass either a single schema text OR schema definitions to compose.
 * @param typeName a single type name to be translated to.
 * @param constraintsValidator optionally validate constraints on response
 * @param instructions Optional additional instructions
 * @param model optional, custom model impl.
 * @returns
 */
export function createJsonTranslatorFromSchemaDef<T extends object>(
    typeName: string,
    schemas: string | TranslatorSchemaDef[],
    constraintsValidator?: TypeChatConstraintsValidator<T>, // Optional
    instructions?: PromptSection[], // Instructions before the per request preamble
    model?: string | TypeChatLanguageModel, // optional
) {
    if (typeof model !== "object") {
        model = ai.createChatModel(
            model,
            {
                response_format: { type: "json_object" },
            },
            undefined,
            ["translator", typeName.toLowerCase()],
        );
    }

    const debugPrompt = registerDebug(
        `typeagent:translate:${typeName.toLowerCase()}:prompt`,
    );
    const debugResult = registerDebug(
        `typeagent:translate:${typeName.toLowerCase()}:result`,
    );
    const complete = model.complete.bind(model);
    model.complete = async (prompt: string | PromptSection[]) => {
        debugPrompt(prompt);
        return complete(prompt);
    };

    if (ai.supportsStreaming(model)) {
        const completeStream = model.completeStream.bind(model);
        model.completeStream = async (prompt: string | PromptSection[]) => {
            debugPrompt(prompt);
            return completeStream(prompt);
        };
    }

    const schema = Array.isArray(schemas)
        ? composeTranslatorSchemas(typeName, schemas)
        : schemas;

    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);

    translator.stripNulls = true;
    if (constraintsValidator) {
        translator.validateInstance = constraintsValidator.validateConstraints;
    }

    const innerFn = translator.translate;
    if (!instructions) {
        translator.translate = async (
            request: string,
            promptPreamble?: string | PromptSection[],
        ) => {
            const result = await innerFn(request, promptPreamble);
            debugResult(result);
            return result;
        };
        return translator;
    }

    translator.translate = async (
        request: string,
        promptPreamble?: string | PromptSection[],
    ) => {
        const result = await innerFn(
            request,
            toPromptSections(instructions, promptPreamble),
        );

        debugResult(result);
        return result;
    };

    translator.createRequestPrompt = function (request: string) {
        return (
            `You are a service that translates user requests into JSON objects of type "${validator.getTypeName()}" according to the following TypeScript definitions:\n` +
            `\`\`\`\n${validator.getSchemaText()}\`\`\`\n` +
            `The following is the latest user request:\n` +
            `"""\n${request}\n"""\n` +
            `Based on all available information in our chat history including images previoiusly provided, the following is the latest user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    };
    return translator;
}

/**
 * load schema from schema file. If multiple files provided, concatenate them
 * @param schemaFiles a single or multiple file paths
 */
export function getTranslationSchemaText(
    schemaFiles: string | string[],
): string {
    const schemas = Array.isArray(schemaFiles)
        ? schemaFiles.map(readSchemaFile)
        : [readSchemaFile(schemaFiles)];
    if (schemas.length === 0) {
        throw new Error("No schemas provided");
    }
    return schemas.join("\n");
}

/**
 *
 * @param schemaFiles pass either a single file OR an array of files that are concatenated
 * @param typeName
 * @param constraintsValidator optionally validate constraints on response
 * @param instructions Optional additional instructions
 * @param model optional, custom model impl.
 * @returns
 */
export function createJsonTranslatorFromFile<T extends object>(
    typeName: string,
    schemaFiles: string | string[],
    constraintsValidator?: TypeChatConstraintsValidator<T>, // Optional
    instructions?: PromptSection[],
    model?: string | TypeChatLanguageModel, // optional
) {
    return createJsonTranslatorFromSchemaDef<T>(
        typeName,
        getTranslationSchemaText(schemaFiles),
        constraintsValidator,
        instructions,
        model,
    );
}

const header = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.`;

function readSchemaFile(schemaFile: string): string {
    let content = fs.readFileSync(schemaFile, "utf8");
    if (content.startsWith(header)) {
        // strip copyright header for the prompt
        content = content.substring(header.length);
    }
    return content.trim();
}

/**
 * Combine instructions + any user provided preamble
 * @param instructions
 * @param prompt
 * @returns
 */
function toPromptSections(
    instructions: PromptSection[],
    prompt: string | PromptSection[] | undefined,
): PromptSection[] {
    const promptSections: PromptSection[] =
        typeof prompt === "string"
            ? [{ role: "user", content: prompt }]
            : prompt ?? [];
    return instructions.concat(promptSections);
}
