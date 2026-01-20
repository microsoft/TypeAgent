// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as pty from "node-pty";
import { AssistantConfig } from "./assistantConfig.js";
import { CacheClient } from "./cacheClient.js";
import { DebugLogger } from "./debugLogger.js";

/**
 * Options for the PTY wrapper
 */
export interface PtyWrapperOptions {
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    enableCache?: boolean;
    debug?: boolean;
}

/**
 * Wraps a CLI coding assistant in a pseudo terminal for transparent I/O
 */
export class PtyWrapper {
    private ptyProcess: pty.IPty | null = null;
    private readonly config: AssistantConfig;
    private readonly options: PtyWrapperOptions;
    private cacheClient: CacheClient | null = null;
    private inputBuffer: string = "";
    private debugLogger: DebugLogger | null = null;
    private processingCommand: boolean = false;
    private lastInputWasCarriageReturn: boolean = false;

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
            enableCache: options.enableCache ?? false,
            debug: options.debug ?? false,
        };

        // Initialize debug logger if enabled
        if (this.options.debug) {
            this.debugLogger = new DebugLogger(true);
            this.debugLogger.log(`PtyWrapper initialized for ${config.name}`);
        }

        // Initialize cache client if enabled
        if (this.options.enableCache) {
            this.cacheClient = new CacheClient(
                undefined,
                this.debugLogger || undefined,
            );
            if (this.debugLogger) {
                this.debugLogger.log("Cache client initialized");
            }
        }
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
        process.stdin.on("data", async (data: Buffer) => {
            if (!this.ptyProcess) {
                return;
            }

            const input = data.toString();

            if (this.debugLogger) {
                this.debugLogger.log(
                    `stdin data received: ${JSON.stringify(input)} (length: ${input.length})`,
                );
            }

            // If the last input was \r and this input is \n, skip it (Windows sends both separately)
            if (this.lastInputWasCarriageReturn && input === "\n") {
                if (this.debugLogger) {
                    this.debugLogger.log("Skipping \\n that follows \\r");
                }
                this.lastInputWasCarriageReturn = false;
                return;
            }

            // Check for Enter key (carriage return, newline, or both)
            if (input === "\r" || input === "\n" || input === "\r\n") {
                // Track if this was a \r so we can skip the following \n
                this.lastInputWasCarriageReturn = input === "\r";

                // User pressed Enter - check if we should check cache
                if (this.inputBuffer.trim() && this.cacheClient) {
                    await this.handleCommand(this.inputBuffer.trim());
                    this.inputBuffer = "";
                } else {
                    // No cache or empty input, pass through
                    this.ptyProcess.write(input);
                    this.inputBuffer = "";
                }
            } else if (input.includes("\r") || input.includes("\n")) {
                // Input contains newline but with other characters - pass through
                if (this.debugLogger) {
                    this.debugLogger.log(
                        `Mixed input with newline detected, passing through: ${JSON.stringify(input)}`,
                    );
                }
                this.ptyProcess.write(input);
                this.inputBuffer = "";
                this.lastInputWasCarriageReturn = false;
            } else {
                // Buffer the input and pass it through to PTY for echo
                this.inputBuffer += input;
                this.ptyProcess.write(input);
                this.lastInputWasCarriageReturn = false;
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
     * Handle a command - check cache first, then forward to assistant if needed
     */
    private async handleCommand(command: string): Promise<void> {
        // Prevent concurrent execution - skip if already processing
        if (this.processingCommand) {
            if (this.debugLogger) {
                this.debugLogger.log(
                    `Skipping duplicate command (already processing): "${command}"`,
                );
            }
            return;
        }

        this.processingCommand = true;
        try {
            await this.handleCommandInternal(command);
        } finally {
            this.processingCommand = false;
        }
    }

    private async handleCommandInternal(command: string): Promise<void> {
        if (!this.cacheClient || !this.ptyProcess) {
            // No cache client or process, just forward
            if (this.debugLogger) {
                this.debugLogger.log(
                    "No cache client or pty process, forwarding to assistant",
                );
            }
            this.ptyProcess?.write("\r");
            return;
        }

        // Immediately provide feedback by echoing the command
        // This happens BEFORE the cache check so user sees response immediately
        const terminalWidth = process.stdout.columns || 80;
        const grayColor = "\x1b[90m"; // ANSI gray color
        const resetColor = "\x1b[0m"; // Reset to default color
        const separator = grayColor + "─".repeat(terminalWidth) + resetColor;

        // Clear current input line and echo the command with prompt prefix (no separator after)
        process.stdout.write("\r\x1b[K");
        process.stdout.write(`> ${command}\n`);

        const startTime = performance.now();

        if (this.debugLogger) {
            this.debugLogger.log(`Handling command: "${command}"`);
        }

        try {
            const cacheResult = await this.cacheClient.checkCache(command);
            const elapsedMs = performance.now() - startTime;

            if (cacheResult.hit && cacheResult.result) {
                // Cache hit! The command was already echoed above, now print the output

                if (this.debugLogger) {
                    this.debugLogger.log(
                        `✓ Cache HIT (${elapsedMs.toFixed(2)}ms) - printing result to terminal`,
                    );
                    // Print timing indicator on its own line BEFORE any separator
                    process.stdout.write(`(${Math.round(elapsedMs)}ms)\n`);
                }

                // Print the result (might be empty for some commands)
                if (cacheResult.result.trim()) {
                    process.stdout.write(cacheResult.result + "\n");
                }

                // Print separator line before prompt (gray)
                process.stdout.write(separator + "\n");

                // Print prompt and immediately save cursor position
                process.stdout.write("> ");
                process.stdout.write("\x1b7"); // Save cursor position (after prompt)

                // Print separator line after prompt (gray) on next line
                process.stdout.write("\n" + separator);

                // Restore cursor to saved position (after the prompt)
                process.stdout.write("\x1b8"); // Restore cursor position
            } else {
                // Cache miss - forward to assistant
                if (this.debugLogger) {
                    this.debugLogger.log(
                        `✗ Cache MISS (${elapsedMs.toFixed(2)}ms): ${cacheResult.error}`,
                    );
                    this.debugLogger.log("Forwarding to assistant");
                }

                // Forward the command normally
                this.ptyProcess.write("\r");
            }
        } catch (error) {
            const elapsedMs = performance.now() - startTime;
            // Error checking cache - fall back to forwarding
            if (this.debugLogger) {
                this.debugLogger.error(
                    `Cache check error (${elapsedMs.toFixed(2)}ms)`,
                    error,
                );
                this.debugLogger.log("Forwarding to assistant after error");
            }
            this.ptyProcess.write("\r");
        }
    }

    /**
     * Kill the assistant process
     */
    kill(signal?: string): void {
        if (this.debugLogger) {
            this.debugLogger.log("Kill requested");
        }

        if (this.ptyProcess) {
            console.log(`\n[CoderWrapper] Killing ${this.config.name}...`);
            this.ptyProcess.kill(signal);
            this.ptyProcess = null;
        }
        // Close cache client
        if (this.cacheClient) {
            this.cacheClient.close().catch(console.error);
            this.cacheClient = null;
        }
        // Close debug logger
        if (this.debugLogger) {
            this.debugLogger.close();
            this.debugLogger = null;
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
