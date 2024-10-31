// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import { fileURLToPath } from "url";
import { ChatModel, openai } from "aiclient";
import { normalizeCommandsandKBJson } from "./normalizeVscodeJson.js";
import { processVscodeCommandsJsonFile } from "./schemaGen.js";

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

        //const sample_commandsnkb_filepath = path.join(__dirname, 'data', 'input', 'sample_commandsnkb.json');
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
        }

        if (args.includes("-schemagen")) {
            console.log("VSCODE Action Schema generation ...");
            await processVscodeCommandsJsonFile(
                vscodeSchemaGenApp.model,
                master_commandsnkb_filepath,
                vscodeCommandsSchema_filepath,
                undefined,
            );
        }

        const actionPrefixArg = args.find((arg) =>
            arg.startsWith("-schemagen-actionprefix"),
        );
        console.log("actionPrefixArg: ", actionPrefixArg);
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
            );
        }

        if (
            !args.includes("-dataprep") &&
            !args.includes("-schemagen") &&
            !args.includes("-schemagen-actionprefix")
        ) {
            console.log(
                "No valid arguments passed. Please use -dataprep or -schemagen.",
            );
        }
    }
}
