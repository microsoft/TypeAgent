// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Module for working with Prompts and Prompt Sections

import { PromptSection } from "typechat";
import { MessageSourceRole } from "./message.js";
import { toJsonLine } from "./objStream.js";
import { CircularArray } from "./lib/array.js";

/**
 * Create Prompt Sections from given strings
 * @param strings
 * @returns Prompt sections
 */
export function createPromptSections(
    strings: string | string[],
    role: MessageSourceRole,
): PromptSection[] {
    if (typeof strings === "string") {
        return [{ role: role, content: strings }];
    }
    return strings.map<PromptSection>((str) => {
        return { role: role, content: str };
    });
}

/**
 * Concatenate two prompt sections
 * @param first
 * @param second
 * @returns
 */
export function concatPromptSections(
    first?: PromptSection[],
    second?: PromptSection[],
): PromptSection[] | undefined {
    if (first) {
        if (second) {
            return first.concat(second);
        }
        return first;
    } else {
        return second;
    }
}

/**
 * Join sections into one:
 * @param role
 * @param sections
 * @returns
 */
export function joinPromptSections(
    role: MessageSourceRole,
    sections: PromptSection[],
): PromptSection {
    let content = "";
    for (const section of sections) {
        content += section.content + "\n";
    }
    return {
        role,
        content,
    };
}

/**
 * Get the cumulative length of all text in the given prompt sections
 * @param sections
 * @returns
 */
export function getTotalPromptLength(sections: PromptSection[]): number {
    let length = 0;
    for (let i = 0; i < sections.length; ++i) {
        length += sections[i].content.length;
    }
    return length;
}

export function getPreambleLength(preamble?: string | PromptSection[]): number {
    if (preamble) {
        if (Array.isArray(preamble)) {
            return getTotalPromptLength(preamble);
        } else {
            return preamble.length;
        }
    }
    return 0;
}

/**
 * Used to return a collection of prompt sections, along with the total length
 * of the individual sections
 * (Consider): This should probably be "ArrayLike" instead.
 */
export type PromptSections = {
    length: number; // Total length all prompt sections
    sections: PromptSection[];
};

/**
 * PromptBuilder builds prompts that can meet a given character/token budget.
 * A prompt consists of multiple prompt sections. Builders can be reused
 *
 * builder.begin();
 * push(), push()...
 * builder.complete();
 */
export interface PromptBuilder {
    maxLength: number;
    maxSections: number;
    currentLength: number;
    prompt: PromptSection[];

    /**
     * Call begin to start building a prompt
     */
    begin(): void;
    push(section: string | string[] | PromptSection | PromptSection[]): boolean;
    pushSection(section: PromptSection): boolean;
    pushText(content: string | string[]): boolean;
    pushSections(
        sections: PromptSection[] | IterableIterator<PromptSection>,
    ): boolean;
    /**
     * Call complete to finish building the prompt
     */
    complete(reverse?: boolean): PromptSections;
}

/**
 * A Prompt is a collection of Prompt Sections
 * Context is usually submitted as a collection of prompt sections.
 * But contexts must satisfy a token budget: typically constrained to a maximum character count, as that
 * is easier to deal with than token counts
 *
 * Builders can be reused.
 */
