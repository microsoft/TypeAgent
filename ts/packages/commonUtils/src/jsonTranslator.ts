// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

import {
    createJsonTranslator,
    PromptSection,
    Result,
    success,
    TypeChatJsonTranslator,
    TypeChatJsonValidator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { TypeChatConstraintsValidator } from "./constraints.js";
import registerDebug from "debug";
import {
    openai as ai,
    CompleteUsageStatsCallback,
    CompletionJsonSchema,
} from "aiclient";
import {
    createIncrementalJsonParser,
    IncrementalJsonParser,
    IncrementalJsonValueCallBack,
} from "./incrementalJsonParser.js";
import { addImagePromptContent, CachedImageWithDetails } from "./image.js";

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
        attachments?: CachedImageWithDetails[] | undefined,
        cb?: IncrementalJsonValueCallBack,
        usageCallback?: CompleteUsageStatsCallback,
    ) => Promise<Result<T>>;
}

// This rely on the fact that the prompt preamble based to typechat are copied to the final prompt.
// Add a internal section so we can pass information from the caller to the model.complete function.
type ModelParamSection = {
    role: "model";
    content: {
        parser: IncrementalJsonParser | undefined;
        usageCallback: CompleteUsageStatsCallback | undefined;
    };
};

function addModelParamSection(
    promptPreamble?: string | PromptSection[],
    cb?: IncrementalJsonValueCallBack,
    usageCallback?: CompleteUsageStatsCallback,
) {
    if (cb === undefined && usageCallback === undefined) {
        return promptPreamble;
    }
    const prompts: (PromptSection | ModelParamSection)[] =
        typeof promptPreamble === "string"
            ? [{ role: "user", content: promptPreamble }]
            : promptPreamble
              ? [...promptPreamble] // Make a copy so that we don't modify the original array
              : [];
    const parser = cb
        ? createIncrementalJsonParser(cb, {
              partial: true,
          })
        : undefined;
    prompts.unshift({
        role: "model",
        content: {
            parser,
            usageCallback,
        },
    });

    return prompts as PromptSection[];
}

