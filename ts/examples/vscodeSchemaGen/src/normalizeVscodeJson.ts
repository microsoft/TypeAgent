// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { promises as fs } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const misc_commandstxt_filePath = path.join(
    __dirname,
    "data",
    "input",
    "misc_commands.txt",
);
const vscode_commands_filepath = path.join(
    __dirname,
    "data",
    "input",
    "commands.json",
);
const default_kb_filepath = path.join(
    __dirname,
    "data",
    "input",
    "default_keybindings.json",
);

const misc_commandsjson_filePath = path.join(
    __dirname,
    "data",
    "output",
    "misc_commands.json",
);
const master_keybindings_filepath = path.join(
    __dirname,
    "data",
    "output",
    "master_kb.json",
);
const master_commandsnkb_filepath = path.join(
    __dirname,
    "data",
    "output",
    "master_commandsnkb.json",
);

async function createDirectoryIfNotExists(dirPath: string) {
    try {
        await fs.mkdir(dirPath, null);
        console.log(`Directory created or already exists: ${dirPath}`);
    } catch (error: any) {
        console.error(`Error creating directory: ${error.message}`);
    }
}

export async function normalizeCommandsandKBJson() {
    await createDirectoryIfNotExists(path.join(__dirname, "data", "output"));

    await convertTxtToJSON(misc_commandstxt_filePath);
    await mergeKBJsonFiles(
        misc_commandsjson_filePath,
        default_kb_filepath,
        master_keybindings_filepath,
    );
    await mergeKBNCommandJsonFiles(
        vscode_commands_filepath,
        master_keybindings_filepath,
        master_commandsnkb_filepath,
    );

    async function convertTxtToJSON(filePath: string) {
        const fileContents = await fs.readFile(filePath, "utf-8");
        const lines = fileContents.split("\n");

        const jsonArray: { command: string }[] = [];
        lines.forEach((line) => {
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith("// -")) {
                const command = trimmedLine.replace("// -", "").trim();
                jsonArray.push({ command });
            }
        });

        const jsonOutput = JSON.stringify(jsonArray, null, 2);
        await fs.writeFile(misc_commandsjson_filePath, jsonOutput);
    }

    async function mergeAndFilterKeyBindings(keybindingsFilePath: string) {
        const masterKBJData = await fs.readFile(keybindingsFilePath, "utf-8");
        const masterKBArray = JSON.parse(masterKBJData);

        const filteredMap = new Map<string, any>();

        masterKBArray.forEach((kb: any) => {
            const command = kb.command;

            if (!filteredMap.has(command)) {
                filteredMap.set(command, kb);
            } else {
                const existingBinding = filteredMap.get(command);
                if (!existingBinding.when && kb.when) {
                    // Keep the one without the "when" condition
                    return;
                }
                if (!kb.when) {
                    filteredMap.set(command, kb);
                }
            }
        });
        return Array.from(filteredMap.values());
    }

    async function mergeKBJsonFiles(
        miscKBFilePath: string,
        keybindingsFilePath: string,
        masterFilePath: string,
    ) {
        const miscKBData = await fs.readFile(miscKBFilePath, "utf-8");
        const defKBData = await fs.readFile(keybindingsFilePath, "utf-8");

        const miscKBArray = JSON.parse(miscKBData);
        const defKBArray = JSON.parse(defKBData);

        const masterArray = [...miscKBArray, ...defKBArray];
        const masterJsonOutput = JSON.stringify(masterArray, null, 2);

        await fs.writeFile(masterFilePath, masterJsonOutput);
        console.log(`Master JSON file has been created at: ${masterFilePath}`);
    }

    async function mergeKBNCommandJsonFiles(
        firstFilePath: string,
        secondFilePath: string,
        mergedFilePath: string,
    ) {
        // contains the commands
        const firstFileData = await fs.readFile(firstFilePath, "utf-8");
        const firstArray = JSON.parse(firstFileData);
        const secondArray = await mergeAndFilterKeyBindings(secondFilePath);

        const secondMap = new Map(
            secondArray.map((item: any) => [item.command, item]),
        );
        const mergedArray: any[] = [];
        let countOfNodesNotInKbFile: number = 0;

        firstArray.forEach((item: any) => {
            const matchingItem: any = secondMap.get(item.id);
            const mergedObject: any = { ...item };

            if (matchingItem) {
                if (matchingItem.when) {
                    mergedObject.when = matchingItem.when;
                }
                secondMap.delete(item.id);
            } else {
                countOfNodesNotInKbFile++;
                console.log(
                    `Node in the commands file but not in the master keybindings file: ${item.id}`,
                );
            }
            mergedArray.push(mergedObject);
        });

        console.log(
            `Number of nodes in the commands file(${firstFilePath}) but not in the master keybindings file(${secondFilePath}): ${countOfNodesNotInKbFile}`,
        );
        console.log(
            `Number of nodes in the master keybindings file(${secondFilePath}) but not in the commands file (${firstFilePath}): ${secondMap.size}`,
        );
        secondMap.forEach((item: any) => {
            const mergedItem: any = { id: item.command };
            if (item.when) {
                mergedItem.when = item.when;
            }
            mergedArray.push(mergedItem);
        });

        const filteredArray = mergedArray.filter(
            (item: any) => !item.id.startsWith("_"),
        );
        console.log(
            `Number of nodes in the merged JSON output: ${filteredArray.length}`,
        );
        const mergedJsonOutput = JSON.stringify(filteredArray, null, 2);
        await fs.writeFile(mergedFilePath, mergedJsonOutput);
        console.log(`Merged JSON file has been created at: ${mergedFilePath}`);
    }
}
