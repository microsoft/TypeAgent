// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResultActivityContext,
    AppAction,
    Entity,
} from "@typeagent/agent-sdk";
import {
    CachedImageWithDetails,
    extractRelevantExifTags,
} from "@typeagent/typechat-utils";
import { PromptSection } from "typechat";
import { normalizeParamString, PromptEntity } from "agent-cache";
import { SchemaCreator as sc, validateType } from "@typeagent/action-schema";
import { getAppAgentName } from "../internal.js";

type UserEntry = {
    role: "user";
    text: string;
    attachments?: CachedImageWithDetails[] | undefined;
};

type AssistantEntry = {
    role: "assistant";
    text: string;
    sourceSchemaName: string;
    entities?: Entity[] | undefined;
    additionalInstructions?: string[] | undefined;
    activityContext?: ActionResultActivityContext | undefined;
    // The action that was executed to produce this result, if any. Rendered
    // into the translation prompt (behind promptConfig.recentActions) so the
    // model can see that the request was already carried out.
    action?: AppAction | undefined;
};

type ChatHistoryEntry = UserEntry | AssistantEntry;

export type ChatHistoryInputAssistant = {
    text: string;
    source: string;
    entities?: Entity[];
    additionalInstructions?: string[];
    activityContext?: ActionResultActivityContext;
    action?: AppAction;
};

export type ChatHistoryInputEntry = {
    user: string;
    assistant: ChatHistoryInputAssistant | ChatHistoryInputAssistant[];
};

function convertAssistantMessage(
    entries: ChatHistoryEntry[],
    message: ChatHistoryInputAssistant,
) {
    entries.push({
        role: "assistant",
        text: message.text,
        sourceSchemaName: message.source,
        entities: message.entities,
        additionalInstructions: message.additionalInstructions,
        activityContext: message.activityContext,
        action: message.action,
    });
}

function convertChatHistoryInputEntry(
    entries: ChatHistoryEntry[],
    message: ChatHistoryInputEntry,
) {
    entries.push({
        role: "user",
        text: message.user,
    });
    const assistant = message.assistant;
    if (Array.isArray(assistant)) {
        assistant.forEach((m) => convertAssistantMessage(entries, m));
    } else {
        convertAssistantMessage(entries, assistant);
    }
}

function convertChatHistoryInput(
    message: ChatHistoryInput,
): ChatHistoryEntry[] {
    const entries: ChatHistoryEntry[] = [];
    if (Array.isArray(message)) {
        message.forEach((m) => convertChatHistoryInputEntry(entries, m));
    } else {
        convertChatHistoryInputEntry(entries, message);
    }
    return entries;
}

export interface ChatHistory {
    // entries: ChatHistoryEntry[];
    enable(value: boolean): void;
    getTopKEntities(k: number): PromptEntity[];
    addUserEntry(text: string, attachments?: CachedImageWithDetails[]): void;
    addAssistantEntry(
        text: string,
        sourceSchemaName: string,
        entities?: Entity[],
        additionalInstructions?: string[],
        activityContext?: ActionResultActivityContext,
        action?: AppAction,
    ): void;
    getCurrentInstructions(): string[] | undefined;
    // The action(s) executed for the assistant turns within the recent chat
    // history window (the same turns shown via getPromptSections), oldest
    // first, capped to the most recent `limit`. Lets the model see which
    // requests were already carried out so it doesn't re-issue them.
    getRecentActions(limit: number): AppAction[] | undefined;
    getPromptSections(): PromptSection[];
    getLastActivityContextInfo():
        | {
              resultActivityContext: ActionResultActivityContext;
              sourceSchemaName: string;
          }
        | undefined;
    count(): number;
    delete(index: number): void;
    deleteEntityById(entityId: string): boolean;
    clear(): void;
    getStrings(): string[];
    // Recent entries (both roles) for building reasoning context. Unlike
    // export(), this includes assistant entries even when no user entry
    // precedes them — in connected (agent-server) mode the user's turns are
    // not recorded in chat history, so export() would drop everything.
    getRecentEntries(
        maxCount: number,
    ): { role: "user" | "assistant"; text: string; source?: string }[];
    // A page of the transcript for tools that read/page the conversation:
    // entries by absolute index [offset, offset+limit) in chronological order.
    // Total count is count().
    getEntries(
        offset: number,
        limit: number,
    ): {
        index: number;
        role: "user" | "assistant";
        text: string;
        source?: string;
    }[];
    export(): ChatHistoryInputEntry | ChatHistoryInputEntry[] | undefined;
    import(input: ChatHistoryInputEntry | ChatHistoryInputEntry[]): void;
}

