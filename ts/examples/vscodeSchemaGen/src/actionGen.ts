// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    MessageSourceRole,
    TypeSchema,
    VariationType,
    generateList,
} from "typeagent";
import { TypeChatLanguageModel } from "typechat";

export async function generateActionRequests(
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
