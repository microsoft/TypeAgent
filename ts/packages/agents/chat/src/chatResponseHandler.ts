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
    createActionResult,
    createActionResultFromHtmlDisplay,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { MessageContentUnion, MessageTextContent, MessageTextUrlCitationAnnotation } from "@azure/ai-agents";

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
            await runAgentConversation(chatAction.parameters.originalRequest, context);
            return generateReponse(chatAction, context);
           break;
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

async function runAgentConversation(userRequest: string, context: ActionContext) {
  const project = new AIProjectClient(
    "https://typeagent-test-agent-resource.services.ai.azure.com/api/projects/typeagent-test-agent",
    new DefaultAzureCredential());

  const agent = await project.agents.getAgent("asst_qBRBuICfBaNYDH3WnpbBUSb0");
  console.log(`Retrieved agent: ${agent.name}`);

  const thread = await project.agents.threads.create({});

  //const thread = await project.agents.threads.get("thread_mR7ai8Hgk6eoe3UvdEjzFkGW");
  //console.log(`Retrieved thread, thread ID: ${thread.id}`);

  const message = await project.agents.messages.create(thread.id, "user", userRequest);
  console.log(`Created message, message ID: ${message.id}`);

  // Create run
  // TODO: implement streaming API when it's available
  let run = await project.agents.runs.createAndPoll(thread.id, agent.id, { stream: false })

  // Poll until the run reaches a terminal status
//   while (run.status === "queued" || run.status === "in_progress") {
//     // Wait for a second
//     await new Promise((resolve) => setTimeout(resolve, 1000));
//     run = await project.agents.runs.get(thread.id, run.id);
//   }

  if (run.status === "failed") {
    console.error(`Run failed: `, run.lastError);
  }

  console.log(`Run completed with status: ${run.status}`);

  // Retrieve messages
  const messages = await project.agents.messages.list(thread.id, { order: "asc" });

  // Display messages
  for await (const m of messages) {
    if (m.role === "assistant") {
        // TODO: handle multi-modal content
        const content: MessageContentUnion | undefined = m.content.find((c) => c.type === "text" && "text" in c);
        if (content) {
            //context.actionIO.appendDisplay(`${JSON.stringify(m.role)}: ${JSON.stringify(content)}`);
            const textContent: MessageTextContent = content as MessageTextContent;
            let annotations = "";
            textContent.text.annotations.forEach((a) => {
                switch (a.type) {
                    case "url_cititation":
                        const citation: MessageTextUrlCitationAnnotation = a as MessageTextUrlCitationAnnotation;
                        annotations += `<a href="${citation.urlCitation.url}" target="_blank">${citation.urlCitation.title}</a>`;
                        break;
                    // TODO: other annotation types
                }
            });

            context.actionIO.appendDisplay({
                type: "html",
                content: `${textContent.text.value.replace("\n", "<br/>")}<br/>${annotations}`,
            });

            //console.log(`${m.role}: ${content}`);
        }
    }
  }
}

async function generateReponse(generateResponseAction: GenerateResponseAction, context: ActionContext) {
    const parameters = generateResponseAction.parameters;
    const generatedText = parameters.generatedText;
    if (generatedText !== undefined) {
        logEntities("UR Entities:", parameters.userRequestEntities);
        logEntities("GT Entities:", parameters.generatedTextEntities);
        console.log(
            "Got generated text: " +
                generatedText.substring(0, 100) +
                "...",
        );

        const needDisplay =
            context.streamingContext !== generatedText ||
            generateResponseAction.parameters.relatedFiles;
        let result;
        if (needDisplay) {
            if (generateResponseAction.parameters.relatedFiles) {
                result = createActionResultFromHtmlDisplay(
                    `<div>${generatedText}</div><div class='chat-smallImage'>${await rehydrateImages(context, generateResponseAction.parameters.relatedFiles!)}</div>`,
                );
            } else {
                result = createActionResult(generatedText, true);
            }
        } else {
            result = createActionResultNoDisplay(generatedText);
        }

        let entities = parameters.generatedTextEntities || [];
        if (parameters.userRequestEntities !== undefined) {
            result.entities =
                parameters.userRequestEntities.concat(entities);
        }

        if (
            generateResponseAction.parameters.relatedFiles !== undefined
        ) {
            const fileEntities: Entity[] = new Array<Entity>();
            for (const file of generateResponseAction.parameters
                .relatedFiles) {
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
