// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from "fs";
import * as vscode from "vscode";
import { initializeWS } from "./wsConnect";
import { initializeAliasManager } from "./commandAliasMgr";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "coda" is now active!');

    initializeWS();

    initializeAliasManager(context);

    // The command has been defined in the package.json file
    // Now provide the implemeninitializeWStation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand("coda-shell.start", () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage("Hello World from Coda!");
    });

    context.subscriptions.push(disposable);
    // make a command to list to console all of the commands available
    let listCommands = vscode.commands.registerCommand(
        "coda-shell.listCommands",
        () => {
            vscode.commands.getCommands().then((commands) => {
                // write commands to file
                const filePath = "/temp/commands.txt";
                fs.writeFileSync(filePath, commands.join("\n"));
            });
        },
    );
    context.subscriptions.push(listCommands);
}

// This method is called when your extension is deactivated
export function deactivate() {}
