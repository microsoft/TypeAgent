// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { fileURLToPath } from "url";
import { ChatModel, openai } from "aiclient";
import { normalizeCommandsandKBJson } from "./normalizeVscodeJson.js";
import {
    processVscodeCommandsJsonFile,
    genEmbeddingDataFromActionSchema,
} from "./schemaGen.js";
import {
    processActionSchemaAndReqData,
    processActionReqDataWithComments,
} from "./genStats.js";

export interface VSCodeSchemaGenApp {
    readonly model: ChatModel;
    run(): Promise<void>;
}

type ArgType = "string" | "number";
function parseArg<T extends ArgType>(
    argName: string,
    type: T,
    args: string[],
): T extends "number" ? number : string | undefined {
    const prefix = `-${argName}=`;
    const matchedArg = args.find((arg) => arg.startsWith(prefix));

    if (!matchedArg) {
        console.log(`Argument -${argName} not provided`);
        switch (type) {
            case "number":
                return -1 as T extends "number" ? number : string;
            case "string":
            default:
                return "" as T extends "number" ? number : string;
        }
    } else {
        const value = matchedArg.slice(prefix.length);
        if (!matchedArg) {
            return (type === "number" ? -1 : undefined) as T extends "number"
                ? number
                : string | undefined;
        }

        switch (type) {
            case "number":
                const numValue = Number(value);
                if (isNaN(numValue)) {
                    return -1 as T extends "number" ? number : string;
                }
                return numValue as T extends "number" ? number : string;
            case "string":
            default:
                return value as T extends "number" ? number : string;
        }
    }
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

        const verbose: boolean = args.includes("-verbose");

        if (args.includes("-dataprep")) {
            console.log(
                "Create a master JSON for VSCODE keybindings and commands...",
            );
            await normalizeCommandsandKBJson();
        } else if (args.includes("-schemagen")) {
            console.log("VSCODE Action Schema generation ...");

            let maxNodestoProcess = parseArg(
                "maxNodesToProcess",
                "number",
                args,
            );
            await processVscodeCommandsJsonFile(
                vscodeSchemaGenApp.model,
                master_commandsnkb_filepath,
                vscodeCommandsSchema_filepath,
                undefined,
                output_dir,
                maxNodestoProcess,
                verbose,
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

                const maxNodestoProcess = parseArg(
                    "maxNodesToProcess",
                    "number",
                    args,
                );
                await processVscodeCommandsJsonFile(
                    vscodeSchemaGenApp.model,
                    master_commandsnkb_filepath,
                    schemaFile,
                    actionPrefix,
                    output_dir,
                    maxNodestoProcess,
                    verbose,
                );
            }
        } else if (args.includes("-genembeddings")) {
            console.log("Generate embeddings for VSCODE Action Schema ...");
            const schemaIndex = args.indexOf("-schemaFile");
            const actionPrefixIndex = args.indexOf("-actionPrefix");

            if (schemaIndex !== -1) {
                const schemaFile = args[schemaIndex + 1];
                console.log("Actions schema file: ", schemaFile);

                let actionPrefix: string | undefined = undefined;
                if (actionPrefixIndex !== -1) {
                    actionPrefix = args[actionPrefixIndex + 1];
                    console.log("Action Prefix: ", actionPrefix);
                }

                await genEmbeddingDataFromActionSchema(
                    vscodeSchemaGenApp.model,
                    master_commandsnkb_filepath,
                    schemaFile,
                    actionPrefix,
                    output_dir,
                    -1,
                );
            } else {
                console.error(
                    "Missing required actions schema file path for -genembeddings mode.",
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
                    await processActionReqDataWithComments(
                        actionSchemaFile,
                        actionreqEmbeddingsFile,
                        0.7,
                        statGenFilePath,
                        zerorankStatsFile,
                    );
                } else {
                    await processActionSchemaAndReqData(
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
