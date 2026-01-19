// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as pty from "node-pty";
import { AssistantConfig } from "./assistantConfig.js";

/**
 * Options for the PTY wrapper
 */
export interface PtyWrapperOptions {
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
}

/**
 * Wraps a CLI coding assistant in a pseudo terminal for transparent I/O
 */
export class PtyWrapper {
    private ptyProcess: pty.IPty | null = null;
    private readonly config: AssistantConfig;
    private readonly options: PtyWrapperOptions;

    constructor(config: AssistantConfig, options: PtyWrapperOptions = {}) {
        this.config = config;
        // Filter out undefined values from process.env
        const cleanEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) {
                cleanEnv[key] = value;
            }
        }
        this.options = {
            cols: options.cols || 80,
            rows: options.rows || 30,
            cwd: options.cwd || process.cwd(),
            env: { ...cleanEnv, ...config.env, ...options.env },
        };
    }

    /**
     * Spawn the assistant process in a pseudo terminal
     */
    spawn(): void {
        if (this.ptyProcess) {
            throw new Error("Process already spawned");
        }

        console.log(
            `[CoderWrapper] Spawning ${this.config.name} (${this.config.command})`,
        );

        // On Windows, node-pty needs .exe extension or full path
        let command = this.config.command;
        if (process.platform === "win32" && !command.endsWith(".exe")) {
            command = command + ".exe";
        }

        this.ptyProcess = pty.spawn(command, this.config.args, {
            name: "xterm-256color",
            cols: this.options.cols!,
            rows: this.options.rows!,
            cwd: this.options.cwd!,
            env: this.options.env as any,
        });

        // Set up data handler for transparent passthrough
        this.ptyProcess.onData((data: string) => {
            process.stdout.write(data);
        });

        // Handle process exit
        this.ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(
                `\n[CoderWrapper] ${this.config.name} exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ""}`,
            );
            this.ptyProcess = null;
        });

        // Handle stdin from the user
        process.stdin.setRawMode(true);
        process.stdin.on("data", (data: Buffer) => {
            if (this.ptyProcess) {
                this.ptyProcess.write(data.toString());
            }
        });

        // Handle terminal resize
        process.stdout.on("resize", () => {
            if (this.ptyProcess) {
                const cols = process.stdout.columns;
                const rows = process.stdout.rows;
                this.ptyProcess.resize(cols, rows);
            }
        });
    }

    /**
     * Write data to the assistant's stdin
     */
    write(data: string): void {
        if (!this.ptyProcess) {
            throw new Error("Process not spawned");
        }
        this.ptyProcess.write(data);
    }

    /**
     * Resize the pseudo terminal
     */
    resize(cols: number, rows: number): void {
        if (!this.ptyProcess) {
            throw new Error("Process not spawned");
        }
        this.ptyProcess.resize(cols, rows);
    }

    /**
     * Kill the assistant process
     */
    kill(signal?: string): void {
        if (this.ptyProcess) {
            console.log(`\n[CoderWrapper] Killing ${this.config.name}...`);
            this.ptyProcess.kill(signal);
            this.ptyProcess = null;
        }
    }

    /**
     * Check if the process is running
     */
    isRunning(): boolean {
        return this.ptyProcess !== null;
    }

    /**
     * Get the process ID
     */
    getPid(): number | undefined {
        return this.ptyProcess?.pid;
    }
}
