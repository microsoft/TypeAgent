// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    StopWatch,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import { conversation as kpLib } from "knowledge-processor";
import * as kpTest from "knowpro-test";
import * as kp from "knowpro";
import chalk from "chalk";

export type LLMKnowledgeExtractor = {
    extractor: kpLib.KnowledgeExtractor;
    model: kpTest.LanguageModel;
};

export type KnowProKnowledgeContext = {
    printer: KnowProPrinter;
    extractor?: LLMKnowledgeExtractor | undefined;
    extractor35?: LLMKnowledgeExtractor | undefined;
    extractor41?: LLMKnowledgeExtractor | undefined;
    extractor41Mini?: LLMKnowledgeExtractor | undefined;

    compiler: KnowledgeCompiler;
};

export async function createKnowproKnowledgeCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowProKnowledgeContext = {
        printer: kpContext.printer,
        compiler: new KnowledgeCompiler(),
    };
    createExtractors();

    commands.kpKnowledgeExtract = extractKnowledge;

    function extractKnowledgeDef(): CommandMetadata {
        return {
            description: "Extract knowledge",
            options: {
                text: arg("From this text"),
                model: arg("Model: 4o | 41 | 41m | 35", "4o"),
                search: argBool("Run knowledge search", false),
            },
        };
    }
    commands.kpKnowledgeExtract.metadata = extractKnowledgeDef();
    async function extractKnowledge(args: string[]) {
        const namedArgs = parseNamedArguments(args, extractKnowledgeDef());
        if (!namedArgs.text) {
            return;
        }
        const llmExtractor = getExtractor(namedArgs);
        if (!llmExtractor) {
            context.printer.writeError(
                "Knowledge extractor not available for model",
            );
            return;
        }
        context.printer.writeLineInColor(
            chalk.cyan,
            `Using ${llmExtractor.model.modelName}`,
        );
        const stopWatch = new StopWatch();
        stopWatch.start();
        const knowledge = await llmExtractor.extractor.extract(namedArgs.text);
        stopWatch.stop();
        context.printer.writeTiming(
            chalk.cyan,
            stopWatch,
            llmExtractor.model.modelName,
        );
        if (!knowledge) {
            return;
        }
        context.printer.writeJson(knowledge);
        if (namedArgs.search) {
            const searchExpr = context.compiler.compileKnowledge(knowledge);
            context.printer.writeJsonInColor(chalk.gray, searchExpr);
            if (!kpContext.conversation) {
                context.printer.writeError("No conversation loaded");
                return;
            }
            const searchResults = await kp.searchConversation(
                kpContext.conversation,
                searchExpr.searchTermGroup,
                searchExpr.when,
            );
            context.printer.writeConversationSearchResult(
                kpContext.conversation,
                searchResults,
                true,
                false,
                50,
                true,
            );
        }
    }

    function getExtractor(
        namedArgs: NamedArgs,
    ): LLMKnowledgeExtractor | undefined {
        let extractor = context.extractor;
        switch (namedArgs.model) {
            default:
                break;
            case "4o":
                extractor = context.extractor;
                break;
            case "41":
                extractor = context.extractor41;
                break;
            case "41m":
                extractor = context.extractor41Mini;
                break;
            case "35":
                extractor = context.extractor35;
                break;
        }

        return extractor;
    }

    function createExtractors() {
        context.extractor = {
            extractor: kpLib.createKnowledgeExtractor(kpContext.knowledgeModel),
            model: {
                model: kpContext.knowledgeModel,
                modelName: "4o",
            },
        };
        const models41 = kpTest.createGpt41Models();
        if (models41.gpt41) {
            context.extractor41 = {
                extractor: kpLib.createKnowledgeExtractor(models41.gpt41.model),
                model: models41.gpt41,
            };
        }
        if (models41.gpt41Mini) {
            context.extractor41Mini = {
                extractor: kpLib.createKnowledgeExtractor(
                    models41.gpt41Mini.model,
                ),
                model: models41.gpt41Mini,
            };
        }
        const model35 = kpTest.create35Model();
        if (model35) {
            context.extractor35 = {
                extractor: kpLib.createKnowledgeExtractor(model35.model),
                model: model35,
            };
        }
    }

    return;
}

export class KnowledgeCompiler {
    constructor() {}

    public compileKnowledge(
        knowledge: kpLib.KnowledgeResponse,
    ): kp.SearchSelectExpr {
        const searchTermGroup = kp.createOrTermGroup();
        this.compileEntities(knowledge.entities, searchTermGroup);
        this.compileTopics(knowledge.topics, searchTermGroup);

        return {
            searchTermGroup,
        };
    }

    private compileTopics(
        topics: string[],
        termGroup: kp.SearchTermGroup,
    ): void {
        if (topics.length === 0) {
            return;
        }
        for (const topic of topics) {
            termGroup.terms.push(
                kp.createPropertySearchTerm(kp.PropertyNames.Topic, topic),
            );
        }
    }

    private compileEntities(
        entities: kpLib.ConcreteEntity[],
        termGroup: kp.SearchTermGroup,
    ): void {
        if (entities.length === 0) {
            return;
        }

        for (const entity of entities) {
            let entityGroup = kp.createOrTermGroup();
            this.compileEntity(entity, entityGroup);
            if (entityGroup.terms.length > 0) {
                termGroup.terms.push(entityGroup);
            }
        }
    }

    private compileEntity(
        entity: kpLib.ConcreteEntity,
        termGroup: kp.SearchTermGroup,
    ): void {
        termGroup.terms.push(
            kp.createPropertySearchTerm(
                kp.PropertyNames.EntityName,
                entity.name,
            ),
        );
        termGroup.terms.push(
            kp.createPropertySearchTerm(
                kp.PropertyNames.EntityType,
                entity.name,
            ),
        );
        for (const type of entity.type) {
            if (type.toLowerCase() === "object") {
                continue;
            }
            termGroup.terms.push(
                kp.createPropertySearchTerm(kp.PropertyNames.EntityType, type),
            );
        }
        if (entity.facets) {
            //this.compileFacets(entity.facets, termGroup);
        }
    }
    /*
    private compileFacets(
        facets: kpLib.Facet[],
        termGroup: kp.SearchTermGroup,
    ) {
        if (facets.length === 0) {
            return;
        }
        for (const facet of facets) {
            termGroup.terms.push(
                kp.createPropertySearchTerm(
                    facet.name,
                    this.facetValueToString(facet),
                ),
            );
        }
    }

    private facetValueToString(facet: kpLib.Facet): string {
        const value = facet.value;
        if (typeof value === "object") {
            return `${value.amount} ${value.units}`;
        }
        return value.toString();
    }

    private compileActions(
        actions: kpLib.Action[],
        termGroup: kp.SearchTermGroup,
    ) {
        for (const action of actions) {
            this.compileAction(action, termGroup);
        }
    }

    private compileAction(action: kpLib.Action, termGroup: kp.SearchTermGroup) {
        if (action.subjectEntityName) {
            termGroup.terms.push(
                kp.createPropertySearchTerm(
                    kp.PropertyNames.Subject,
                    action.subjectEntityName,
                ),
            );
        }
        if (action.verbs) {
            for (const verb of action.verbs) {
                termGroup.terms.push(
                    kp.createPropertySearchTerm(kp.PropertyNames.Verb, verb),
                );
            }
        }
        if (action.objectEntityName) {
            termGroup.terms.push(
                kp.createPropertySearchTerm(
                    kp.PropertyNames.Object,
                    action.objectEntityName,
                ),
            );
        }
    }
        */
}
