// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as fs from "fs/promises";

interface AliasTree {
    tools: Record<string, Record<string, string>>;
    languages: Record<string, Record<string, Record<string, string>>>;
}

export class CommandAliasManager {
    private aliases: AliasTree = { tools: {}, languages: {} };
    public ready: Promise<void>;

    constructor(private context: vscode.ExtensionContext) {
        this.ready = this.initialize(context.extensionUri);
    }

    async initialize(contextFolder?: vscode.Uri) {
        await this.loadDefaultAliases();
    }

    private async loadDefaultAliases() {
        try {
            const aliasFileUri = vscode.Uri.joinPath(
                this.context.extensionUri,
                "assets",
                "default-aliases.json",
            );
            const content = await fs.readFile(aliasFileUri.fsPath, "utf-8");
            this.aliases = JSON.parse(content) as AliasTree;
        } catch (error) {
            console.error("❌ Failed to load default-aliases.json", error);
        }
    }

    private async detectLanguageContext(
        contextFolder?: vscode.Uri,
    ): Promise<string | undefined> {
        if (!contextFolder) return undefined;
        const checkFile = async (file: string) => {
            try {
                await vscode.workspace.fs.stat(
                    vscode.Uri.joinPath(contextFolder, file),
                );
                return true;
            } catch {
                return false;
            }
        };

        if (await checkFile("package.json")) return "typescript";
        if (
            (await checkFile("pyproject.toml")) ||
            (await checkFile("requirements.txt"))
        )
            return "python";
        if (await checkFile(".git")) return "git";
        return undefined;
    }

    async resolveCommandWithArgs(
        userInput: string,
        contextFolder?: vscode.Uri,
    ): Promise<string | undefined> {
        const [alias, ...args] = userInput.trim().split(/\s+/);
        const language = await this.detectLanguageContext(contextFolder);
        const detectedTools = [
            "pnpm",
            "npm",
            "yarn",
            "prettier",
            "eslint",
            "typescript",
            "git",
        ];

        if (language && this.aliases.languages[language]) {
            for (const tool of detectedTools) {
                const toolAliases = this.aliases.languages[language][tool];
                if (toolAliases && toolAliases[alias]) {
                    const resolvedBase = toolAliases[alias];
                    return args.length > 0
                        ? `${resolvedBase} ${args.join(" ")}`
                        : resolvedBase;
                }
            }
        }

        for (const tool of detectedTools) {
            const toolAliases = this.aliases.tools[tool];
            if (toolAliases && toolAliases[alias]) {
                const resolvedBase = toolAliases[alias];
                return args.length > 0
                    ? `${resolvedBase} ${args.join(" ")}`
                    : resolvedBase;
            }
        }

        return userInput;
    }
}

export let aliasManager: CommandAliasManager;
export function initializeAliasManager(context: vscode.ExtensionContext) {
    aliasManager = new CommandAliasManager(context);
    aliasManager.ready
        .then(() => console.log("✅ AliasManager ready."))
        .catch((err) =>
            console.error("❌ AliasManager initialization failed:", err),
        );
}
