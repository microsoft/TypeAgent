// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import { createGpt41Models } from "../common.js";
import { conversation as kpLib } from "knowledge-processor";

export type KnowProKnowledgeContext = {
    printer: KnowProPrinter;
    extractor?: kpLib.KnowledgeExtractor | undefined;
    extractor41?: kpLib.KnowledgeExtractor | undefined;
    extractor41Mini?: kpLib.KnowledgeExtractor | undefined;
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
        const extractor = getExtractor(namedArgs);
        if (!extractor) {
            context.printer.writeError(
                "Knowledge extractor not available for model",
            );
            return;
        }
        const knowledge = await extractor.extract(namedArgs.text);
        if (knowledge) {
            context.printer.writeJson(knowledge);
        }
    }

    function getExtractor(
        namedArgs: NamedArgs,
    ): kpLib.KnowledgeExtractor | undefined {
        let extractor = context.extractor;
        if (namedArgs.use41) {
            extractor = namedArgs.useMini
                ? context.extractor41Mini
                : context.extractor41;
        }

        return extractor;
    }

    function createExtractors() {
        context.extractor = kpLib.createKnowledgeExtractor(
            kpContext.knowledgeModel,
        );
        const models = createGpt41Models();
        if (models.gpt41) {
            context.extractor41 = kpLib.createKnowledgeExtractor(models.gpt41);
        }
        if (models.gpt41Mini) {
            context.extractor41Mini = kpLib.createKnowledgeExtractor(
                models.gpt41Mini,
            );
        }
    }

    return;
}
