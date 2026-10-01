// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// One log file per process kind per local day. Old days are pruned.
//
//   ~/.typeagent/git-story/logs/
//   ├─ 26/09/29/daemon.log     kept (yesterday)
//   └─ 26/09/30/
//      ├─ cli.log              2026-09-30T19:02:11.412Z INFO  [4120] Started (pid 4133) ...
//      └─ daemon.log           2026-09-30T19:02:11.398Z ERROR [4133] Cannot listen on port 51703: ...
//
// Retention is read from ~/.typeagent/git-story/config.json, e.g.
// { "logs": { "retentionDays": 2 } }. git-story never writes this file; when it
// is missing or invalid, 2 days (today and yesterday) are kept.
export const GIT_STORY_DIR = path.join(os.homedir(), ".typeagent", "git-story");
const LOGS_DIR = "logs";
const CONFIG_FILE = "config.json";
const DEFAULT_RETENTION_DAYS = 2;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 365;
const DAY_DIRECTORY = /^\d{2}$/;

export type ProcessName = "cli" | "daemon";
type Level = "INFO" | "WARN" | "ERROR";

export interface Logger {
    readonly file: () => string;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export function createLogger(
    name: ProcessName,
    options: { dir?: string; now?: () => Date } = {},
): Logger {
    const dir = options.dir ?? GIT_STORY_DIR;
    const root = path.join(dir, LOGS_DIR);
    const now = options.now ?? (() => new Date());
    let prunedDay: string | undefined;

    // Fall back to the system clock if an injected clock fails.
    const currentDate = () => {
        try {
            const date = now();
            return Number.isNaN(date.getTime()) ? new Date() : date;
        } catch {
            return new Date();
        }
    };

    // Prune once per local day, including for a long-running daemon.
    const file = (date = currentDate()) => {
        const day = dayParts(date);
        const key = day.join("/");
        if (key !== prunedDay) {
            prunedDay = key;
            try {
                prune(root, date, retentionDays(dir));
            } catch {
                // Logging never fails because pruning failed.
            }
        }
        try {
            return path.join(root, ...day, `${name}.log`);
        } catch {
            return `${name}.log`;
        }
    };

    // Logging is best effort and never changes the caller's control flow.
    const write = (level: Level, message: string) => {
        try {
            const date = currentDate();
            const target = file(date);
            const singleLine = message
                .replaceAll("\r", "\\r")
                .replaceAll("\n", "\\n");
            fs.mkdirSync(path.dirname(target), {
                recursive: true,
                mode: 0o700,
            });
            fs.appendFileSync(
                target,
                `${date.toISOString()} ${level.padEnd(5)} [${process.pid}] ${singleLine}\n`,
                { mode: 0o600 },
            );
        } catch {
            // Ignore filesystem and formatting errors.
        }
    };

    return {
        file: () => file(),
        info: (message) => write("INFO", message),
        warn: (message) => write("WARN", message),
        error: (message) => write("ERROR", message),
    };
}

// Invalid values use the default; valid integers are limited to one year.
function retentionDays(dir: string): number {
    let value: unknown;
    try {
        const config = JSON.parse(
            fs.readFileSync(path.join(dir, CONFIG_FILE), "utf8"),
        ) as {
            logs?: { retentionDays?: unknown };
        };
        value = config?.logs?.retentionDays;
    } catch {
        return DEFAULT_RETENTION_DAYS;
    }
    if (!Number.isInteger(value)) return DEFAULT_RETENTION_DAYS;
    return Math.min(
        MAX_RETENTION_DAYS,
        Math.max(MIN_RETENTION_DAYS, value as number),
    );
}

// Local date as ["yy", "mm", "dd"].
function dayParts(date: Date): [string, string, string] {
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
        pad(date.getFullYear() % 100),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ];
}

// List only real two-digit directories, never files or symbolic links.
function dayDirectories(dir: string): string[] {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isDirectory() && DAY_DIRECTORY.test(entry.name),
            )
            .map((entry) => entry.name);
    } catch {
        return [];
    }
}

// Concurrent pruning can remove the same path first.
function removeDay(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // Another process or an open Windows handle can block removal.
    }
}

// Remove a parent only when it is truly empty, including non-date entries.
function removeEmptyDirectory(dir: string): void {
    try {
        fs.rmdirSync(dir);
    } catch {
        // The directory is absent, nonempty, or in use.
    }
}

// Remove expired yy/mm/dd directories and then their empty parents.
function prune(root: string, today: Date, days: number): void {
    const oldest = new Date(today);
    oldest.setDate(oldest.getDate() - (days - 1));
    const cutoff = dayParts(oldest).join("/");
    for (const year of dayDirectories(root)) {
        const yearDir = path.join(root, year);
        for (const month of dayDirectories(yearDir)) {
            const monthDir = path.join(yearDir, month);
            for (const day of dayDirectories(monthDir)) {
                if (`${year}/${month}/${day}` < cutoff) {
                    removeDay(path.join(monthDir, day));
                }
            }
            removeEmptyDirectory(monthDir);
        }
        removeEmptyDirectory(yearDir);
    }
}

// Shared per-process loggers. cli.ts and daemonMain.ts pick one.
export const cliLogger = createLogger("cli");
export const daemonLogger = createLogger("daemon");
