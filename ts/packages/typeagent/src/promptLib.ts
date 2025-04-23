// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * A library of common Prompt Sections to include in requests
 */

import { PromptSection } from "typechat";
import { MessageSourceRole } from "./message.js";
import { dateTime } from "./index.js";

/**
 * Prompt that tells the model about the current date and time.
 * @returns prompt
 */
export function dateTimePrompt(): string {
    const now = new Date();
    let prompt = `CURRENT DATE AND TIME: ${now.toString()}\n`;
    prompt +=
        "Use precise date and times RELATIVE to current date & time. Turn ranges like next week and next month into precise dates";
    return prompt;
}

/**
 * A prompt section that supplies the current time stamp
 * @returns
 */
export function dateTimePromptSection(): PromptSection {
    return { role: MessageSourceRole.user, content: dateTimePrompt() };
}

/**
 * Prompt that tells the model about the current date and time.
 * @returns prompt
 */
export function dateTimeRangePrompt(range: dateTime.DateRange): string {
    let prompt = `DATE TIME RANGE: "${range.startDate}"`;
    if (range.stopDate) {
        prompt += ` TO "${range.stopDate}"`;
    }
    prompt += "\n";
    prompt +=
        "Use precise date and times RELATIVE to the DATE TIME RANGE. Turn ranges like next week and next month into precise dates";
    return prompt;
}

/**
 * A prompt section that supplies the current time stamp
 * @returns
 */
export function dateTimeRangePromptSection(
    range: dateTime.DateRange,
): PromptSection {
    return {
        role: MessageSourceRole.user,
        content: dateTimeRangePrompt(range),
    };
}

export function textToProcessSection(text: string): PromptSection {
    return { role: MessageSourceRole.user, content: "[TEXT SECTION]\n" + text };
}