export function createChatHistory(init: boolean): ChatHistory {
    let enabled = init;
    const entries: ChatHistoryEntry[] = [];
    // Index of the oldest entry whose trailing run fits within maxChars of
    // text. Shared by getPromptSections and getRecentActions so the executed-
    // action list covers exactly the turns shown as recent chat history.
    const recentStartIndex = (maxChars: number): number => {
        let totalLength = 0;
        let i = entries.length - 1;
        while (i >= 0) {
            const nextLength = entries[i].text.length;
            if (nextLength + totalLength > maxChars) {
                ++i;
                break;
            }
            totalLength += nextLength;
            --i;
        }
        return i < 0 ? 0 : i;
    };
    return {
        enable(value: boolean) {
            enabled = value;
        },
        getPromptSections(maxChars = 2000) {
            const sections: PromptSection[] = [];
            // Find the last N entries that fit the character quota.
            for (let i = recentStartIndex(maxChars); i < entries.length; ++i) {
                const entry = entries[i];

                if (entry.text.length > 0) {
                    sections.push({ role: entry.role, content: entry.text });
                }

                if (
                    entry.role === "user" &&
                    entry.attachments &&
                    entry.attachments.length > 0
                ) {
                    for (const attachment of entry.attachments) {
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "text",
                                    text: attachment.storageLocation,
                                },
                            ],
                        });
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "text",
                                    text: `EXIF Tags: ${extractRelevantExifTags(attachment.exifTags)}`,
                                },
                            ],
                        });
                        sections.push({
                            role: entry.role,
                            content: [
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: attachment.image,
                                        detail: "high",
                                    },
                                },
                            ],
                        });
                    }
                }
            }
            return sections;
        },
        getCurrentInstructions(): string[] | undefined {
            const instructions: string[] = [];
            if (entries.length === 0) {
                return undefined;
            }
            let i = entries.length - 1;
            if (entries[i].role === "user") {
                i--;
            }
            while (i >= 0) {
                const entry = entries[i];
                if (entry.role === "user") {
                    break;
                }
                if (entry.additionalInstructions) {
                    instructions.push(...entry.additionalInstructions);
                }
                i--;
            }
            return instructions.length > 0 ? instructions : undefined;
        },
        getRecentActions(
            limit: number,
            maxChars = 2000,
        ): AppAction[] | undefined {
            // Executed action(s) for the assistant turns within the same recent
            // window shown as chat history, oldest first, so the model can see
            // which requests were already carried out and not re-issue them.
            // Capped to the most recent `limit` actions.
            if (limit <= 0) {
                return undefined;
            }
            const actions: AppAction[] = [];
            for (let i = recentStartIndex(maxChars); i < entries.length; ++i) {
                const entry = entries[i];
                if (entry.role === "assistant" && entry.action) {
                    actions.push(entry.action);
                }
            }
            if (actions.length === 0) {
                return undefined;
            }
            return actions.length > limit
                ? actions.slice(actions.length - limit)
                : actions;
        },
        getLastActivityContextInfo() {
            if (entries.length === 0) {
                return undefined;
            }
            const last = entries[entries.length - 1];
            return last.role === "assistant" &&
                last.activityContext !== undefined
                ? {
                      sourceSchemaName: last.sourceSchemaName,
                      resultActivityContext: last.activityContext,
                  }
                : undefined;
        },
        addUserEntry(
            text: string,
            attachments?: CachedImageWithDetails[],
        ): void {
            if (enabled) {
                entries.push({
                    role: "user",
                    text,
                    attachments,
                });
            }
        },
        addAssistantEntry(
            text: string,
            sourceSchemaName: string,
            entities?: Entity[],
            additionalInstructions?: string[],
            activityContext?: ActionResultActivityContext,
            action?: AppAction,
        ): void {
            if (enabled) {
                entries.push({
                    role: "assistant",
                    text,
                    sourceSchemaName,
                    entities: structuredClone(entities), // make a copy so that it doesn't get modified by others later.
                    additionalInstructions,
                    activityContext: structuredClone(activityContext),
                    action: structuredClone(action),
                });
            }
        },
        getTopKEntities(k: number): PromptEntity[] {
            const uniqueEntities = new Map<string, PromptEntity[]>();
            let found = 0;
            const result: PromptEntity[][] = [];
            // loop over entries from last to first
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (entry.role === "user" || entry.entities === undefined) {
                    continue;
                }
                const appAgentName = getAppAgentName(entry.sourceSchemaName);
                const promptEntities: PromptEntity[] = [];
                for (const entity of entry.entities) {
                    // Multiple entities may have the same name ('Design meeting') but different
                    // entity instances. E.g. {Design meeting, on 9/12} vs {Design meeting, on 9/19}

                    // LLM like to correct/change casing.  Normalize for look up.
                    const normalizedName = normalizeParamString(entity.name);
                    const uniqueIndex = `${normalizedName}.${entity.type}`;
                    const existing = uniqueEntities.get(uniqueIndex);
                    const promptEntity: PromptEntity = {
                        ...entity,
                        sourceAppAgentName: appAgentName,
                    };
                    if (existing) {
                        if (
                            existing.some(
                                (e) =>
                                    e.sourceAppAgentName === appAgentName &&
                                    e.uniqueId === entity.uniqueId,
                            )
                        ) {
                            // Duplicate
                            continue;
                        }

                        existing.push(promptEntity);
                    } else {
                        uniqueEntities.set(uniqueIndex, [promptEntity]);
                    }
                    promptEntities.push(promptEntity);
                    found++;
                    // Continue to finish all the entity for this entry even when we have enough
                }
                result.unshift(promptEntities);
                // Stop if we have more then enough
                if (found >= k) {
                    break;
                }
            }
            return result.flat();
        },
        count(): number {
            return entries.length;
        },
        delete(index: number): void {
            if (index < 0 || index >= entries.length) {
                throw new Error(
                    `The supplied index (${index}) is outside the range of available indices (0, ${entries.length})`,
                );
            }
            if (isNaN(index)) {
                throw new Error(
                    `The supplied value '${index}' is not a valid index.`,
                );
            }

            entries.splice(index, 1);
        },
        deleteEntityById(entityId: string): boolean {
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i];
                if (entry.role === "user" || entry.entities === undefined) {
                    continue;
                }
                for (const entity of entry.entities) {
                    if (entity.uniqueId === entityId) {
                        entry.entities.unshift(entity);
                        return true;
                    }
                }
            }

            return false;
        },
        clear(): void {
            entries.length = 0;
        },
        getStrings(): string[] {
            return entries.map(
                (entry, index) =>
                    `${index}: ${JSON.stringify(entry, undefined, 2)}`,
            );
        },
        getRecentEntries(maxCount: number): {
            role: "user" | "assistant";
            text: string;
            source?: string;
        }[] {
            // Collect the last `maxCount` non-empty entries newest-first, then
            // reverse to chronological order. Includes assistant entries even
            // when no user entry precedes them (connected/agent-server mode).
            const result: {
                role: "user" | "assistant";
                text: string;
                source?: string;
            }[] = [];
            for (
                let i = entries.length - 1;
                i >= 0 && result.length < maxCount;
                i--
            ) {
                const entry = entries[i];
                if (entry.text.length === 0) {
                    continue;
                }
                result.push(
                    entry.role === "assistant"
                        ? {
                              role: "assistant",
                              text: entry.text,
                              source: entry.sourceSchemaName,
                          }
                        : { role: "user", text: entry.text },
                );
            }
            return result.reverse();
        },
        getEntries(
            offset: number,
            limit: number,
        ): {
            index: number;
            role: "user" | "assistant";
            text: string;
            source?: string;
        }[] {
            const start = Math.max(0, Math.floor(offset));
            const end = Math.min(
                entries.length,
                start + Math.max(0, Math.floor(limit)),
            );
            const result: {
                index: number;
                role: "user" | "assistant";
                text: string;
                source?: string;
            }[] = [];
            for (let i = start; i < end; i++) {
                const entry = entries[i];
                result.push(
                    entry.role === "assistant"
                        ? {
                              index: i,
                              role: "assistant",
                              text: entry.text,
                              source: entry.sourceSchemaName,
                          }
                        : { index: i, role: "user", text: entry.text },
                );
            }
            return result;
        },
        export(): ChatHistoryInputEntry | ChatHistoryInputEntry[] | undefined {
            const input: ChatHistoryInputEntry[] = [];
            let currInput: ChatHistoryInputEntry | undefined = undefined;
            for (const entry of entries) {
                if (entry.role === "user") {
                    if (currInput !== undefined) {
                        input.push(currInput);
                    }
                    currInput = {
                        user: entry.text,
                        assistant: [],
                    };
                } else if (currInput !== undefined) {
                    const assistantEntry: ChatHistoryInputAssistant = {
                        text: entry.text,
                        source: entry.sourceSchemaName,
                    };
                    if (entry.entities) {
                        assistantEntry.entities = structuredClone(
                            entry.entities,
                        );
                    }
                    if (entry.additionalInstructions) {
                        assistantEntry.additionalInstructions =
                            entry.additionalInstructions;
                    }
                    if (entry.activityContext) {
                        assistantEntry.activityContext = entry.activityContext;
                    }
                    if (entry.action) {
                        assistantEntry.action = structuredClone(entry.action);
                    }
                    (currInput.assistant as any).push(assistantEntry);
                }
            }
            if (input.length === 0) {
                return currInput;
            }
            if (currInput !== undefined) {
                input.push(currInput);
            }
            return input.length === 1 ? input[0] : input;
        },
        import(input: ChatHistoryInput): void {
            entries.push(...convertChatHistoryInput(input));
        },
    };
}

