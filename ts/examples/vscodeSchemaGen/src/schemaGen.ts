// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModelWithStreaming, openai } from "aiclient";
import dotenv from "dotenv";
import * as fs from 'fs';

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function getModelCompletionResponse(
    chatModel: ChatModelWithStreaming,
    prompt: string,
    jsonNode: any,
): Promise<string|undefined> {
    const chatResponse = await chatModel.complete(prompt);
    if (chatResponse.success) {
        const responseText = chatResponse.data;
        console.log(responseText);
        return responseText;
    } else {
        console.log(chatResponse.message);
        return undefined;
    }
}

export async function createVSCODESchemaGen(model: ChatModelWithStreaming, jsonSchema: any) {
    console.log("Generating VSCODE schema...");

    model.complete("Generate VSCODE schema").then((response: any) => {
        if(response.choices) {
            const schema = response.choices[0].text;
            console.log(schema);

            console.log(`Prompt tokens: ${response.usage.prompt_tokens}`);
            console.log(`Completion tokens: ${response.usage.completion_tokens}`);
            console.log(`Total tokens: ${response.usage.total_tokens}`);
        }
    })
}

async function genActionSchemaForNode(jsonNode: any) {

    const model = openai.createChatModel("GPT_4_O");

    const prompt = `
Generate a compact TypeScript type for the following VSCode action. The type should have the following structure:

1. An \`actionName\` field with a literal value based on the \`id\` property of the JSON node.
2. A \`parameters\` field that:
    - Should be included but empty if no metadata or arguments exist in the JSON node.
    - If \`metadata\` exists in the JSON node, include it succinctly as part of the high-level comment for the type, describing the action based on the \`description\` field and any arguments.
    - If the \`when\` field exists, include the literal value as part of the comment describing the condition under which the action is applicable.
    - Do not include \`key\` and \`when\` properties in the type definition.
    - Do not include the \`metadata\` as a field in the parameters in the type definition.
3. The result should be a valid, concise TypeScript type definition with meaningful but minimal comments.
4. All comments should be prefixed with \`//\`.

JSON Node:
${JSON.stringify(jsonNode, null, 2)}

TypeScript Type:
`;
    
    return await getModelCompletionResponse(model, prompt, jsonNode);
}

export async function processVscodeCommandsJsonFile(jsonFilePath: string, outputFilePath: string) {
    const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));

    const schemaDefinitions: string[] = [];

    for (const node of jsonData) {
        try {
        const schema:string|undefined = await genActionSchemaForNode(node);
        if(schema)
        {
            console.log(schema);
            schemaDefinitions.push(schema);
        }
        } catch (error) {
        console.error(`Error generating schema for node ${node.id}:`, error);
        }
    }

    fs.writeFileSync(outputFilePath, schemaDefinitions.join('\n\n'));
    console.log(`Schema definitions written to ${outputFilePath}`);
}