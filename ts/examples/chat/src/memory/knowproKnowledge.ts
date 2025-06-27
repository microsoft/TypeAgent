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
import chalk from "chalk";

export type LLMKnowledgeExtractor = {
    extractor: kpLib.KnowledgeExtractor;
    model: kpTest.LanguageModel;
};

export type KnowProKnowledgeContext = {
    printer: KnowProPrinter;
    extractor?: LLMKnowledgeExtractor | undefined;
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
                use41: argBool("Extract with Gpt4.1", true),
                useMini: argBool("Extract using mini model", true),
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
        if (namedArgs.use41) {
            extractor = namedArgs.useMini
                ? context.extractor41Mini
                : context.extractor41;
        }

        return extractor;
    }

    function createExtractors() {
        context.extractor = {
            extractor: kpLib.createKnowledgeExtractor(kpContext.knowledgeModel),
            model: {
                model: kpContext.knowledgeModel,
                modelName: "Default",
            },
        };
        const models = kpTest.createGpt41Models();
        if (models.gpt41) {
            context.extractor41 = {
                extractor: kpLib.createKnowledgeExtractor(models.gpt41.model),
                model: models.gpt41,
            };
        }
        if (models.gpt41Mini) {
            context.extractor41Mini = {
                extractor: kpLib.createKnowledgeExtractor(
                    models.gpt41Mini.model,
                ),
                model: models.gpt41Mini,
            };
        }
    }

    return;
}
