// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";

/**
 * Manages the TypeAgent server lifecycle: auto-start, health check,
 * and connection URL resolution.
 */
export class AgentServerManager implements vscode.Disposable {
    private _serverProcess: ChildProcess | undefined;
    private _statusBarItem: vscode.StatusBarItem;
    private _outputChannel: vscode.OutputChannel;
    private _isRunning = false;

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._outputChannel = vscode.window.createOutputChannel(
            "TypeAgent Server",
        );
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            50,
        );
        this._statusBarItem.command = "typeagent-shell.focusChat";
        this._updateStatus("disconnected");
        this._statusBarItem.show();
    }

    public getServerUrl(): string {
        const config = vscode.workspace.getConfiguration("typeagent");
        return config.get<string>("serverUrl", "ws://localhost:3000");
    }

    /**
     * Ensure the agent server is running. If auto-start is enabled and
     * no server is detected, spawn one as a child process.
     */
    public async ensureRunning(): Promise<void> {
        if (this._isRunning) {
            return;
        }

        const url = this.getServerUrl();
        this._updateStatus("connecting");

        // Probe the server
        const isUp = await this._probe(url);
        if (isUp) {
            this._isRunning = true;
            this._updateStatus("connected");
            this._outputChannel.appendLine(
                `Agent server already running at ${url}`,
            );
            return;
        }

        // Auto-start if configured
        const config = vscode.workspace.getConfiguration("typeagent");
        if (!config.get<boolean>("autoStart", true)) {
            this._updateStatus("disconnected");
            this._outputChannel.appendLine(
                "Agent server not running and auto-start is disabled",
            );
            return;
        }

        this._startServer();
    }

    private _startServer(): void {
        const config = vscode.workspace.getConfiguration("typeagent");
        const port = config.get<number>("serverPort", 3000);

        // Resolve the server entry point relative to the workspace
        // The agent server is at ts/packages/agentServer/server/dist/server.js
        const workspaceFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) {
            this._outputChannel.appendLine(
                "Cannot auto-start: no workspace folder open",
            );
            this._updateStatus("disconnected");
            return;
        }

        const serverPath = path.join(
            workspaceFolder,
            "ts",
            "packages",
            "agentServer",
            "server",
            "dist",
            "server.js",
        );

        this._outputChannel.appendLine(
            `Starting agent server: node ${serverPath} --port ${port}`,
        );
        this._updateStatus("connecting");

        const proc = spawn(
            "node",
            ["--disable-warning=DEP0190", serverPath, "--port", String(port)],
            {
                cwd: workspaceFolder,
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        proc.stdout?.on("data", (data: Buffer) => {
            const text = data.toString();
            this._outputChannel.append(text);
            if (text.includes("started at")) {
                this._isRunning = true;
                this._updateStatus("connected");
            }
        });

        proc.stderr?.on("data", (data: Buffer) => {
            this._outputChannel.append(data.toString());
        });

        proc.on("exit", (code) => {
            this._outputChannel.appendLine(
                `Agent server exited with code ${code}`,
            );
            this._isRunning = false;
            this._serverProcess = undefined;
            this._updateStatus("disconnected");
        });

        this._serverProcess = proc;
    }

    /**
     * Probe the server by attempting a WebSocket connection.
     */
    private async _probe(url: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                // Use a simple HTTP fetch to the server's expected port
                // Agent server also serves HTTP on the same port
                const httpUrl = url
                    .replace("ws://", "http://")
                    .replace("wss://", "https://");
                const controller = new AbortController();
                const timeout = setTimeout(
                    () => controller.abort(),
                    2000,
                );
                fetch(httpUrl, { signal: controller.signal })
                    .then(() => {
                        clearTimeout(timeout);
                        resolve(true);
                    })
                    .catch(() => {
                        clearTimeout(timeout);
                        resolve(false);
                    });
            } catch {
                resolve(false);
            }
        });
    }

    private _updateStatus(
        state: "connected" | "connecting" | "disconnected",
    ): void {
        switch (state) {
            case "connected":
                this._statusBarItem.text = "$(check) TypeAgent";
                this._statusBarItem.tooltip = "TypeAgent server connected";
                this._statusBarItem.backgroundColor = undefined;
                break;
            case "connecting":
                this._statusBarItem.text = "$(sync~spin) TypeAgent";
                this._statusBarItem.tooltip = "Connecting to TypeAgent server…";
                this._statusBarItem.backgroundColor =
                    new vscode.ThemeColor(
                        "statusBarItem.warningBackground",
                    );
                break;
            case "disconnected":
                this._statusBarItem.text = "$(error) TypeAgent";
                this._statusBarItem.tooltip =
                    "TypeAgent server disconnected";
                this._statusBarItem.backgroundColor =
                    new vscode.ThemeColor(
                        "statusBarItem.errorBackground",
                    );
                break;
        }
    }

    public dispose(): void {
        if (this._serverProcess) {
            this._serverProcess.kill();
            this._serverProcess = undefined;
        }
        this._statusBarItem.dispose();
        this._outputChannel.dispose();
    }
}
