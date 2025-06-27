// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
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
};

export async function createKnowproKnowledgeCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: KnowProKnowledgeContext = {
        printer: kpContext.printer,
    };
    createExtractors();

    commands.kpKnowledgeExtract = extractKnowledge;

    function extractKnowledgeDef(): CommandMetadata {
        return {
            description: "Extract knowledge",
            options: {
                text: arg("Extract knowledge from this text"),
                model: arg("Extract with: 4o | 41 | 41m | 35", "41m"),
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
        if (knowledge) {
            context.printer.writeJson(knowledge);
        }
        context.printer.writeTiming(
            chalk.cyan,
            stopWatch,
            llmExtractor.model.modelName,
        );
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
