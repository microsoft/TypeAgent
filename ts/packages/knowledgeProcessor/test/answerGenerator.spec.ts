// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readAllText } from "typeagent";
import { CompositeEntity } from "../src/conversation/entities.js";
import {
    AnswerContext,
    answerContextToString,
    splitAnswerContext,
} from "../src/conversation/answerContext.js";
import { mergeActions } from "../src/conversation/actions.js";
import { Action } from "../src/conversation/knowledgeSchema.js";

describe("AnswerGenerator", () => {
    test("splitContext", async () => {
        const messageText = await readAllText("test/data/longText.txt");
        const timestamp = new Date();
        const context: AnswerContext = createContext();

        context.messages = [{ timestamp, value: messageText }];
        const maxCharsPerChunk = 256;
        let chunkCount = 0;
        for (const chunk of splitAnswerContext(
            context,
            maxCharsPerChunk,
            true,
        )) {
            ++chunkCount;
            if (chunkCount === 1) {
                expect(chunk.entities).toBeDefined();
                expect(chunk.entities?.values).toHaveLength(1);
                expect(chunk.topics).toBeDefined();
                expect(chunk.topics?.values).toHaveLength(1);
            } else {
                expect(chunk.entities).not.toBeDefined();
                expect(chunk.messages).toBeDefined();
            }
        }
    });

    test("answerContextToString", () => {
        const author = createAuthor();
        const action = createAction();
        const context: AnswerContext = {
            entities: { timeRanges: [], values: [author] },
            topics: { timeRanges: [], values: createTopics() },
            actions: { timeRanges: [], values: mergeActions([action]) },
        };
        const j1 = answerContextToString(context);
        JSON.parse(j1);
    });

    function createContext() {
        const context: AnswerContext = {
            entities: { timeRanges: [], values: [createAuthor()] },
            topics: { timeRanges: [], values: createTopics() },
        };
        return context;
    }

    function createTopics() {
        return ["Classic English Literature"];
    }

    function createAuthor(): CompositeEntity {
        return {
            name: "Jane Austen",
            type: ["author", "person"],
            facets: [
                'book="Pride and Prejudice"',
                'book="Mansfield Park"',
                'book="Sense and Sensibility"',
                'book="Emma"',
            ],
        };
    }

    function createAction(): Action {
        return {
            subjectEntityName: "Jane Austen",
            verbs: ["write"],
            verbTense: "past",
            objectEntityName: "book",
            indirectObjectEntityName: "none",
        };
    }
});
