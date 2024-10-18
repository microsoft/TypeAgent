// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Use TypeChat to translate a natural languagecommand to a command structure.
// The command structure is given by some schema.

import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
} from "interactive-app";
import {
    TypeChatLanguageModel,
    TypeChatJsonTranslator,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

export interface CommandTransformer {
    model: TypeChatLanguageModel;
    metadata?: Record<string, string | CommandMetadata>;
    schemaText?: string;
    translator?: TypeChatJsonTranslator<any>;
    transform(command: string, io: InteractiveIo): Promise<object | undefined>;
}

export function createCommandTransformer(
    model: TypeChatLanguageModel,
): CommandTransformer {
    const transformer: CommandTransformer = {
        model,
        transform,
    };

    async function transform(command: string): Promise<object | undefined> {
        const promptPreamble =
            "If no value is given for a parameter, use the default from the comment, if any.";
        const result = await transformer.translator!.translate(
            command,
            promptPreamble,
        );
        if (result.success === false) {
            console.log("[Error]:", result.message);
            return undefined;
        } else {
            console.log("[Success]:", JSON.stringify(result, null, 2));
            return result.data;
        }
    }

    return transformer;
}

// Call this when the handlers' metadata is complete, before calling transform()
export function completeCommandTransformer(
    handlers: Record<string, CommandHandler>,
    commandTransformer: CommandTransformer,
): void {
    // Copy the handlers' metadata into the command transformer
    const cmdMetadata: Record<string, string | CommandMetadata> = {};
    for (const key in handlers) {
        if (!/^\w+/.test(key)) {
            continue;
        }
        const metadata = handlers[key].metadata;
        if (typeof metadata === "undefined") {
            cmdMetadata[key] = key;
        } else {
            cmdMetadata[key] = metadata;
        }
    }
    commandTransformer.metadata = cmdMetadata;

    // Construct a suitable TypeChat schema and add it
    let schemaText: string = "";
    for (const key in cmdMetadata) {
        schemaText += makeClassDef(key, cmdMetadata[key]);
    }
    schemaText += "export type Command = \n";
    for (const key in cmdMetadata) {
        schemaText += `  | ${key}\n`;
    }
    schemaText += "  | { name: 'Unknown', query: string }  // Fallback\n";
    schemaText += ";\n";
    commandTransformer.schemaText = schemaText;
    // console.log("[schema text begin]");
    console.log(schemaText);
    // console.log("[schema text end]");

    // Now construct the translator and add it
    const validator = createTypeScriptJsonValidator<any>(
        commandTransformer.schemaText,
        "Command",
    );
    const translator = createJsonTranslator<any>(
        commandTransformer.model,
        validator,
    );
    commandTransformer.translator = translator;
}

function makeClassDef(
    name: string,
    metadata: string | CommandMetadata,
): string {
    if (typeof metadata === "string") {
        return (
            `// ${metadata}\n` +
            `export interface ${name} { name: '${name}'; args: string[]; }\n\n`
        );
    }
    let def = `// ${metadata.description}\n`;
    def += `export interface ${name} {\n`;
    def += "  name: '" + name + "';\n";
    // TODO: the same for args (currently not used by code chat)
    const options = metadata.options;
    for (const key in options) {
        const option = options[key];
        let tp: string | undefined = option.type
            ? String(option.type)
            : undefined;
        if (tp === "path") {
            tp = "string";
        }
        if (!tp) {
            tp = "string";
        }
        if (option.defaultValue === undefined) {
            def += `  ${key}: ${tp}`;
        } else {
            def += `  ${key}?: ${tp} | undefined`;
        }
        def += ";";
        if (option.description) {
            def += `  // ${option.description}`;
        }
        if (option.defaultValue !== undefined) {
            def += `  // default: ${JSON.stringify(option.defaultValue)}`;
        }
        def += "\n";
    }
    def += "}\n\n";
    return def;
}
