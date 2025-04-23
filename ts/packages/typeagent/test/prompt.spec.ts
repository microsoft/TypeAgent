// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import {
    createChatHistory,
    getContextFromHistory,
    getTotalPromptLength,
    PromptSections,
} from "../src/prompt.js";
import { MessageSourceRole } from "../src/message.js";

describe("Prompts", () => {
    test("ChatHistory", () => {
        let maxContextLength = 1024;
        let messageCount = 6;
        let sections = generateMessages(messageCount);
        expect(getTotalPromptLength(sections.sections)).toEqual(
            sections.length,
        );
        let halfLength = getTotalPromptLength(
            sections.sections.slice(messageCount / 2),
        );
        let context = [...getContextFromHistory(sections.sections, halfLength)];
        expect(context).toHaveLength(messageCount / 2);

        let messages = sections.sections;
        context = [...getContextFromHistory(messages, maxContextLength)];
        expect(context).toHaveLength(messageCount);

        let historySize = 4;
        let limitedHistory = createChatHistory(historySize);
        for (const msg of messages) {
            limitedHistory.push(msg);
        }
        expect(limitedHistory.length).toEqual(historySize);
        expect(limitedHistory.getEntries()).toEqual(messages.slice(2));

        context = [...getContextFromHistory(limitedHistory, maxContextLength)];
        expect(context).toHaveLength(historySize);
        context = [...getContextFromHistory(sections.sections, halfLength)];
        expect(context).toHaveLength(messageCount / 2);
    });

    function generateMessages(count: number): PromptSections {
        let length = 0;
        let sections: PromptSection[] = [];
        for (let i = 0; i < count; ++i) {
            let content = `Message ${i}`;
            sections.push({
                role: MessageSourceRole.user,
                content,
            });
            length += content.length;
        }
        return {
            length,
            sections,
        };
    }
});
