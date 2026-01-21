// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Custom audio capture for Windows with device selection support
// Based on the 'mic' package but with Windows device selection capability

import { spawn, ChildProcess } from "child_process";
import { PassThrough } from "stream";
import * as os from "os";

export interface AudioCaptureOptions {
    rate?: string;
    channels?: string;
    device?: string; // Device ID for Windows (0, 1, 2, etc.)
    debug?: boolean;
    volumeGain?: number; // Volume boost multiplier (e.g., 2.0 = 2x, 4.0 = 4x)
}

export class AudioCapture {
    private audioProcess: ChildProcess | null = null;
    private audioStream: PassThrough;
    private options: Required<AudioCaptureOptions>;
    private isWindows: boolean;

    constructor(options: AudioCaptureOptions = {}) {
        this.options = {
            rate: options.rate || "16000",
            channels: options.channels || "1",
            device: options.device || "default",
            debug: options.debug || false,
            volumeGain: options.volumeGain || 1.0, // No boost needed - Windows volume settings work fine
        };

        this.audioStream = new PassThrough();
        this.isWindows = os.type().indexOf("Windows") > -1;
    }

    start(): void {
        if (this.audioProcess !== null) {
            if (this.options.debug) {
                console.log("[AudioCapture] Already started");
            }
            return;
        }

        if (this.isWindows) {
            this.startWindows();
        } else {
            throw new Error("Only Windows is currently supported");
        }
    }

    private startWindows(): void {
        const soxPath = "C:\\Users\\stevenlucco\\tools\\sox\\sox.exe";

        // On Windows, use SoX with waveaudio
        // Add -V1 for minimal verbosity to stderr to see what SoX is actually doing
        const args = [
            "-V1", // Verbosity level 1 to see device info
            "-b",
            "16", // 16-bit
            "--endian",
            "little",
            "-c",
            this.options.channels,
            "-r",
            this.options.rate,
            "-e",
            "signed-integer",
            "-t",
            "waveaudio",
            this.options.device, // This is where we specify the device (0, 1, 2, or 'default')
            "-t",
            "raw", // Output raw PCM
            "-", // Output to stdout
            "vol",
            this.options.volumeGain.toString(), // Apply volume boost
        ];

        if (this.options.debug) {
            console.log(
                `[AudioCapture] Starting SoX with args: ${args.join(" ")}`,
            );
        }

        this.audioProcess = spawn(soxPath, args, {
            stdio: ["ignore", "pipe", "pipe"], // Always capture stderr to see SoX output
        });

        if (!this.audioProcess.stdout) {
            throw new Error("Failed to start audio process");
        }

        this.audioProcess.stdout.pipe(this.audioStream);

        // Always capture stderr to see what SoX is doing
        if (this.audioProcess.stderr) {
            this.audioProcess.stderr.on("data", (data) => {
                const output = data.toString();
                // Only show INFO lines (device info, format)
                if (output.includes("INFO") || output.includes("waveaudio")) {
                    console.log("[AudioCapture]", output.trim());
                }
                if (this.options.debug) {
                    console.log("[AudioCapture] SoX stderr:", output);
                }
            });
        }

        this.audioProcess.on("exit", (code, signal) => {
            if (code !== null && signal === null) {
                this.audioStream.emit("audioProcessExitComplete");
                if (this.options.debug) {
                    console.log(
                        `[AudioCapture] Process exited with code ${code}`,
                    );
                }
            }
        });

        this.audioStream.emit("startComplete");
    }

    stop(): void {
        if (this.audioProcess !== null) {
            this.audioProcess.kill("SIGTERM");
            this.audioProcess = null;
            this.audioStream.emit("stopComplete");
            if (this.options.debug) {
                console.log("[AudioCapture] Stopped");
            }
        }
    }

    getAudioStream(): PassThrough {
        return this.audioStream;
    }
}
