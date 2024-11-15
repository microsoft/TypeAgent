// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { fileURLToPath } from "url";
import { ChatModel, openai } from "aiclient";
import { normalizeCommandsandKBJson } from "./normalizeVscodeJson.js";
import { processVscodeCommandsJsonFile } from "./schemaGen.js";
import {
    processActionSchemaAndReqData,
    processActionReqDataWithComments,
} from "./genStats.js";

export interface VSCodeSchemaGenApp {
    readonly model: ChatModel;
    run(): Promise<void>;
}

export async function createVSCodeSchemaGenApp(): Promise<VSCodeSchemaGenApp> {
    const model = openai.createChatModelDefault("VSCodeSchemaGenApp");
    const vscodeSchemaGenApp = {
        model,
        run,
    };

    return vscodeSchemaGenApp;

    async function run() {
        const args = process.argv.slice(2);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        const output_dir = path.join(__dirname, "data", "output");
        const master_commandsnkb_filepath = path.join(
            __dirname,
            "data",
            "output",
            "master_commandsnkb.json",
        );
        const vscodeCommandsSchema_filepath = path.join(
            __dirname,
            "data",
            "output",
            "vscodeCommandsSchema.ts",
        );

        if (args.includes("-dataprep")) {
            console.log(
                "Create a master JSON for VSCODE keybindings and commands...",
            );
            await normalizeCommandsandKBJson();
        } else if (args.includes("-schemagen")) {
            console.log("VSCODE Action Schema generation ...");
            await processVscodeCommandsJsonFile(
                vscodeSchemaGenApp.model,
                master_commandsnkb_filepath,
                vscodeCommandsSchema_filepath,
                undefined,
                output_dir,
            );
        } else if (
            args.some((arg) => arg.startsWith("-schemagen-actionprefix"))
        ) {
            const actionPrefixArg = args.find((arg) =>
                arg.startsWith("-schemagen-actionprefix"),
            );
            if (actionPrefixArg) {
                const actionPrefix = actionPrefixArg.split("=")[1];

                console.log("VSCODE Action Schema generation ...");
                const schemaFile = path.join(
                    __dirname,
                    "data",
                    "output",
                    "vscodeCommandsSchema_[" + actionPrefix + "].ts",
                );
                await processVscodeCommandsJsonFile(
                    vscodeSchemaGenApp.model,
                    master_commandsnkb_filepath,
                    schemaFile,
                    actionPrefix,
                    output_dir,
                );
            }
        } else if (args.includes("-statgen")) {
            const actionReqIndex = args.indexOf("-actionreqEmbeddingsFile");
            const statGenIndex = args.indexOf("-statGenFile");

            if (actionReqIndex !== -1 && statGenIndex !== -1) {
                const actionreqEmbeddingsFile = args[actionReqIndex + 1];
                const statGenFilePath = args[statGenIndex + 1];

                console.log(
                    "actionreqEmbeddingsFile: ",
                    actionreqEmbeddingsFile,
                );
                console.log("statGenFilePath: ", statGenFilePath);
                let zerorankStatsFile = path.join(
                    path.dirname(statGenFilePath),
                    "zero_rank_stats.csv",
                );

                const actionSchemaIndex = args.indexOf("-schemaFile");
                if (actionSchemaIndex !== -1) {
                    const actionSchemaFile = args[actionSchemaIndex + 1];
                    console.log("actionSchemaFile: ", actionSchemaFile);
                    processActionReqDataWithComments(
                        actionSchemaFile,
                        actionreqEmbeddingsFile,
                        0.7,
                        statGenFilePath,
                        zerorankStatsFile,
                    );
                } else {
                    processActionSchemaAndReqData(
                        actionreqEmbeddingsFile,
                        0.7,
                        statGenFilePath,
                        zerorankStatsFile,
                    );
                }
            } else {
                console.error("Missing required file paths for -statgen mode.");
                console.error(
                    "Please use -statgen -actionreqEmbeddingsFile <file> -statGenFile <file>",
                );
            }
        } else {
            console.log(
                "No valid arguments passed. Please use -dataprep or -schemagen or -schemagen-actionprefix.",
            );
        }
    }
}
