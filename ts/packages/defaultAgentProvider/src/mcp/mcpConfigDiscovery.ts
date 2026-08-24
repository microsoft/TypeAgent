// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importMcpConfig } from "./mcpConfigImport.js";
import type { NormalizedMcpServerConfig } from "./mcpServerConfig.js";

export type McpDiscoverySourceKind =
    | "copilot-user"
    | "workspace-vscode"
    | "workspace-github"
    | "workspace-mcp";

export type McpDiscoveryDiagnostic = {
    kind: "duplicate" | "invalid" | "untrusted" | "unreadable";
    message: string;
    filePath: string;
    serverName?: string;
    replacedFilePath?: string;
};

export type DiscoveredMcpConfig = {
    config: NormalizedMcpServerConfig;
    filePath: string;
    sourceKind: McpDiscoverySourceKind;
};

export type McpConfigDiscoveryResult = {
    configs: DiscoveredMcpConfig[];
    diagnostics: McpDiscoveryDiagnostic[];
    searchedFiles: string[];
    workspacePath?: string;
    repositoryRoot?: string;
};

export type McpConfigDiscoveryOptions = {
    workspacePath?: string;
    repositoryRoot?: string;
    homeDirectory?: string;
    includeUserConfig?: boolean;
    includeWorkspaceConfig?: boolean;
    isFolderTrusted?: (folderPath: string) => boolean;
};

type ConfigFile = {
    filePath: string;
    sourceKind: McpDiscoverySourceKind;
    scope: "user" | "workspace";
    trusted: boolean;
};

const WORKSPACE_FILES: ReadonlyArray<{
    relativePath: string;
    sourceKind: McpDiscoverySourceKind;
}> = [
    {
        relativePath: path.join(".vscode", "mcp.json"),
        sourceKind: "workspace-vscode",
    },
    {
        relativePath: path.join(".github", "mcp.json"),
        sourceKind: "workspace-github",
    },
    { relativePath: ".mcp.json", sourceKind: "workspace-mcp" },
];

