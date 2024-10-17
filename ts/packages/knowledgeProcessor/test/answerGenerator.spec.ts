// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readAllText } from "typeagent";
import { CompositeEntity } from "../src/conversation/entities.js";
import {
    AnswerContext,
    splitAnswerContext,
} from "../src/conversation/answerGenerator.js";

describe("AnswerGenerator", () => {
    test("splitContext", async () => {
        const author: CompositeEntity = {
            name: "Jane Austen",
            type: ["author", "person"],
            facets: [
                'book="Pride and Prejudice"',
                'book="Mansfield Park"',
                'book="Sense and Sensibility"',
                'book="Emma"',
            ],
        };
        const messageText = await readAllText("test/data/longText.txt");
        const timestamp = new Date();
        const context: AnswerContext = {
            entities: { timeRanges: [], values: [author] },
            messages: [{ timestamp, value: messageText }],
        };
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
            } else {
                expect(chunk.entities).not.toBeDefined();
            }
            expect(chunk.messages).toBeDefined();
            console.log(chunk);
        }
    });
});
