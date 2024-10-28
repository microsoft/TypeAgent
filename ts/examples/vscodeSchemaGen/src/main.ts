// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import { fileURLToPath } from 'url';

import { normalizeCommandsandKBJson } from './normalizeVscodeJson.js';
import { processVscodeCommandsJsonFile } from './schemaGen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sample_commandsnkb_filepath = path.join(__dirname, 'data', 'input', 'sample_commandsnkb.json');
const vscodeCommandsSchema_filepath = path.join(__dirname, 'data', 'output', 'vscodeCommandsSchema.ts');

function run() {
    const args = process.argv.slice(2);
    
    if (args.includes('-dataprep')) {
        console.log("Create a master JSON for VSCODE keybindings and commands...");
        normalizeCommandsandKBJson();
    }

    if (args.includes('-schemagen')) {
        console.log("VSCODE Action Schema generation ...");
        processVscodeCommandsJsonFile(sample_commandsnkb_filepath, vscodeCommandsSchema_filepath);
    }

    if (!args.includes('-dataprep') && !args.includes('-schemagen')) {
        console.log("No valid arguments passed. Please use -dataprep or -schemagen.");
    }
}

run();








