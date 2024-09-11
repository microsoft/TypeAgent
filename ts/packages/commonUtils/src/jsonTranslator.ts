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
import { openai as ai, ChatMessage } from "aiclient";
import {
    createIncrementalJsonParser,
    IncrementalJsonValueCallBack,
} from "./incrementalJsonParser.js";
import ExifReader from 'exifreader';

const debug = registerDebug("typeagent:prompt");

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
        attachments?: string[] | undefined,
        exifTags?: ExifReader.Tags[] | undefined,
    ) => Promise<Result<T>>;
}

export function enableJsonTranslatorStreaming<T extends object>(
    translator: TypeChatJsonTranslator<T>,
): TypeChatJsonTranslatorWithStreaming<T> {
    const model = translator.model;
    if (!ai.supportsStreaming(model)) {
        throw new Error("Model does not support streaming");
    }
    const innerFn = translator.translate;
    const translatorWithStreaming =
        translator as TypeChatJsonTranslatorWithStreaming<T>;
    translatorWithStreaming.translate = async (
        request: string,
        promptPreamble?: string | PromptSection[],
        cb?: IncrementalJsonValueCallBack,
        attachments?: string[],
        exifTags?: ExifReader.Tags[],
    ) => {
        attachAttachments(attachments, exifTags, promptPreamble);

        if (cb === undefined) {
            return innerFn(request, promptPreamble);
        }

        const originalComplete = model.complete;
        try {
            const parser = createIncrementalJsonParser(cb, {
                partial: true,
            });
            model.complete = async (
                prompt: string | PromptSection[] | ChatMessage[],
            ) => {
                debug(prompt);
                const chunks = [];
                const result = await model.completeStream(prompt);
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
            return innerFn(request, promptPreamble);
        } finally {
            model.complete = originalComplete;
        }
    };

    return translatorWithStreaming;
}

function attachAttachments(
    attachments: string[] | undefined,
    exifTags: ExifReader.Tags[] | undefined,
    promptPreamble?: string | PromptSection[],
) {
    let pp: PromptSection[] = promptPreamble as PromptSection[];

    if (attachments && attachments.length > 0 && pp) {
        for (let i = 0; i < attachments.length; i++) {
            pp.unshift({
                role: "user",
                content: [
                    { type: "text", text: "\n" },
                    { type: "image_url", image_url: { url: attachments[i], detail: "high" } },
                    { type: "text", text: "\n" },
                    { type: "text", text: `Image Location: ${exifTags![i].GPSLatitude?.description},${exifTags![i].GPSLongitude?.description}`},
                    { type: "text", text: "Here is the EXIF information for the image: " + JSON.stringify(exifTags![i]) },
                ],
            });
        }

        pp.unshift({
            role: "user",
            content: "Here are some images provided by the user.",
        });
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
    instructions?: PromptSection[],
    model?: string | TypeChatLanguageModel, // optional
) {
    if (typeof model !== "object") {
        model = ai.createChatModel(model, {
            response_format: { type: "json_object" },
        });
    }

    const complete = model.complete.bind(model);
    model.complete = async (prompt: string | PromptSection[]) => {
        debug(prompt);
        return complete(prompt);
    };

    const schema = Array.isArray(schemas)
        ? composeTranslatorSchemas(typeName, schemas)
        : schemas;

    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);

    translator.stripNulls = true;
    if (constraintsValidator) {
        translator.validateInstance = constraintsValidator.validateConstraints;
    }

    if (!instructions) {
        return translator;
    }

    const innerFn = translator.translate;
    translator.translate = async function (
        request: string,
        promptPreamble?: string | PromptSection[],
    ) {
        return innerFn(request, toPromptSections(instructions, promptPreamble));
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