export function createPromptBuilder(
    maxLength: number,
    maxSections = Number.MAX_VALUE,
): PromptBuilder {
    const builder: PromptBuilder = {
        maxLength,
        maxSections,
        currentLength: 0,
        prompt: [],
        begin,
        push,
        pushSection,
        pushText,
        pushSections,
        complete,
    };
    return builder;

    function begin(): void {
        builder.prompt.length = 0;
    }

    function push(
        sections: string | string[] | PromptSection | PromptSection[],
    ): boolean {
        if (typeof sections === "string") {
            return pushText(sections);
        }
        if (Array.isArray(sections)) {
            for (let section of sections) {
                if (!push(section)) {
                    return false;
                }
            }
            return true;
        }
        return pushSection(sections);
    }

    function pushSection(section: PromptSection): boolean {
        if (willExceedLimit(section.content.length)) {
            return false;
        }
        builder.prompt.push(section);
        updateLength(section.content.length);
        return true;
    }

    function pushText(content: string): boolean {
        if (willExceedLimit(content.length)) {
            return false;
        }
        builder.prompt.push({
            role: MessageSourceRole.user,
            content: content,
        });
        updateLength(content.length);
        return true;
    }

    function pushSections(
        sections: PromptSection[] | IterableIterator<PromptSection>,
    ): boolean {
        if (Array.isArray(sections)) {
            for (let section of sections) {
                if (!pushSection(section)) {
                    return false;
                }
            }
        } else {
            for (let section of sections) {
                if (!pushSection(section)) {
                    return false;
                }
            }
        }
        return true;
    }

    function complete(reverse?: boolean): PromptSections {
        reverse ??= true;
        if (reverse) {
            builder.prompt.reverse();
        }
        return {
            length: builder.currentLength,
            sections: builder.prompt,
        };
    }

    function updateLength(length: number): void {
        builder.currentLength = builder.currentLength + length;
    }

    function willExceedLimit(
        newLength: number,
        newSectionCount: number = 1,
    ): boolean {
        return (
            builder.currentLength + newLength > builder.maxLength ||
            builder.prompt.length + newSectionCount > builder.maxSections
        );
    }
}

/**
 * Builds a single prompt section that sticks to a character budget.
 */
export interface PromptSectionBuilder {
    maxLength: number;
    buffer: string;

    begin(): void;
    push(object: any): boolean;
    pushText(text: string): boolean;
    complete(role: MessageSourceRole): PromptSection;
}

export function createPromptSectionBuilder(
    maxLength: number,
): PromptSectionBuilder {
    const builder: PromptSectionBuilder = {
        maxLength,
        buffer: "",
        begin,
        pushText,
        push: push,
        complete,
    };
    return builder;

    function begin(): void {
        builder.buffer = "";
    }

    function pushText(text: string): boolean {
        if (builder.buffer.length + text.length > maxLength) {
            return false;
        }
        builder.buffer = builder.buffer + text;
        return true;
    }

    function push(object: any): boolean {
        if (typeof object === "string") {
            return pushText(object);
        }
        return pushText(toJsonLine(object));
    }

    function complete(role: MessageSourceRole): PromptSection {
        return {
            role,
            content: builder.buffer,
        };
    }
}

export interface PromptSectionProvider {
    getSections(request: string): Promise<PromptSection[]>;
}

export interface ChatHistory extends Iterable<PromptSection> {
    readonly length: number;
    get(index: number): PromptSection;
    getEntries(maxEntries?: number): PromptSection[];
    push(message: PromptSection): void;
}

/**
 * Creates a chat history with a maximum past history using a circular buffer
 * @param maxPastMessages
 * @param savedHistory Saved history, if any.. ordered by oldest message first
 * @returns
 */
export function createChatHistory(
    maxPastMessages: number,
    savedHistory?: Iterable<PromptSection> | undefined,
): ChatHistory {
    const history = new CircularArray<PromptSection>(maxPastMessages);
    if (savedHistory) {
        for (const entry of history) {
            history.push(entry);
        }
    }
    return history;
}

/**
 * Given chat history, select messages that could go into context
 * @param history Chat history
 * @param maxContextLength max number of characters available for history
 * @param maxWindowLength maximum size of the chat context window...
 */
export function* getContextFromHistory(
    history: PromptSection[] | ChatHistory,
    maxContextLength: number,
    maxWindowLength: number = Number.MAX_VALUE,
): IterableIterator<PromptSection> {
    let totalLength = 0;
    let sectionCount = 0;
    let i: number = history.length - 1;
    // Get the range of sections that could be pushed on, NEWEST first
    while (i >= 0) {
        const nextLength = getEntry(history, i).content.length;
        if (
            nextLength + totalLength > maxContextLength ||
            sectionCount >= maxWindowLength
        ) {
            ++i;
            break;
        }
        totalLength += nextLength;
        ++sectionCount;
        --i;
    }
    if (i < 0) {
        i = 0;
    }
    // Now that we know the range of messages that could be in context.
    // We yield them oldest first, since the model wants to see them in order
    for (; i < history.length; ++i) {
        yield getEntry(history, i);
    }

    function getEntry(
        history: PromptSection[] | ChatHistory,
        index: number,
    ): PromptSection {
        return Array.isArray(history) ? history[index] : history.get(index);
    }
}