const assistantInputSchema = sc.obj({
    text: sc.string(),
    source: sc.string(),
    entities: sc.optional(
        sc.array(
            sc.obj({
                name: sc.string(),
                type: sc.array(sc.string()),
                uniqueId: sc.optional(sc.string()),
                sourceAppAgentName: sc.optional(sc.string()),
                facets: sc.optional(
                    sc.array(
                        sc.obj({
                            name: sc.string(),
                            value: sc.any(),
                        }),
                    ),
                ),
            }),
        ),
    ),
    additionalInstructions: sc.optional(sc.array(sc.string())),
    activityContext: sc.optional(
        sc.obj({
            activityName: sc.string(),
            description: sc.string(),
            openLocalView: sc.optional(sc.boolean()),
            state: sc.optional(sc.any()),
            activityEndAction: sc.optional(sc.any()),
        }),
    ),
    action: sc.optional(
        sc.obj({
            actionName: sc.string(),
            schemaName: sc.optional(sc.string()),
            parameters: sc.optional(sc.any()),
        }),
    ),
});

const messageInputSchema = sc.obj({
    user: sc.string(),
    assistant: sc.union(assistantInputSchema, sc.array(assistantInputSchema)),
});

const chatHistoryInputSchema = sc.union(
    messageInputSchema,
    sc.array(messageInputSchema),
);

export type ChatHistoryInput = ChatHistoryInputEntry | ChatHistoryInputEntry[];
export function isChatHistoryInput(data: any): data is ChatHistoryInput {
    try {
        validateType(chatHistoryInputSchema, data);
        return true;
    } catch {
        return false;
    }
}
