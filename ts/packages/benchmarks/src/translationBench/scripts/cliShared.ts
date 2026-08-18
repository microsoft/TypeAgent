// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    createRateLimiter,
    type RateLimiter,
    type TpmLimits,
} from "../../core/rateLimiter.js";
import {
    DEFAULT_EST_TOKENS_PER_CALL,
    defaultRateLimiterDbPath,
    loadRunConfigFile,
    resolveRunConfig,
    type ResolvedRunConfig,
} from "../runConfig.js";

export function loadDotEnvFiles(files: readonly string[]): void {
    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eq = trimmed.indexOf("=");
            if (eq <= 0) continue;
            const key = trimmed.slice(0, eq).trim();
            let value = trimmed.slice(eq + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    }
}

export function ensureParentDir(filePath: string): void {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export function resolveExistingFile(filePath: string, label: string): string {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`${label} not found: ${resolved}`);
    }
    return resolved;
}

export function loadResolvedConfig(options: {
    config?: string;
    batch?: string;
    headroom?: number;
}): { configPath: string | undefined; resolved: ResolvedRunConfig } {
    const configPath =
        options.config !== undefined ? path.resolve(options.config) : undefined;
    const file = configPath !== undefined ? loadRunConfigFile(configPath) : {};
    const resolveOptions: {
        batch?: string;
        headroom?: number;
    } = {};
    if (options.batch !== undefined) resolveOptions.batch = options.batch;
    if (options.headroom !== undefined)
        resolveOptions.headroom = options.headroom;
    return {
        configPath,
        resolved: resolveRunConfig(file, resolveOptions),
    };
}

export function createRunnerRateLimiter(
    tpmLimits: TpmLimits,
    options?: {
        dbPath?: string;
        estTokensPerCall?: number;
        disabled?: boolean;
    },
): RateLimiter | undefined {
    if (options?.disabled === true) {
        return undefined;
    }
    if (Object.keys(tpmLimits).length === 0) {
        return undefined;
    }
    const limiterOptions: {
        dbPath: string;
        estTokensPerCall: number;
        onWait: (model: string, waitedMs: number, waitMs: number) => void;
    } = {
        dbPath: options?.dbPath ?? defaultRateLimiterDbPath(),
        estTokensPerCall:
            options?.estTokensPerCall ?? DEFAULT_EST_TOKENS_PER_CALL,
        onWait: (model, waitedMs, waitMs) => {
            if (waitedMs === 0 || waitedMs % 5_000 < waitMs) {
                console.error(
                    `[rate-limit] ${model} waiting ~${Math.ceil(waitMs)}ms (elapsed ${Math.ceil(waitedMs)}ms)`,
                );
            }
        },
    };
    return createRateLimiter(tpmLimits, limiterOptions);
}

export function defaultInstanceDir(kind: "eval" | "generate"): string {
    return path.join(
        os.tmpdir(),
        "typeagent-benchmarks",
        `${kind}-${process.pid}`,
    );
}

export function parseCsvList(value: string | undefined): string[] | undefined {
    if (value === undefined || value.trim() === "") return undefined;
    return value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
