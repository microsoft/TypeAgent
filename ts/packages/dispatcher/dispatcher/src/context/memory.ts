// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "@typeagent/knowledge-processor";
import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "@typeagent/conversation-memory";

import {
    changeContextConfig,
    type CommandHandlerContext,
} from "./commandHandlerContext.js";
import type {
    ActionContext,
    ActionResult,
    ActionResultActivityContext,
    AppAction,
    Entity,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { ExecutableAction, getFullActionName } from "@typeagent/agent-cache";
import { CachedImageWithDetails } from "@typeagent/typechat-utils";
import { getAppAgentName } from "../internal.js";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { getToggleHandlerTable } from "../helpers/command.js";
import registerDebug from "debug";
import {
    displayError,
    displayResult,
} from "@typeagent/agent-sdk/helpers/display";
import {
    createStyledOutput,
    writeConversationSearchResult,
    writeKnowledgeSearchResults,
} from "./memoryPrinter.js";
import {
    AnswerResponse,
    ConversationSearchResult,
    SearchSelectExpr,
} from "@typeagent/knowpro";
import {
    ConversationDurableMemory,
    searchDurableConversationMemory,
} from "./conversationDurableMemory.js";
import path from "node:path";

const debug = registerDebug("typeagent:dispatcher:memory");

export async function initializeMemory(
    context: CommandHandlerContext,
    sessionDirPath: string | undefined,
) {
    context.conversationDurableMemory = undefined;
    if (sessionDirPath === undefined) {
        context.conversationManager = undefined;
        context.conversationMemory = undefined;
        return;
    }
    context.conversationManager = await conversation.createConversationManager(
        {},
        "conversation",
        sessionDirPath,
        false,
    );
    context.conversationMemory = await createConversationMemory(
        {
            dirPath: sessionDirPath,
            baseFileName: "conversationMemory",
        },
        false,
    );
    if (context.durableMemoryService !== undefined) {
        context.conversationDurableMemory = new ConversationDurableMemory({
            service: context.durableMemoryService,
            conversationId:
                context.conversationId ?? path.basename(sessionDirPath),
            runId: context.activationId,
        });
    }
}

function toConcreteEntity(
    appAgentName: string,
    entities: Entity[],
): conversation.ConcreteEntity[] {
    return entities.map((e) => {
        const concreteEntity: conversation.ConcreteEntity = {
            name: e.name,
            type: e.type,
        };
        if (e.uniqueId) {
            concreteEntity.facets = [
                {
                    name: `typeagent.appAgentName`,
                    value: appAgentName,
                },
                {
                    name: `typeagent.uniqueId`,
                    value: e.uniqueId,
                },
            ];
        }
        return concreteEntity;
    });
}

// Record the user's own turn in the in-session transcript (chat history).
// Kept separate from knowledge extraction so the transcript stays complete
// even when extraction is disabled (e.g. connected/agent-server mode).
export function addUserMessageToHistory(
    context: CommandHandlerContext,
    request: string,
    cachedAttachments?: CachedImageWithDetails[],
): void {
    context.chatHistory.addUserEntry(request, cachedAttachments);
    // Mirror the user turn into the host's cross-conversation content index.
    // Fires regardless of the knowledge-extraction flags (which connected mode
    // disables), so the unified index still populates there. The request id
    // keys the turn so a later history backfill won't index it a second time.
    context.conversationContentSink?.(
        request,
        "user",
        context.currentRequestId?.requestId,
    );
    const turnId = context.currentRequestId?.requestId;
    if (turnId !== undefined) {
        context.conversationDurableMemory?.recordUserTurn(request, turnId);
    }
}

// Queue the user's turn for knowledge extraction into conversation memory.
export function addRequestToMemory(
    context: CommandHandlerContext,
    request: string,
): void {
    if (context.conversationManager) {
        context.conversationManager.queueAddMessage({
            text: request,
            timestamp: new Date(),
        });
    }
    if (context.conversationMemory) {
        context.conversationMemory.queueAddMessage(
            new ConversationMessage(
                request,
                new ConversationMessageMeta("user", ["assistant"]),
            ),
        );
    }
}

export function addResultToMemory(
    context: CommandHandlerContext,
    message: string,
    schemaName: string,
    entities?: Entity[],
    additionalInstructions?: string[],
    activityContext?: ActionResultActivityContext,
    action?: AppAction,
) {
    context.chatHistory.addAssistantEntry(
        message,
        schemaName,
        entities,
        additionalInstructions,
        activityContext,
        action,
    );

    // Mirror the assistant turn into the host's cross-conversation content
    // index (ungated by knowledge extraction, like the user turn).
    context.conversationContentSink?.(
        message,
        "assistant",
        context.currentRequestId?.requestId,
    );
    const turnId = context.currentRequestId?.requestId;
    if (turnId !== undefined) {
        context.conversationDurableMemory?.recordAssistantEvidence(
            message,
            turnId,
            action === undefined
                ? undefined
                : `${getAppAgentName(schemaName)}.${action.actionName}`,
        );
    }

    if (context.actionResultKnowledgeExtraction) {
        if (context.conversationManager && entities) {
            const newEntities = entities.filter(
                (e) => !conversation.isMemorizedEntity(e.type),
            );
            if (newEntities.length > 0) {
                context.conversationManager.queueAddMessage(
                    {
                        text: message,
                        // knowledge-processor might modify the entities. clone it so it doesn't impact other usage.
                        knowledge: structuredClone(
                            newEntities,
                        ) as conversation.ConcreteEntity[],
                        timestamp: new Date(),
                    },
                    false,
                );
            }
        }

        if (context.conversationMemory) {
            const concreteEntity = entities
                ? toConcreteEntity(getAppAgentName(schemaName), entities)
                : undefined;
            context.conversationMemory.queueAddMessage(
                new ConversationMessage(
                    message,
                    new ConversationMessageMeta("assistant", ["user"]),
                    undefined,
                    concreteEntity
                        ? {
                              entities: concreteEntity,
                              actions: [],
                              inverseActions: [],
                              topics: [],
                          }
                        : undefined,
                ),
            );
        }
    }
}

export function addActionResultToMemory(
    context: CommandHandlerContext,
    executableAction: ExecutableAction,
    resolvedEntities: Entity[] | undefined,
    schemaName: string,
    result: ActionResult,
): void {
    const turnId = context.currentRequestId?.requestId;
    const actionName = getFullActionName(executableAction);
    if (result.error !== undefined) {
        addResultToMemory(
            context,
            `Action ${getFullActionName(executableAction)} failed: ${result.error}`,
            schemaName,
            resolvedEntities,
        );
        if (turnId !== undefined) {
            context.conversationDurableMemory?.recordActionResult(
                result.error,
                turnId,
                actionName,
                false,
            );
        }
    } else {
        const combinedEntities = resolvedEntities ? [...resolvedEntities] : [];
        combinedEntities.push(...result.entities);
        if (result.resultEntity) {
            combinedEntities.push(result.resultEntity);
        }

        addResultToMemory(
            context,
            result.historyText
                ? result.historyText
                : `Action ${getFullActionName(executableAction)} completed.`,
            schemaName,
            combinedEntities,
            result.additionalInstructions,
            result.activityContext,
            executableAction.action,
        );
        if (turnId !== undefined) {
            const outcome =
                result.historyText ??
                `Action ${actionName} completed successfully.`;
            context.conversationDurableMemory?.recordActionResult(
                outcome,
                turnId,
                actionName,
                true,
            );
        }
    }
}

export async function lookupAndAnswerFromMemory(
    context: ActionContext<CommandHandlerContext>,
    question: string,
): Promise<{ historyText: string[]; answered: boolean }> {
    const systemContext = context.sessionContext.agentContext;
    const durableAnswer = await searchDurableConversationMemory(
        systemContext,
        question,
        "current",
    );
    if (durableAnswer !== undefined) {
        const text = durableAnswer;
        displayResult(text, context);
        return { historyText: [text], answered: true };
    }

    const conversationMemory = systemContext.conversationMemory;
    if (
        conversationMemory === undefined &&
        systemContext.conversationDurableMemory !== undefined
    ) {
        const crossConversationEvidence = await searchDurableConversationMemory(
            systemContext,
            question,
            "all",
        );
        if (crossConversationEvidence !== undefined) {
            const text = crossConversationEvidence;
            displayResult(text, context);
            return { historyText: [text], answered: true };
        }
    }
    if (conversationMemory === undefined) {
        throw new Error("Conversation memory is undefined!");
    }

    const result = await conversationMemory.getAnswerFromLanguage(question);
    if (!result.success) {
        throw new Error(`Conversation memory search failed: ${result.message}`);
    }

    const historyText: string[] = [];
    let answered = false;
    for (const [searchResult, answer] of result.data) {
        debug("Conversation memory search result:", searchResult);
        if (answer.type === "Answered") {
            answered = true;
            historyText.push(answer.answer!);
            displayResult(answer.answer!, context);
        } else {
            historyText.push(answer.whyNoAnswer!);
            // Don't display error here; caller decides whether to show error or fall back to reasoning
        }
    }

    // The current conversation had no answer. Fall back to the unified
    // cross-conversation content index (host-injected in connected mode) so a
    // question whose answer lives in another conversation still gets one.
    if (!answered) {
        const durableFallback = await searchDurableConversationMemory(
            systemContext,
            question,
            "all",
        );
        if (durableFallback !== undefined) {
            historyText.length = 0;
            historyText.push(durableFallback);
            displayResult(durableFallback, context);
            answered = true;
        }
    }
    if (!answered) {
        const fallback = await lookupAnswerFromOtherConversations(
            systemContext,
            question,
            context,
        );
        if (fallback !== undefined) {
            // Replace the per-conversation "no answer" reasons with the
            // cross-conversation result so the caller reports the answer, not
            // the current-conversation miss.
            historyText.length = 0;
            historyText.push(fallback);
            answered = true;
        }
    }
    // TODO: how about entities?
    return { historyText, answered };
}

// Search every conversation's content (the unified index) for the question and
// render the best-matching conversations and their snippets as a single answer.
// Returns undefined when the host has no unified index or nothing matched, so
// the caller can fall through to its normal not-answered handling.
async function lookupAnswerFromOtherConversations(
    systemContext: CommandHandlerContext,
    question: string,
    context: ActionContext<CommandHandlerContext>,
): Promise<string | undefined> {
    const search = systemContext.searchConversations;
    if (search === undefined) {
        return undefined;
    }
    const matches = await search({ question }, 3);
    if (matches.length === 0) {
        return undefined;
    }
    const lines: string[] = [
        "I didn't find that in the current conversation, but found related content in other conversations:",
    ];
    for (const match of matches) {
        lines.push("");
        lines.push(`**${match.name}**`);
        for (const snippet of match.snippets) {
            lines.push(`- ${snippet}`);
        }
    }
    const text = lines.join("\n");
    displayResult(text, context);
    return text;
}

function ensureMemory(context: ActionContext<CommandHandlerContext>) {
    const systemContext = context.sessionContext.agentContext;
    if (systemContext.session.getConfig().execution.memory.legacy) {
        throw new Error("Legacy memory is enabled. Command not supported.");
    }

    const memory = systemContext.conversationMemory;
    if (memory === undefined) {
        throw new Error("Conversation memory is not initialized.");
    }
    return memory;
}

class MemorySearchCommandHandler implements CommandHandler {
    public readonly description = "Search conversation memory";
    public readonly parameters = {
        args: {
            terms: {
                description: "Terms to search in conversation memory",
                multiple: true,
            },
        },
        flags: {
            asc: {
                description: "Sort results in ascending order",
                default: true,
            },
            message: {
                description: "Display message",
                default: true,
            },
            knowledge: {
                description: "Display knowledge",
                default: true,
            },
            count: {
                description: "Display count of results",
                default: 25,
            },
            distinct: {
                description: "Display distinct results",
                default: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { args, flags } = params;
        const memory = ensureMemory(context);

        const selectExpr: SearchSelectExpr = {
            searchTermGroup: {
                booleanOp: "and",
                terms: args.terms.map((term) => ({
                    term: {
                        text: term,
                    },
                })),
            },
        };
        if (flags.message) {
            const searchResult = await memory.search(selectExpr);
            if (searchResult === undefined) {
                throw new Error(
                    `No knowledge found for terms: ${args.terms.join(", ")}`,
                );
            }

            const out = createStyledOutput(
                context.actionIO.appendDisplay.bind(context.actionIO),
            );

            writeConversationSearchResult(
                out,
                memory,
                searchResult,
                flags.knowledge,
                flags.message,
                {
                    maxToDisplay: flags.count,
                    sortAsc: flags.asc,
                    distinct: flags.distinct,
                },
            );
        } else {
            const searchResult = await memory.searchKnowledge(selectExpr);

            if (searchResult === undefined) {
                throw new Error(
                    `No knowledge found for terms: ${args.terms.join(", ")}`,
                );
            }

            const out = createStyledOutput(
                context.actionIO.appendDisplay.bind(context.actionIO),
            );

            writeKnowledgeSearchResults(out, memory, searchResult, {
                maxToDisplay: flags.count,
                sortAsc: flags.asc,
                distinct: flags.distinct,
            });
        }
    }
}

class MemoryAnswerCommandHandler implements CommandHandler {
    public readonly description = "Answer a question using conversation memory";
    public readonly parameters = {
        args: {
            question: {
                description: "Question to ask the conversation memory",
                implicitQuotes: true,
            },
        },
        flags: {
            asc: {
                description: "Sort results in ascending order",
                default: true,
            },
            message: {
                description: "Display message",
                default: false,
            },
            knowledge: {
                description: "Display knowledge",
                default: false,
            },
            count: {
                description: "Display count of results",
                default: 25,
            },
            distinct: {
                description: "Display distinct results",
                default: false,
            },
        },
    } as const;
    constructor(private search: boolean) {}

    private async getResult(
        memory: ConversationMemory,
        question: string,
    ): Promise<[ConversationSearchResult, AnswerResponse | undefined][]> {
        if (this.search) {
            const result = await memory.searchWithLanguage(question);
            if (!result.success) {
                throw new Error(
                    `Conversation memory search failed: ${result.message}`,
                );
            }
            return result.data.map((searchResult) => [searchResult, undefined]);
        } else {
            const result = await memory.getAnswerFromLanguage(question);
            if (!result.success) {
                throw new Error(
                    `Conversation memory search failed: ${result.message}`,
                );
            }
            return result.data;
        }
    }
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { args, flags } = params;
        const memory = ensureMemory(context);

        const result = await this.getResult(memory, args.question);

        for (const [searchResult, answer] of result) {
            if (searchResult.rawSearchQuery) {
                displayResult(
                    `Raw search query: ${searchResult.rawSearchQuery}`,
                    context,
                );
            }

            const out = createStyledOutput(
                context.actionIO.appendDisplay.bind(context.actionIO),
            );

            writeConversationSearchResult(
                out,
                memory,
                searchResult,
                flags.knowledge,
                flags.message,
                {
                    maxToDisplay: flags.count,
                    sortAsc: flags.asc,
                    distinct: flags.distinct,
                },
            );

            if (answer !== undefined) {
                if (answer.type === "Answered") {
                    displayResult(`Answer: ${answer.answer!}`, context);
                } else {
                    displayError(`No answer: ${answer.whyNoAnswer!}`, context);
                }
            }
        }
    }
}

class DurableInspectTurnCommandHandler implements CommandHandler {
    public readonly description =
        "Inspect durable conversation evidence for one turn";
    public readonly parameters = {
        args: {
            turnId: { description: "Turn identifier" },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const memory = requireDurableMemory(context);
        displayResult(
            JSON.stringify(
                await memory.inspectTurn(params.args.turnId),
                undefined,
                2,
            ),
            context,
        );
    }
}

class DurableInspectConversationCommandHandler implements CommandHandler {
    public readonly description = "Inspect durable conversation evidence";
    public readonly parameters = {
        args: {
            conversationId: {
                description: "Conversation identifier (current when omitted)",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const memory = requireDurableMemory(context);
        displayResult(
            JSON.stringify(
                await memory.inspectConversation(params.args.conversationId),
                undefined,
                2,
            ),
            context,
        );
    }
}

class DurableForgetTurnCommandHandler implements CommandHandler {
    public readonly description = "Forget durable evidence for one turn";
    public readonly parameters = {
        args: {
            turnId: { description: "Turn identifier" },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const memory = requireDurableMemory(context);
        displayResult(
            JSON.stringify(await memory.forgetTurn(params.args.turnId)),
            context,
        );
    }
}

class DurableForgetConversationCommandHandler implements CommandHandler {
    public readonly description = "Forget durable evidence for a conversation";
    public readonly parameters = {
        args: {
            conversationId: {
                description: "Conversation identifier (current when omitted)",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const memory = requireDurableMemory(context);
        displayResult(
            JSON.stringify(
                await memory.forgetConversation(params.args.conversationId),
            ),
            context,
        );
    }
}

function requireDurableMemory(
    context: ActionContext<CommandHandlerContext>,
): ConversationDurableMemory {
    const memory =
        context.sessionContext.agentContext.conversationDurableMemory;
    if (memory === undefined) {
        throw new Error("Durable conversation memory is not available.");
    }
    return memory;
}

export function getMemoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "Legacy per-conversation memory commands",
        commands: {
            legacy: getToggleHandlerTable("legacy", async (context, enable) => {
                await changeContextConfig(
                    {
                        execution: {
                            memory: {
                                legacy: enable,
                            },
                        },
                    },
                    context,
                );
            }),

            query: new MemorySearchCommandHandler(),
            search: new MemoryAnswerCommandHandler(true),
            answer: new MemoryAnswerCommandHandler(false),
            "inspect-turn": new DurableInspectTurnCommandHandler(),
            "inspect-conversation":
                new DurableInspectConversationCommandHandler(),
            "forget-turn": new DurableForgetTurnCommandHandler(),
            "forget-conversation":
                new DurableForgetConversationCommandHandler(),
        },
    };
}
