// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    argBool,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import chalk from "chalk";
import { PromptSection } from "typechat";

// Diagnostic commands

type DiagnosticsContext = {
    printer: KnowProPrinter;
    showRequest?: boolean | undefined;
    showResponse?: boolean | undefined;
};

export async function createDiagnosticCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    const context: DiagnosticsContext = {
        printer: kpContext.printer,
    };

    commands.kpDebugShowPrompt = showPrompt;

    function showPromptDef(): CommandMetadata {
        return {
            description: "Enable/disable printing out raw prompts",
            options: {
                request: argBool("Show request prompts"),
                response: argBool("Show response prompts"),
            },
        };
    }
    commands.kpDebugShowPrompt.metadata = showPromptDef();
    async function showPrompt(args: string[]) {
        const namedArgs = parseNamedArguments(args, showPromptDef());
        if (namedArgs.request !== undefined) {
            context.showRequest = namedArgs.request;
        }
        if (namedArgs.response !== undefined) {
            context.showResponse = namedArgs.response;
        }
        context.printer.writeLine(
            `Show Request: ${context.showRequest ?? false}\nShow Response: ${context.showResponse ?? false}`,
        );
        if (context.showRequest || context.showResponse) {
            kpContext.promptHandler = promptCallback;
        } else {
            kpContext.promptHandler = undefined;
        }
    }

    function promptCallback(request: PromptSection[], response: string): void {
        context.printer.pushColor(chalk.gray);
        try {
            if (context.showRequest) {
                context.printer.writeHeading("Request");
                context.printer.writeLine("###");
                request.forEach((p) => context.printer.writePromptSection(p));
                context.printer.writeLine("###");
            }
            if (context.showResponse) {
                context.printer.writeHeading("Response");
                context.printer.writeLine("###");
                if (response) {
                    context.printer.writeLine(response);
                    context.printer.writeLine("###");
                }
            }
        } finally {
            context.printer.popColor();
        }
    }
}
