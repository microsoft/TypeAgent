// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const misc_commandstxt_filePath = path.join(__dirname, 'data', 'input', 'misc_commands.txt');
const misc_commandsjson_filePath = path.join(__dirname, 'data', 'output', 'misc_commands.json');
const default_kb_filepath = path.join(__dirname, 'data', 'input', 'default_keybindings.json');
const master_keybindings_filepath = path.join(__dirname, 'data', 'output', 'master_kb.json');
const vscode_commands_filepath = path.join(__dirname, 'data', 'output' , 'commands.json');
const master_commandsnkb_filepath = path.join(__dirname, 'data', 'output', 'master_commandsnkb.json');

async function createDirectoryIfNotExists(dirPath: string) {
    try {
        await fs.mkdir(dirPath, null);
        console.log(`Directory created or already exists: ${dirPath}`);
    } catch (error: any) {
        console.error(`Error creating directory: ${error.message}`);
    }
}

export async function normalizeCommandsandKBJson() {
    
    await createDirectoryIfNotExists(path.join(__dirname, 'data', 'output'));

    await convertTxtToJSON(misc_commandstxt_filePath);
    await mergeJsonFiles(misc_commandsjson_filePath, default_kb_filepath, master_keybindings_filepath);
    await mergeKBNCommandJsonFiles(vscode_commands_filepath, master_keybindings_filepath, master_commandsnkb_filepath);

    async function convertTxtToJSON(filePath: string)  {

        const fileContents = await fs.readFile(filePath, 'utf-8');
        const lines = fileContents.split('\n');
    
        const jsonArray: { command: string }[] = [];
        lines.forEach((line) => {
            const trimmedLine = line.trim();
    
            if (trimmedLine.startsWith('// -')) {
                const command = trimmedLine.replace('// -', '').trim();
                jsonArray.push({ command });
            }
        });
    
        const jsonOutput = JSON.stringify(jsonArray, null, 2);
        await fs.writeFile(misc_commandsjson_filePath, jsonOutput);
    }
    
    async function mergeJsonFiles(commandsFilePath: string, keybindingsFilePath: string, masterFilePath: string) {
        const commandsData = await fs.readFile(commandsFilePath, 'utf-8');
        const keybindingsData = await fs.readFile(keybindingsFilePath, 'utf-8');
    
        const commandsArray = JSON.parse(commandsData);
        const keybindingsArray = JSON.parse(keybindingsData);
    
        const masterArray = [...commandsArray, ...keybindingsArray];
        const masterJsonOutput = JSON.stringify(masterArray, null, 2);
    
        await fs.writeFile(masterFilePath, masterJsonOutput);
        console.log(`Master JSON file has been created at: ${masterFilePath}`);
    }
    
    async function mergeKBNCommandJsonFiles(firstFilePath: string, secondFilePath: string, mergedFilePath: string) {
        const firstFileData = await fs.readFile(firstFilePath, 'utf-8');
        const secondFileData = await fs.readFile(secondFilePath, 'utf-8');
    
        const firstArray = JSON.parse(firstFileData);
        const secondArray = JSON.parse(secondFileData);
    
        const secondMap = new Map(secondArray.map((item: any) => [item.command, item]));
    
        const mergedArray: any[] = [];
        const unmatchedItems: any[] = [];
    
        firstArray.forEach((item: any) => {
            const matchingItem: any = secondMap.get(item.id);
            const mergedObject: any = {
                id: item.id
            };
    
            if (item.metadata) {
                mergedObject.metadata = item.metadata;
            }
    
            if (matchingItem) {
                if (matchingItem.key) {
                    mergedObject.key = matchingItem.key;
                }
    
                if (matchingItem.when) {
                    mergedObject.when = matchingItem.when;
                }
            } else {
                unmatchedItems.push(item);
            }
            mergedArray.push(mergedObject);
        });
    
        const mergedJsonOutput = JSON.stringify(mergedArray, null, 2);
        await fs.writeFile(mergedFilePath, mergedJsonOutput);
    
        if (unmatchedItems.length > 0) {
            console.log('Items from the first file with no corresponding entry in the second file:');
            unmatchedItems.forEach((item: any) => {
                console.log(JSON.stringify(item, null, 2));
            });
        } else {
            console.log('All items from the first file have corresponding entries in the second file.');
        }
    
        console.log(`Number of nodes in merged JSON output: ${mergedArray.length}`);
        console.log(`Merged JSON file has been created at: ${mergedFilePath}`);
    }
}