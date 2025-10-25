// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { MacroArtifacts } from "./types.mjs";
import { Storage } from "@typeagent/agent-sdk";

export class ArtifactsStorage {
    constructor(
        private basePath: string,
        private sessionStorage?: Storage,
    ) {}

    async saveArtifacts(
        recordingId: string,
        artifacts: {
            screenshots: string[];
            recording: any[];
            url: string;
        },
    ): Promise<void> {
        if (this.sessionStorage) {
            // Use SessionStorage when available
            const artifactsBasePath = `${this.basePath}/.artifacts/${recordingId}`;

            if (artifacts.screenshots && artifacts.screenshots.length > 0) {
                for (let index = 0; index < artifacts.screenshots.length; index++) {
                    const base64Data = artifacts.screenshots[index];
                    const match = base64Data.match(/^data:image\/png;base64,(.+)$/);
                    if (match) {
                        const buffer = Buffer.from(match[1], "base64");
                        const screenshotPath = `${artifactsBasePath}/screenshots/step-${index + 1}.png`;
                        await this.sessionStorage.write(screenshotPath, buffer);
                    }
                }
            }

            if (artifacts.recording && artifacts.recording.length > 0) {
                const recordingData: MacroArtifacts = {
                    recordingId,
                    url: artifacts.url,
                    timestamp: new Date().toISOString(),
                    screenshots: [],
                    recording: artifacts.recording,
                };

                const recordingPath = `${artifactsBasePath}/recording.json`;
                await this.sessionStorage.write(
                    recordingPath,
                    JSON.stringify(recordingData, null, 2),
                );
            }
        } else {
            // Fall back to fs for backward compatibility
            const artifactsPath = path.join(
                this.basePath,
                ".artifacts",
                recordingId,
            );

            fs.mkdirSync(path.join(artifactsPath, "screenshots"), {
                recursive: true,
            });

            if (artifacts.screenshots && artifacts.screenshots.length > 0) {
                artifacts.screenshots.forEach((base64Data, index) => {
                    const match = base64Data.match(/^data:image\/png;base64,(.+)$/);
                    if (match) {
                        const buffer = Buffer.from(match[1], "base64");
                        fs.writeFileSync(
                            path.join(
                                artifactsPath,
                                "screenshots",
                                `step-${index + 1}.png`,
                            ),
                            buffer,
                        );
                    }
                });
            }

            if (artifacts.recording && artifacts.recording.length > 0) {
                const recordingData: MacroArtifacts = {
                    recordingId,
                    url: artifacts.url,
                    timestamp: new Date().toISOString(),
                    screenshots: [],
                    recording: artifacts.recording,
                };

                fs.writeFileSync(
                    path.join(artifactsPath, "recording.json"),
                    JSON.stringify(recordingData, null, 2),
                );
            }
        }
    }

    async loadArtifacts(recordingId: string): Promise<{
        screenshot: string[];
        steps: any[];
    }> {
        if (this.sessionStorage) {
            // Use SessionStorage when available
            const artifactsBasePath = `${this.basePath}/.artifacts/${recordingId}`;
            const screenshots: string[] = [];

            // Try to load screenshots (step-1.png, step-2.png, etc.)
            for (let index = 1; index <= 100; index++) {
                // arbitrary limit
                const screenshotPath = `${artifactsBasePath}/screenshots/step-${index}.png`;
                try {
                    if (await this.sessionStorage.exists(screenshotPath)) {
                        const data = await this.sessionStorage.read(screenshotPath);
                        screenshots.push(
                            `data:image/png;base64,${Buffer.from(data).toString("base64")}`,
                        );
                    } else {
                        break; // No more screenshots
                    }
                } catch {
                    break; // Error reading, stop
                }
            }

            let recording: any[] = [];
            const recordingPath = `${artifactsBasePath}/recording.json`;

            try {
                if (await this.sessionStorage.exists(recordingPath)) {
                    const recordingContent = await this.sessionStorage.read(
                        recordingPath,
                        "utf8",
                    );
                    const recordingData = JSON.parse(recordingContent);
                    recording = recordingData.recording || recordingData.steps || [];
                }
            } catch {
                // Recording not found or error reading
            }

            return {
                screenshot: screenshots,
                steps: recording,
            };
        } else {
            // Fall back to fs for backward compatibility
            const artifactsPath = path.join(
                this.basePath,
                ".artifacts",
                recordingId,
            );

            const screenshots: string[] = [];
            const screenshotsDir = path.join(artifactsPath, "screenshots");

            if (fs.existsSync(screenshotsDir)) {
                const files = fs
                    .readdirSync(screenshotsDir)
                    .filter((f) => f.endsWith(".png"))
                    .sort();

                for (const file of files) {
                    const data = fs.readFileSync(path.join(screenshotsDir, file));
                    screenshots.push(
                        `data:image/png;base64,${data.toString("base64")}`,
                    );
                }
            }

            let recording: any[] = [];
            const recordingPath = path.join(artifactsPath, "recording.json");

            if (fs.existsSync(recordingPath)) {
                const recordingData = JSON.parse(
                    fs.readFileSync(recordingPath, "utf-8"),
                );
                recording = recordingData.recording || recordingData.steps || [];
            }

            return {
                screenshot: screenshots,
                steps: recording,
            };
        }
    }

    async artifactsExist(recordingId: string): Promise<boolean> {
        if (this.sessionStorage) {
            const recordingPath = `${this.basePath}/.artifacts/${recordingId}/recording.json`;
            return await this.sessionStorage.exists(recordingPath);
        } else {
            const artifactsPath = path.join(
                this.basePath,
                ".artifacts",
                recordingId,
            );
            return fs.existsSync(artifactsPath);
        }
    }

    async deleteArtifacts(recordingId: string): Promise<void> {
        if (this.sessionStorage) {
            // Delete recording.json and all screenshots
            const artifactsBasePath = `${this.basePath}/.artifacts/${recordingId}`;

            // Delete recording.json
            try {
                await this.sessionStorage.delete(`${artifactsBasePath}/recording.json`);
            } catch {
                // Ignore if doesn't exist
            }

            // Delete screenshots
            for (let index = 1; index <= 100; index++) {
                try {
                    const screenshotPath = `${artifactsBasePath}/screenshots/step-${index}.png`;
                    if (await this.sessionStorage.exists(screenshotPath)) {
                        await this.sessionStorage.delete(screenshotPath);
                    } else {
                        break;
                    }
                } catch {
                    break;
                }
            }
        } else {
            const artifactsPath = path.join(
                this.basePath,
                ".artifacts",
                recordingId,
            );

            if (fs.existsSync(artifactsPath)) {
                fs.rmSync(artifactsPath, { recursive: true, force: true });
            }
        }
    }
}