function findRepositoryRoot(workspacePath: string): string {
    let current = workspacePath;
    while (true) {
        if (fs.existsSync(path.join(current, ".git"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return workspacePath;
        }
        current = parent;
    }
}

function traversalDirectories(
    workspacePath: string,
    repositoryRoot: string,
): string[] {
    const relative = path.relative(repositoryRoot, workspacePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
            `MCP discovery workspace '${workspacePath}' is outside repository root '${repositoryRoot}'.`,
        );
    }
    const directories = [workspacePath];
    let current = workspacePath;
    while (current !== repositoryRoot) {
        current = path.dirname(current);
        directories.push(current);
    }
    return directories.reverse();
}

export class McpConfigDiscovery {
    public discover(
        options: McpConfigDiscoveryOptions = {},
    ): McpConfigDiscoveryResult {
        const workspacePath = options.workspacePath
            ? path.resolve(options.workspacePath)
            : undefined;
        const repositoryRoot = workspacePath
            ? path.resolve(
                  options.repositoryRoot ?? findRepositoryRoot(workspacePath),
              )
            : undefined;

        const files = this.collectConfigFiles(
            options,
            workspacePath,
            repositoryRoot,
        );
        const diagnostics: McpDiscoveryDiagnostic[] = [];
        const searchedFiles: string[] = [];
        const selected = new Map<string, DiscoveredMcpConfig>();

        for (const file of files) {
            searchedFiles.push(file.filePath);
            this.processConfigFile(file, selected, diagnostics);
        }

        return {
            configs: [...selected.values()],
            diagnostics,
            searchedFiles,
            ...(workspacePath === undefined ? {} : { workspacePath }),
            ...(repositoryRoot === undefined ? {} : { repositoryRoot }),
        };
    }

    private collectConfigFiles(
        options: McpConfigDiscoveryOptions,
        workspacePath: string | undefined,
        repositoryRoot: string | undefined,
    ): ConfigFile[] {
        const files: ConfigFile[] = [];

        if (options.includeUserConfig !== false) {
            files.push({
                filePath: path.join(
                    options.homeDirectory ?? os.homedir(),
                    ".copilot",
                    "mcp-config.json",
                ),
                sourceKind: "copilot-user",
                scope: "user",
                trusted: true,
            });
        }

        if (
            options.includeWorkspaceConfig !== false &&
            workspacePath !== undefined &&
            repositoryRoot !== undefined
        ) {
            for (const directory of traversalDirectories(
                workspacePath,
                repositoryRoot,
            )) {
                const trusted = options.isFolderTrusted?.(directory) ?? false;
                for (const workspaceFile of WORKSPACE_FILES) {
                    files.push({
                        filePath: path.join(
                            directory,
                            workspaceFile.relativePath,
                        ),
                        sourceKind: workspaceFile.sourceKind,
                        scope: "workspace",
                        trusted,
                    });
                }
            }
        }

        return files;
    }

    private processConfigFile(
        file: ConfigFile,
        selected: Map<string, DiscoveredMcpConfig>,
        diagnostics: McpDiscoveryDiagnostic[],
    ): void {
        if (!fs.existsSync(file.filePath)) {
            return;
        }
        if (!file.trusted) {
            diagnostics.push({
                kind: "untrusted",
                filePath: file.filePath,
                message: `Skipped MCP config in untrusted folder: ${file.filePath}`,
            });
            return;
        }

        const parsed = this.readConfigFile(file.filePath, diagnostics);
        if (parsed === undefined) {
            return;
        }

        const imported = importMcpConfig(parsed);
        this.recordImportErrors(file, imported.errors, diagnostics);
        this.mergeServers(file, imported.servers, selected, diagnostics);
    }

    private readConfigFile(
        filePath: string,
        diagnostics: McpDiscoveryDiagnostic[],
    ): unknown | undefined {
        try {
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (error) {
            diagnostics.push({
                kind: "unreadable",
                filePath,
                message: `Unable to read MCP config '${filePath}': ${error instanceof Error ? error.message : String(error)}`,
            });
            return undefined;
        }
    }

    private recordImportErrors(
        file: ConfigFile,
        errors: ReadonlyArray<{ name: string; reason: string }>,
        diagnostics: McpDiscoveryDiagnostic[],
    ): void {
        for (const error of errors) {
            diagnostics.push({
                kind: "invalid",
                filePath: file.filePath,
                ...(error.name === "(root)" ? {} : { serverName: error.name }),
                message: `Invalid MCP config '${file.filePath}'${error.name === "(root)" ? "" : ` server '${error.name}'`}: ${error.reason}`,
            });
        }
    }

    private mergeServers(
        file: ConfigFile,
        servers: ReadonlyArray<{
            name: string;
            config: NormalizedMcpServerConfig;
        }>,
        selected: Map<string, DiscoveredMcpConfig>,
        diagnostics: McpDiscoveryDiagnostic[],
    ): void {
        for (const importedServer of servers) {
            const previous = selected.get(importedServer.name);
            if (previous !== undefined) {
                diagnostics.push({
                    kind: "duplicate",
                    filePath: file.filePath,
                    serverName: importedServer.name,
                    replacedFilePath: previous.filePath,
                    message: `MCP server '${importedServer.name}' from '${file.filePath}' overrides '${previous.filePath}'.`,
                });
            }
            selected.set(importedServer.name, {
                filePath: file.filePath,
                sourceKind: file.sourceKind,
                config: {
                    ...importedServer.config,
                    id: `discovered:${file.sourceKind}:${importedServer.name}`,
                    scope: file.scope,
                    trust: "untrusted",
                    enabled: false,
                    provenance: {
                        ...importedServer.config.provenance,
                        source: file.filePath,
                        sourceKind: file.sourceKind,
                        ref: importedServer.name,
                    },
                },
            });
        }
    }
}
