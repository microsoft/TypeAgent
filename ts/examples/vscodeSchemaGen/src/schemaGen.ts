// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import dotenv from "dotenv";
import * as fs from "fs";
import { finished } from "stream/promises";

import {
    ChatModel,
    ChatModelWithStreaming,
    EmbeddingModel,
    openai,
} from "aiclient";
import { generateActionRequests } from "./actionGen.js";
import { dedupeList, generateEmbeddingWithRetry, TypeSchema } from "typeagent";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function getModelCompletionResponse(
    chatModel: ChatModelWithStreaming,
    prompt: string,
    jsonNode: any,
): Promise<string | undefined> {
    const chatResponse = await chatModel.complete(prompt);
    if (chatResponse.success) {
        const responseText = chatResponse.data;
        return responseText;
    } else {
        console.log("Error:" + chatResponse.message);
        return undefined;
    }
}

async function writeSchemaEmbeddingsDataToFile(
    schemaData: any[],
    outputPath: string,
): Promise<void> {
    const writeStream = fs.createWriteStream(outputPath);
    return new Promise((resolve, reject) => {
        schemaData.forEach((item) => {
            try {
                writeStream.write(JSON.stringify(item) + "\n");
            } catch (error) {
                reject(error);
            }
        });
        writeStream.end();
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
    });
}

export async function createVSCODESchemaGen(
    model: ChatModelWithStreaming,
    jsonSchema: any,
) {
    console.log("Generating VSCODE schema...");
    model.complete("Generate VSCODE schema").then((response: any) => {
        if (response.choices) {
            const schema = response.choices[0].text;
            console.log(schema);

            console.log(`Prompt tokens: ${response.usage.prompt_tokens}`);
            console.log(
                `Completion tokens: ${response.usage.completion_tokens}`,
            );
            console.log(`Total tokens: ${response.usage.total_tokens}`);
        }
    });
}

async function genActionSchemaForNode(jsonNode: any, verbose: boolean = false) {
    const model = openai.createChatModel("GPT_4_O");
    const prompt = `
You will be provided with a single JSON node representing a VSCode action. Your task is to generate a TypeScript type definition that meets the following rules:

1. **Input Details**:
   - The input JSON node will always include an \`id\` field, and it may include optional fields like \`metadata\` or \`when\`.

2. **Type Name**:
   - The TypeScript type name must be derived from the \`id\` field by:
     - Removing all dots (\`.\`) and converting the remaining parts to PascalCase.
     - For example, if the \`id\` is \`editor.action.diffReview.next\`, the type name must be \`EditorActionDiffReviewNext\`.

3. **Fields in the Type**:
   - Include:
     - An \`actionName\` field with a literal value matching the exact \`id\` field of the JSON node.
     - A \`parameters\` field, which must remain empty (\`{}\`) if no metadata or arguments exist.

4. **Comments**:
   - Write a **single-line comment** above the type to describe its purpose:
     - Use the \`metadata.description.value\` field (if available) to write a concise description of the action.
     - If the \`id\` contains specific keywords like "accessible" or other meaningful context, explicitly mention this in the comment even if it's not part of the \`metadata.description.value\`.
     - If the \`when\` field exists, rephrase it into a human-readable condition and append it to the comment.
     - If neither \`metadata\` nor a meaningful condition exists, derive the comment from the \`id\` field, ensuring it provides a clear understanding of the action.

     5. **Output Constraints**:
   - Return only the generated TypeScript type definition for the provided JSON node.
   - Do not include any extra types, code blocks, or markdown syntax.
   - Avoid including \`\`\`typescript or any similar code delimiters in the output.

### Example Input and Output
#### Input JSON Node:
{
  "id": "editor.action.accessibleDiffViewer.prev",
  "metadata": {
    "description": {
      "value": "Go to Previous Difference",
      "original": "Go to Previous Difference"
    }
  },
  "when": "isInDiffEditor"
}

#### Output Type:
// Go to Previous Difference in accessibility mode when in a diff editor
type EditorActionAccessibleDiffViewerPrev = {
  actionName: "editor.action.accessibleDiffViewer.prev";
  parameters: {};
};

#### Important:
The example above demonstrates how the comment should incorporate critical keywords (like "accessible") from the \`id\`, even if not explicitly mentioned in the \`metadata\`. Follow this logic for all inputs.

JSON Node:
${JSON.stringify(jsonNode, null, 2)}

TypeScript Type:
`;

    if (verbose) {
        console.log("**Schema Gen Prompt**: ", prompt);
    }
    return await getModelCompletionResponse(model, prompt, jsonNode);
}

