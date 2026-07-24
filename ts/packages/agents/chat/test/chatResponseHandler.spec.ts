// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";
import { ChatResponseAction } from "../src/chatResponseActionSchema.js";
import {
    executeChatResponseAction,
    relatedFileToEntity,
} from "../src/chatResponseHandler.js";

describe("relatedFileToEntity", () => {
    it("tags an uploaded image attachment as an image entity", () => {
        const entity = relatedFileToEntity("attachment_0.png");

        expect(entity.name).toBe("attachment_0.png");
        expect(entity.type).toEqual(["file", "image", "data"]);
    });

    it("records a highlighted workspace file as a plain file reference", () => {
        const entity = relatedFileToEntity(
            "pipelines/azure-build-docker-container.yml",
        );

        // Base name only, and not tagged as an image.
        expect(entity.name).toBe("azure-build-docker-container.yml");
        expect(entity.type).toEqual(["file"]);
    });
});

describe("executeChatResponseAction", () => {
    it("answers with a highlighted workspace file without reading storage", async () => {
        const reads: string[] = [];
        const context = {
            actionIO: {
                setDisplay: () => {},
                appendDisplay: () => {},
            },
            sessionContext: {
                sessionStorage: {
                    read: (path: string) => {
                        reads.push(path);
                        return Promise.reject(new Error("ENOENT"));
                    },
                },
            },
        } as unknown as ActionContext;

        const action = {
            actionName: "generateResponse",
            parameters: {
                originalRequest: "what does this pipeline do",
                generatedText: "It builds and publishes a container image.",
                userRequestEntities: [],
                generatedTextEntities: [],
                relatedFiles: ["pipelines/azure-build-docker-container.yml"],
            },
        } as unknown as TypeAgentAction<ChatResponseAction>;

        const result = await executeChatResponseAction(action, context);

        // A non-image editor reference must neither hit storage nor throw, and
        // is recorded as a plain file entity.
        expect(reads).toEqual([]);
        expect(result?.entities).toContainEqual({
            name: "azure-build-docker-container.yml",
            type: ["file"],
        });
    });
});
