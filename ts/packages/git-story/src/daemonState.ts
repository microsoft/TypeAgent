// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const StateSchema = z.object({
    pid: z.number().int().positive(),
    port: z.number().int().min(1).max(65535),
    token: z.string().regex(/^[0-9a-f]{64}$/),
});
export type DaemonState = z.infer<typeof StateSchema>;

export function daemonStateDirectory(): string {
    const directory =
        process.env.GIT_STORY_STATE_DIR ??
        path.join(os.homedir(), ".typeagent", "git-story");
    if (!path.isAbsolute(directory))
        throw new Error("GIT_STORY_STATE_DIR must be absolute");
    return path.normalize(directory);
}

export function readDaemonState(): DaemonState | undefined {
    try {
        return StateSchema.parse(
            JSON.parse(
                fs.readFileSync(
                    path.join(daemonStateDirectory(), "daemon.json"),
                    "utf8",
                ),
            ),
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw new Error("Cannot read daemon ownership state");
    }
}

export function writePrivateJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const fd = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(fd, JSON.stringify(value) + "\n");
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

export function removeOwnedFile(file: string, token: string): void {
    try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).token !== token) return;
        fs.unlinkSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error("Cannot remove daemon ownership state");
    }
}