function getModelParams(
    prompt: string | ReadonlyArray<PromptSection | ModelParamSection>,
) {
    if (typeof prompt === "string") {
        return undefined;
    }
    const internalIndex = prompt.findIndex((p) => p.role === "model");
    if (internalIndex === -1) {
        return undefined;
    }
    // Make a copy so that we don't modify the original array;
    const newPrompt = [...prompt];
    const internal = newPrompt.splice(internalIndex, 1) as [ModelParamSection];
    return {
        parser: internal[0].content.parser,
        usageCallback: internal[0].content.usageCallback,
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

    const originalComplete = model.complete.bind(model);
    model.complete = async (prompt: string | PromptSection[]) => {
        const modelParams = getModelParams(prompt);
        if (modelParams === undefined) {
            return originalComplete(prompt);
        }
        const { parser, usageCallback, actualPrompt } = modelParams;
        if (parser === undefined) {
            return originalComplete(actualPrompt, usageCallback);
        }
        const chunks = [];
        const result = await model.completeStream(actualPrompt, usageCallback);
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

    const originalTranslate = translator.translate.bind(translator);
    const translatorWithStreaming =
        translator as TypeChatJsonTranslatorWithStreaming<T>;
    translatorWithStreaming.translate = async (
        request: string,
        promptPreamble?: string | PromptSection[],
        attachments?: CachedImageWithDetails[],
        cb?: IncrementalJsonValueCallBack,
        usageCallback?: CompleteUsageStatsCallback,
    ) => {
        await attachAttachments(attachments, promptPreamble);
        return originalTranslate(
            request,
            addModelParamSection(promptPreamble, cb, usageCallback),
        );
    };

    return translatorWithStreaming;
}

async function attachAttachments(
    attachments: CachedImageWithDetails[] | undefined,
    promptPreamble?: string | PromptSection[],
) {
    let pp: PromptSection[] = promptPreamble as PromptSection[];

    if (attachments && attachments.length > 0 && pp) {
        for (let i = 0; i < attachments.length; i++) {
            pp.unshift(
                (
                    await addImagePromptContent(
                        "user",
                        attachments[i],
                        true,
                        true,
                        false,
                        true,
                        true,
                    )
                ).promptSection!,
            );
        }
    }
}

export type JsonTranslatorOptions<T extends object> = {
    constraintsValidator?: TypeChatConstraintsValidator<T> | undefined; // Optional
    instructions?: PromptSection[] | undefined; // Instructions before the per request preamble
    model?: string | undefined; // optional
};

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
    options?: JsonTranslatorOptions<T>,
) {
    const schema = Array.isArray(schemas)
        ? composeTranslatorSchemas(typeName, schemas)
        : schemas;

    const validator = createTypeScriptJsonValidator<T>(schema, typeName);

    return createJsonTranslatorWithValidator(
        typeName.toLowerCase(),
        validator,
        options,
    );
}

export interface TypeAgentJsonValidator<T extends object>
    extends TypeChatJsonValidator<T> {
    getSchemaText(): string;
    getTypeName(): string;
    validate(jsonObject: object): Result<T>;
    getJsonSchema?: () => CompletionJsonSchema | undefined;
}

export function createJsonTranslatorWithValidator<T extends object>(
    name: string,
    validator: TypeAgentJsonValidator<T>,
    options?: JsonTranslatorOptions<T>,
) {
    const model = ai.createChatModel(
        options?.model,
        {
            response_format: { type: "json_object" },
        },
        undefined,
        ["translate", name],
    );

    const debugPrompt = registerDebug(`typeagent:translate:${name}:prompt`);
    const debugJsonSchema = registerDebug(
        `typeagent:translate:${name}:jsonschema`,
    );
    const debugResult = registerDebug(`typeagent:translate:${name}:result`);
    const originalComplete = model.complete.bind(model);
    model.complete = async (
        prompt: string | PromptSection[],
        usageCallback?: CompleteUsageStatsCallback,
    ) => {
        debugPrompt(prompt);
        const jsonSchema = validator.getJsonSchema?.();
        if (jsonSchema !== undefined) {
            debugJsonSchema(jsonSchema);
        }
        return originalComplete(prompt, usageCallback, jsonSchema);
    };

    if (ai.supportsStreaming(model)) {
        const originalCompleteStream = model.completeStream.bind(model);
        model.completeStream = async (
            prompt: string | PromptSection[],
            usageCallback?: CompleteUsageStatsCallback,
        ) => {
            debugPrompt(prompt);
            const jsonSchema = validator.getJsonSchema?.();
            if (jsonSchema !== undefined) {
                debugJsonSchema(jsonSchema);
            }
            return originalCompleteStream(prompt, usageCallback, jsonSchema);
        };
    }

    const translator = createJsonTranslator<T>(model, validator);

    translator.stripNulls = true;

    const constraintsValidator = options?.constraintsValidator;
    if (constraintsValidator) {
        translator.validateInstance = constraintsValidator.validateConstraints;
    }

    // Patch up the property for json schema for stream.
    // Non-streaming result is patched during validation.
    function patchStreamCallback(prompt?: string | PromptSection[]) {
        if (prompt === undefined) {
            return;
        }
        const jsonSchema = validator.getJsonSchema?.();
        if (jsonSchema === undefined) {
            return;
        }

        const parser = getModelParams(prompt)?.parser;
        if (parser === undefined) {
            return;
        }
        const callback = parser.callback;
        parser.callback = Array.isArray(jsonSchema)
            ? (prop, value, delta) => {
                  let actualPropName = "actionName";
                  if (prop !== "name") {
                      const prefix = "arguments.";
                      if (!prop.startsWith(prefix)) {
                          throw new Error(`Invalid property name: ${prop}`);
                      }
                      actualPropName = `parameters.${prop.slice(prefix.length)}`;
                  }
                  callback(actualPropName, value, delta);
              }
            : (prop, value, delta) => {
                  const prefix = "response.";
                  if (!prop.startsWith(prefix)) {
                      throw new Error(`Invalid property name: ${prop}`);
                  }
                  const actualPropName = prop.slice(prefix.length);
                  callback(actualPropName, value, delta);
              };
    }

    const innerFn = translator.translate;
    const instructions = options?.instructions;
    if (!instructions) {
        translator.translate = async (
            request: string,
            promptPreamble?: string | PromptSection[],
        ) => {
            patchStreamCallback(promptPreamble);
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
        patchStreamCallback(promptPreamble);
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
            `Based on all available information in our chat history including images previously provided, the following is the latest user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
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
    options?: JsonTranslatorOptions<T>,
) {
    return createJsonTranslatorFromSchemaDef<T>(
        typeName,
        getTranslationSchemaText(schemaFiles),
        options,
    );
}

const header = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.`;

export function readSchemaFile(schemaFile: string): string {
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
