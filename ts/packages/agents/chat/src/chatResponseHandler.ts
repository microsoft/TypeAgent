// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getImageElement, getMimeType } from "common-utils";
import {
    ChatResponseAction,
    Entity,
    GenerateResponseAction,
} from "./chatResponseActionSchema.js";

import { ActionContext, AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import {
    createActionResultFromHtmlDisplay,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";

export function instantiate(): AppAgent {
    return {
        executeAction: executeChatResponseAction,
        streamPartialAction: streamPartialChatResponseAction,
    };
}

export async function executeChatResponseAction(
    chatAction: TypeAgentAction<ChatResponseAction>,
    context: ActionContext,
) {
    return handleChatResponse(chatAction, context);
}

async function rehydrateImages(context: ActionContext, files: string[]) {
    let html = "<div>";

    for (let i = 0; i < files.length; i++) {
        let name = files[i];
        console.log(`Rehydrating Image ${name}`);
        if (files[i].lastIndexOf("\\") > -1) {
            name = files[i].substring(files[i].lastIndexOf("\\") + 1);
        }

        let a = await context.sessionContext.sessionStorage?.read(
            `\\..\\user_files\\${name}`,
            "base64",
        );

        if (a) {
            html += getImageElement(
                `data:image/${getMimeType(name.substring(name.indexOf(".")))};base64,${a}`,
            );
        }
    }

    html += "</div>";

    return html;
}

async function handleChatResponse(
    chatAction: ChatResponseAction,
    context: ActionContext,
) {
    console.log(JSON.stringify(chatAction, undefined, 2));
    switch (chatAction.actionName) {
        case "generateResponse": {
            return generateResponse(chatAction, context);
        }

        case "showImageFile":
            return createActionResultFromHtmlDisplay(
                `<div>${await rehydrateImages(context, chatAction.parameters.files)}</div>`,
            );

        default:
            throw new Error(
                `Invalid chat action: ${(chatAction as TypeAgentAction).actionName}`,
            );
    }
}

async function generateResponse(
    generateResponseAction: GenerateResponseAction,
    context: ActionContext,
) {
    const parameters = generateResponseAction.parameters;
    const generatedText = parameters.generatedText;
    if (generatedText !== undefined) {
        logEntities("UR Entities:", parameters.userRequestEntities);
        logEntities("GT Entities:", parameters.generatedTextEntities);
        console.log(
            "Got generated text: " + generatedText.substring(0, 100) + "...",
        );

        const streamingContext = context.streamingContext;
        context.streamingContext = undefined; // clear the streaming context
        if (streamingContext !== generatedText) {
            // Either we didn't stream, or we streamed a different text.
            // REVIEW: what happens to the speaking text that was streamed?
            context.actionIO.setDisplay({
                type: "text",
                content: generatedText,
                speak: streamingContext === undefined,
            });
        }

        // Add the related files.
        if (generateResponseAction.parameters.relatedFiles) {
            context.actionIO.appendDisplay(
                `<div class='chat-smallImage'>${await rehydrateImages(context, generateResponseAction.parameters.relatedFiles!)}</div>`,
                "block",
            );
        }

        const result = createActionResultNoDisplay(generatedText);

        const entities = parameters.generatedTextEntities || [];
        if (parameters.userRequestEntities !== undefined) {
            result.entities = parameters.userRequestEntities.concat(entities);
        }

        if (generateResponseAction.parameters.relatedFiles !== undefined) {
            const fileEntities: Entity[] = new Array<Entity>();
            for (const file of generateResponseAction.parameters.relatedFiles) {
                let name = file;
                if (file.lastIndexOf("\\") > -1) {
                    name = file.substring(file.lastIndexOf("\\") + 1);
                }
                fileEntities.push({
                    name,
                    type: ["file", "image", "data"],
                });
            }

            logEntities("File Entities:", fileEntities);
            result.entities = result.entities.concat(fileEntities);
        }

        return result;
    }
}

export function logEntities(label: string, entities?: Entity[]): void {
    if (entities && entities.length > 0) {
        console.log(label);
        for (const entity of entities) {
            console.log(`  ${entity.name} (${entity.type})`);
        }
    }
}

function streamPartialChatResponseAction(
    actionName: string,
    name: string,
    value: string,
    delta: string | undefined,
    context: ActionContext,
) {
    if (actionName !== "generateResponse") {
        return;
    }

    // don't stream empty string and undefined as well.
    if (name === "parameters.generatedText") {
        if (delta === undefined) {
            // we finish the streaming text.  add an empty string to flush the speaking buffer.
            context.actionIO.appendDisplay("");
        }
        // Don't stream empty deltas
        if (delta) {
            if (context.streamingContext === undefined) {
                context.streamingContext = "";
            }
            context.streamingContext += delta;
            context.actionIO.appendDisplay({
                type: "text",
                content: delta,
                speak: true,
            });
        }
    }
}
