// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SDKAssistantMessage,
    SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export function printAssistant(message: SDKAssistantMessage) {
    let outputString = "======== Assistant ========\n";

    message.message.content.forEach((value) => {
        switch (value.type) {
            case "text": {
                outputString += value.text;
                break;
            }
            case "redacted_thinking": {
                outputString += value.data;
                break;
            }
            case "thinking": {
                outputString += `${value.thinking}, ${value.signature}`;
                break;
            }
            case "tool_use": {
                outputString += `Tool: ${value.name} \n ${value.id} \n ${JSON.stringify(value.input)}`;
                break;
            }
            default: {
                break;
            }
        }
    });

    console.log(outputString);
}

export function printUser(message: SDKUserMessage) {
    let outputString = "======== User ========\n";

    if (typeof message.message.content === "string") {
        outputString += message.message.content;
        console.log(outputString);
        return;
    }

    message.message.content.forEach((value) => {
        switch (value.type) {
            case "document": {
                outputString += `Document: \n ${value.title} \n ${value.context} \n ${value.source}`;
                break;
            }
            case "image": {
                outputString += `Image: \n ${value.source}`;
                break;
            }
            case "redacted_thinking": {
                outputString += `Thinking: ${value.data}`;
                break;
            }
            case "text": {
                outputString += `${value.text}`;
                break;
            }
            case "thinking": {
                outputString += `Thinking: ${value.thinking}`;
                break;
            }
            case "tool_result": {
                outputString += `Tool Result: \n ${value.tool_use_id} \n ${value.content}`;
                break;
            }
            case "tool_use": {
                outputString += `Tool Use: \n ${value.name} \n ${value.id} \n ${JSON.stringify(value.input)}`;
                break;
            }
            default: {
                break;
            }
        }
    });
}
