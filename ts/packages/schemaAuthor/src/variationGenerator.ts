// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    MessageSourceRole,
    TypeSchema,
    VariationType,
    generateList,
} from "typeagent";
import { TypeChatLanguageModel } from "typechat";

/**
 * Generate phrases that could target the given action schema
 * @param type
 * @param model
 * @param actionSchema
 * @param actionDescription
 * @param count
 * @param facets
 * @returns
 */
export async function generateActionPhrases(
    type: VariationType | string,
    model: TypeChatLanguageModel,
    actionSchema: TypeSchema,
    actionDescription: string | undefined,
    count: number,
    facets?: string,
    example?: string,
    language?: string,
): Promise<string[]> {
    let instructions: string = "";
    if (actionDescription) {
        instructions += `${actionSchema.typeName} => ${actionDescription}\n`;
    }
    instructions += `The following is schema for "${actionSchema.typeName}":\n${actionSchema.schemaText}`;
    let listDef = `Generate ${type} plain text phrases that can be translated to "${actionSchema.typeName}"`;
    listDef += "Do not put NAMES in quotes.";
    if (example) {
        listDef += "\nUse this seed phrase as a template:\n" + example;
    }
    if (facets) {
        listDef +=
            "\nVary the following facets of generated phrases: " + facets;
    }
    if (language) {
        listDef += `\nOutput phrases in ${language}`;
    }
    return await generateList(
        model,
        listDef,
        [{ role: MessageSourceRole.user, content: instructions }],
        count,
    );
}

/**
 * Generate
 * @param model
 * @param seedPhrase
 * @param count
 * @param facets
 * @param language
 * @returns
 */
export async function generateOutputTemplate(
    model: TypeChatLanguageModel,
    seedPhrase: string,
    count: number,
    facets?: string,
    language: string = "Typescript",
): Promise<string[]> {
    let instructions: string = "";
    instructions += `The following is a ${language} string output TEMPLATE:\n"${seedPhrase}"`;
    let listDef = `Generate alternate template phrases with the same input variables and same meaning. "`;
    if (facets) {
        listDef +=
            "\nVary the following facets of generated phrases: " + facets;
    }
    return await generateList(
        model,
        listDef,
        [{ role: MessageSourceRole.user, content: instructions }],
        count,
    );
}