function parseTypeComponents(schema: string): {
    typeName: string;
    actionName: string;
    comments: string[];
} {
    return {
        typeName: (schema.match(/type\s+(\w+)\s*=/) || [])[1] || "",
        actionName:
            (schema.match(/actionName:\s*['"](.+?)['"]/) || [])[1] || "",
        comments: (schema.match(/\/\/.*/g) || []).map((comment) =>
            comment.trim(),
        ),
    };
}

export async function generateEmbeddingForActionsRequests(
    model: EmbeddingModel<string>,
    actionRequests: string[],
): Promise<any> {
    const userRequestEmbeddings = await Promise.all(
        actionRequests.map(async (request: string) => ({
            request,
            embedding: Array.from(
                await generateEmbeddingWithRetry(model, request),
            ),
        })),
    );
    return userRequestEmbeddings;
}

export async function genEmbeddingDataFromActionSchema(
    model: ChatModel,
    jsonFilePath: string,
    schemaFilePath: string,
    actionPrefix: string | undefined,
    output_dir: string,
    maxNodestoProcess: number = -1,
) {
    if (fs.existsSync(schemaFilePath)) {
        const schema = fs.readFileSync(schemaFilePath, "utf8");
        const schemaLines = schema.split("\n\n");
        const schemaDefinitions: string[] = [];
        for (const line of schemaLines) {
            schemaDefinitions.push(line);
        }

        const embeddingModel = openai.createEmbeddingModel();
        let aggrData: any = [];
        let processedNodeCount = 0;

        for (const schemaStr of schemaDefinitions) {
            let actionSchemaData: any = parseTypeComponents(schemaStr);
            const actionString: string = `${actionSchemaData.typeName} ${actionSchemaData.actionName} ${actionSchemaData.comments.join(" ")}`;
            let actionEmbedding: Float32Array =
                await generateEmbeddingWithRetry(
                    embeddingModel,
                    JSON.stringify(actionString),
                );

            let typeSchema: TypeSchema = {
                typeName: actionSchemaData.typeName,
                schemaText: schemaStr,
            };

            let actionRequests: string[] = await generateActionRequests(
                "variations",
                model,
                typeSchema,
                actionSchemaData.comments.join(" "),
                25,
            );

            actionRequests = dedupeList(actionRequests);
            actionRequests.sort();

            let actionReqEmbeddings = await generateEmbeddingForActionsRequests(
                embeddingModel,
                actionRequests,
            );

            aggrData.push({
                ...actionSchemaData,
                schema: schemaStr,
                embedding: Array.from(actionEmbedding),
                requests: actionReqEmbeddings,
            });

            processedNodeCount++;

            if (processedNodeCount % 50 === 0) {
                console.log(
                    `Processed ${processedNodeCount} schema definitions so far.`,
                );
            }
        }

        if (aggrData.length > 0) {
            const jsonlFileName =
                actionPrefix !== undefined && actionPrefix.length > 0
                    ? path.join(
                          output_dir,
                          "aggr_data_[" + actionPrefix + "].jsonl",
                      )
                    : path.join(output_dir, "aggr_data.jsonl");
            writeSchemaEmbeddingsDataToFile(aggrData, jsonlFileName);
            console.log(
                `Aggregate action and request data file: ${jsonlFileName}`,
            );
        }
        console.log(
            `Total action schema definitions processed: ${processedNodeCount}`,
        );
    } else {
        console.log(`Schema file not found: ${schemaFilePath}`);
    }
}

async function persistSchemaDefinitions(
    schemaFilePath: string,
    schemaDefinitions: string[],
    processedNodeCount: number,
    schemaCount: number,
): Promise<void> {
    const writeStream = fs.createWriteStream(schemaFilePath, {
        encoding: "utf8",
    });
    for (const definition of schemaDefinitions) {
        if (!writeStream.write(`${definition}\n\n`)) {
            await new Promise((resolve) => writeStream.once("drain", resolve));
        }
    }
    writeStream.end();
    await finished(writeStream);

    console.log(`Schema definitions file: ${schemaFilePath}`);
    console.log(
        `Total nodes processed: ${processedNodeCount}, Total schemas generated: ${schemaCount}`,
    );
}

export async function processVscodeCommandsJsonFile(
    model: ChatModel,
    jsonFilePath: string,
    schemaFilePath: string,
    actionPrefix: string | undefined,
    output_dir: string,
    maxNodestoProcess: number = -1,
    verbose: boolean = false,
) {
    const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, "utf8"));
    const embeddingModel = openai.createEmbeddingModel();

    const schemaDefinitions: string[] = [];
    let processedNodeCount = 0;
    let schemaCount = 0;
    let aggrData: any = [];

    for (const node of jsonData) {
        try {
            if (actionPrefix && !node.id.startsWith(actionPrefix)) {
                continue;
            }

            const schemaStr: string | undefined = await genActionSchemaForNode(
                node,
                verbose,
            );
            processedNodeCount++;

            if (schemaStr !== undefined) {
                if (verbose) {
                    console.log(
                        "------------------------------------------------",
                    );
                    console.log(
                        `JSON for node: ${JSON.stringify(node, null, 2)}:`,
                    );
                    console.log(`Schema for node:\n${schemaStr}`);
                    console.log(
                        "------------------------------------------------",
                    );
                }

                schemaDefinitions.push(schemaStr);
                schemaCount++;

                let actionSchemaData: any = parseTypeComponents(schemaStr);
                const actionString: string = `${actionSchemaData.typeName} ${actionSchemaData.actionName} ${actionSchemaData.comments.join(" ")}`;
                let actionEmbedding: Float32Array =
                    await generateEmbeddingWithRetry(
                        embeddingModel,
                        JSON.stringify(actionString),
                    );

                let typeSchema: TypeSchema = {
                    typeName: actionSchemaData.typeName,
                    schemaText: schemaStr,
                };

                let actionRequests: string[] = await generateActionRequests(
                    "variations",
                    model,
                    typeSchema,
                    actionSchemaData.comments.join(" "),
                    25,
                );

                actionRequests = dedupeList(actionRequests);
                actionRequests.sort();

                let actionReqEmbeddings =
                    await generateEmbeddingForActionsRequests(
                        embeddingModel,
                        actionRequests,
                    );

                aggrData.push({
                    ...actionSchemaData,
                    schema: schemaStr,
                    embedding: Array.from(actionEmbedding),
                    requests: actionReqEmbeddings,
                });
            }

            if (
                maxNodestoProcess > 0 &&
                processedNodeCount >= maxNodestoProcess
            ) {
                break;
            }

            if (processedNodeCount % 50 === 0) {
                console.log(
                    `Processed ${processedNodeCount} nodes so far. Schemas generated: ${schemaCount}`,
                );
            }
        } catch (error) {
            console.error(
                `Error generating schema for node ${node.id}:`,
                error,
            );
        }
    }

    persistSchemaDefinitions(
        schemaFilePath,
        schemaDefinitions,
        processedNodeCount,
        schemaCount,
    );

    if (aggrData.length > 0) {
        const jsonlFileName =
            actionPrefix !== undefined && actionPrefix.length > 0
                ? path.join(
                      output_dir,
                      "aggr_data_[" + actionPrefix + "].jsonl",
                  )
                : path.join(output_dir, "aggr_data.jsonl");
        writeSchemaEmbeddingsDataToFile(aggrData, jsonlFileName);
        console.log(`Aggregate action and request data file: ${jsonlFileName}`);
    }
}
