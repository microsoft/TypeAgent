// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation } from "knowledge-processor";
import {
    ConversationMemory,
    ConversationMessage,
    ConversationMessageMeta,
    createConversationMemory,
} from "conversation-memory";

import {
    changeContextConfig,
    type CommandHandlerContext,
} from "./commandHandlerContext.js";
import type {
    ActionContext,
    ActionResult,
    ActionResultActivityContext,
    Entity,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import { ExecutableAction, getFullActionName } from "agent-cache";
import { CachedImageWithDetails } from "common-utils";
import { getAppAgentName } from "../internal.js";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { getToggleHandlerTable } from "../command/handlerUtils.js";
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
} from "knowpro";

const debug = registerDebug("typeagent:dispatcher:memory");

export async function initializeMemory(
    context: CommandHandlerContext,
    sessionDirPath: string | undefined,
) {
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
                    name: `agent:${appAgentName}.uniqueId`,
                    value: e.uniqueId,
                },
            ];
        }
        return concreteEntity;
    });
}

export function addRequestToMemory(
    context: CommandHandlerContext,
    request: string,
    cachedAttachments?: CachedImageWithDetails[],
): void {
    context.chatHistory.addUserEntry(
        request,
        context.requestId,
        cachedAttachments,
    );

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
) {
    context.chatHistory.addAssistantEntry(
        message,
        context.requestId,
        schemaName,
        entities,
        additionalInstructions,
        activityContext,
    );

    if (context.conversationManager && entities) {
        const newEntities = entities.filter(
            (e) => !conversation.isMemorizedEntity(e.type),
        );
        if (newEntities.length > 0) {
            context.conversationManager.queueAddMessage(
                {
                    text: message,
                    knowledge: newEntities,
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

export function addActionResultToMemory(
    context: CommandHandlerContext,
    executableAction: ExecutableAction,
    resolvedEntities: Entity[] | undefined,
    schemaName: string,
    result: ActionResult,
): void {
    if (result.error !== undefined) {
        addResultToMemory(
            context,
            `Action ${getFullActionName(executableAction)} failed: ${result.error}`,
            schemaName,
            resolvedEntities,
        );
    } else {
        const combinedEntities = resolvedEntities ? [...resolvedEntities] : [];
        combinedEntities.push(...result.entities);
        if (result.resultEntity) {
            combinedEntities.push(result.resultEntity);
        }

        addResultToMemory(
            context,
            result.literalText
                ? result.literalText
                : `Action ${getFullActionName(executableAction)} completed.`,
            schemaName,
            combinedEntities,
            result.additionalInstructions,
            result.activityContext,
        );
    }
}

export async function lookupAndAnswerFromMemory(
    context: ActionContext<CommandHandlerContext>,
    question: string,
): Promise<string[]> {
    const systemContext = context.sessionContext.agentContext;
    const conversationMemory = systemContext.conversationMemory;
    if (conversationMemory === undefined) {
        throw new Error("Conversation memory is undefined!");
    }

    const result = await conversationMemory.getAnswerFromLanguage(question);
    if (!result.success) {
        throw new Error(`Conversation memory search failed: ${result.message}`);
    }

    const literalText: string[] = [];
    for (const [searchResult, answer] of result.data) {
        debug("Conversation memory search result:", searchResult);
        if (answer.type === "Answered") {
            literalText.push(answer.answer!);
            displayResult(answer.answer!, context);
        } else {
            literalText.push(answer.whyNoAnswer!);
            displayError(answer.whyNoAnswer!, context);
        }
    }
    // TODO: how about entities?
    return literalText;
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

export function getMemoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "Memory commands",
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
        },
    };
}
