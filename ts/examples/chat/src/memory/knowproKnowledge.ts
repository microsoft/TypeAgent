// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    ProgressBar,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import { conversation as kpLib } from "knowledge-processor";
import * as kpTest from "knowpro-test";
import * as kp from "knowpro";
import * as cm from "conversation-memory";
import chalk from "chalk";
import { getTextOrFile } from "examples-lib";
import * as fs from "fs";

export type LLMKnowledgeExtractor = {
    extractor: kpLib.KnowledgeExtractor;
    model: kpTest.LanguageModel;
};

export type LLMKnowledgeExtractors = {
    extractor?: LLMKnowledgeExtractor | undefined;
    extractor35?: LLMKnowledgeExtractor | undefined;
    extractor41?: LLMKnowledgeExtractor | undefined;
    extractor41Mini?: LLMKnowledgeExtractor | undefined;
};

export type KnowProKnowledgeContext = {
    printer: KnowProPrinter;
    extractors: LLMKnowledgeExtractors;
    extractors2: LLMKnowledgeExtractors;
    compiler: KnowledgeCompiler;
};

export async function createKnowproKnowledgeCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowProKnowledgeContext = {
        printer: kpContext.printer,
        compiler: new KnowledgeCompiler(),
        extractors: createExtractors(),
        extractors2: createExtractors(true),
    };
    commands.kpKnowledgeExtract = extractKnowledge;
    commands.kpKnowledgeActions = compareInverseActions;

    function extractKnowledgeDef(): CommandMetadata {
        return {
            description: "Extract knowledge",
            options: {
                text: arg("Extract from this text OR from this filePath"),
                model: arg("Model: 4o | 41 | 41m | 35", "4o"),
                v2: argBool("Run version 2", false),
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
        const text = getTextOrFile(namedArgs.text);
        const llmExtractor = getExtractor(namedArgs.model, namedArgs.v2);
        if (!llmExtractor) {
            context.printer.writeError(
                "Knowledge extractor not available for model",
            );
            return;
        }
        context.printer.writeLineInColor(
            chalk.cyan,
            `Using ${llmExtractor.model.modelName}; ${text.length} chars`,
        );
        const [knowledge, _] = await runExtractKnowledge(llmExtractor, text);
        if (!knowledge) {
            return;
        }

        context.printer.writeJson(knowledge);
        if (namedArgs.search) {
            await searchWithKnowledge(knowledge);
        }
    }

    function compareInverseActionsDef(): CommandMetadata {
        return {
            description:
                "Compare inverse actions from v1 and v2 of knowledge extraction",
            options: {
                text: arg("Extract from this text OR from this filePath"),
                model: arg("Model: 4o | 41 | 41m | 35", "4o"),
                type: arg("text | podcast", "text"),
            },
        };
    }
    commands.kpKnowledgeActions.metadata = compareInverseActionsDef();
    async function compareInverseActions(args: string[]) {
        const namedArgs = parseNamedArguments(args, compareInverseActionsDef());
        const textChunks =
            namedArgs.type === "podcast"
                ? getPodcastTextChunks(namedArgs.text)
                : [getTextOrFile(namedArgs.text)];
        const llmExtractor1 = getExtractor(namedArgs.model, false);
        const llmExtractor2 = getExtractor(namedArgs.model, true);
        if (!llmExtractor1 || !llmExtractor2) {
            context.printer.writeError(
                "Knowledge extractor not available for model",
            );
            return;
        }

        let totalTokens1 = 0;
        let totalTokens2 = 0;

        const progressBar = new ProgressBar(context.printer, textChunks.length);
        for (let i = 0; i < textChunks.length; ++i) {
            progressBar.advance();
            context.printer.writeLine();

            let text = textChunks[i];
            context.printer.writeLineInColor(
                chalk.cyan,
                `${text.length} chars`,
            );
            context.printer.writeHeading("V1");
            const [knowledge1, tokenCount1] = await runExtractKnowledge(
                llmExtractor1,
                text,
            );
            if (!knowledge1) {
                context.printer.writeError("No knowledge");
                continue;
            }
            context.printer.writeJsonInColor(chalk.gray, knowledge1.actions);
            context.printer.writeJson(knowledge1.inverseActions);

            context.printer.writeHeading("V2");
            const [knowledge2, tokenCount2] = await runExtractKnowledge(
                llmExtractor2,
                text,
            );
            if (!knowledge2) {
                context.printer.writeError("No knowledge");
                continue;
            }
            context.printer.writeJsonInColor(chalk.gray, knowledge2.actions);
            context.printer.writeJson(knowledge2.inverseActions);

            totalTokens1 += tokenCount1;
            totalTokens2 += tokenCount2;
        }
        progressBar.complete();
        context.printer.writeInColor(
            chalk.gray,
            `Delta: ${totalTokens1 - totalTokens2}, V1: ${totalTokens1}, V2: ${totalTokens2}`,
        );
    }

    function getPodcastTextChunks(srcPath: string) {
        const [messages, _] = cm.parsePodcastTranscript(
            fs.readFileSync(srcPath, "utf-8"),
        );
        return messages.flatMap((m) => m.textChunks);
    }

    async function searchWithKnowledge(knowledge: kpLib.KnowledgeResponse) {
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

    function getExtractor(
        model: string,
        v2: boolean,
    ): LLMKnowledgeExtractor | undefined {
        const extractors = v2 ? context.extractors2 : context.extractors;
        let extractor = extractors.extractor;
        switch (model) {
            default:
                break;
            case "4o":
                extractor = extractors.extractor;
                break;
            case "41":
                extractor = extractors.extractor41;
                break;
            case "41m":
                extractor = extractors.extractor41Mini;
                break;
            case "35":
                extractor = extractors.extractor35;
                break;
        }

        return extractor;
    }

    async function runExtractKnowledge(
        llmExtractor: LLMKnowledgeExtractor,
        text: string,
    ): Promise<[kpLib.KnowledgeResponse | undefined, number]> {
        kpContext.startTokenCounter();
        kpContext.stopWatch.start();
        const knowledge = await llmExtractor.extractor.extract(text);
        kpContext.stopWatch.stop();
        context.printer.writeTiming(
            chalk.cyan,
            kpContext.stopWatch,
            llmExtractor.model.modelName,
        );
        //context.printer.writeCompletionStats(kpContext.tokenStats);
        context.printer.writeLineInColor(
            chalk.gray,
            `${kpContext.tokenStats.completion_tokens} tokens`,
        );
        return [knowledge, kpContext.tokenStats.completion_tokens];
    }

    function createExtractors(v2: boolean = false): LLMKnowledgeExtractors {
        const translator = v2
            ? kp.createKnowledgeTranslator2(kpContext.knowledgeModel)
            : undefined;
        const extractors: LLMKnowledgeExtractors = {};
        const settings: kpLib.KnowledgeExtractorSettings = {
            mergeActionKnowledge: false,
            mergeEntityFacets: false,
            maxContextLength: 8192,
        };
        extractors.extractor = {
            extractor: kpLib.createKnowledgeExtractor(
                kpContext.knowledgeModel,
                settings,
                translator,
            ),
            model: {
                model: kpContext.knowledgeModel,
                modelName: "4o",
            },
        };
        const models41 = kpTest.createGpt41Models();
        if (models41.gpt41) {
            extractors.extractor41 = {
                extractor: kpLib.createKnowledgeExtractor(
                    models41.gpt41.model,
                    settings,
                    translator,
                ),
                model: models41.gpt41,
            };
        }
        if (models41.gpt41Mini) {
            extractors.extractor41Mini = {
                extractor: kpLib.createKnowledgeExtractor(
                    models41.gpt41Mini.model,
                    settings,
                    translator,
                ),
                model: models41.gpt41Mini,
            };
        }
        const model35 = kpTest.create35Model();
        if (model35) {
            extractors.extractor35 = {
                extractor: kpLib.createKnowledgeExtractor(
                    model35.model,
                    settings,
                    translator,
                ),
                model: model35,
            };
        }
        return extractors;
    }

    return;
}

/**
 * Experimental: Turn knowledge into a query
 */
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
