// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod/v4";

export const WorkspaceCommandInputSchema = z.object({
    command: z
        .string()
        .min(1)
        .max(16 * 1024)
        .refine((value) => Buffer.byteLength(value, "utf8") <= 16 * 1024, {
            message: "command must not exceed 16384 UTF-8 bytes",
        })
        .describe(
            "Exact shell command to execute, for example `pnpm test -- --runInBand`.",
        ),
    workspaceFolder: z
        .string()
        .min(1)
        .optional()
        .describe(
            "Open workspace-root name or absolute path. Required when multiple roots are open and no active editor identifies one.",
        ),
    workingDirectory: z
        .string()
        .min(1)
        .optional()
        .describe(
            "Optional path relative to the selected workspace root. It must remain inside that root.",
        ),
    commandRiskLevel: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe(
            "Optional declared command-risk level. High-risk commands are blocked; structured execution also restricts commands to focused build, test, lint, and diagnostic tools.",
        ),
    timeoutMs: z
        .number()
        .int()
        .positive()
        .max(5 * 60 * 1000)
        .optional()
        .describe(
            "Maximum execution time in milliseconds. Defaults to 120000 and is capped at 300000.",
        ),
    executionId: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .describe(
            "Optional unique caller-generated ID used to correlate this command and cancel it later. One is assigned when omitted, and returned in the result.",
        ),
});

export type WorkspaceCommandInput = z.infer<typeof WorkspaceCommandInputSchema>;

export const WorkspaceCommandResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().nonnegative(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    stdout: z.object({
        text: z.string(),
        truncated: z.boolean(),
        totalBytes: z.number().int().nonnegative(),
    }),
    stderr: z.object({
        text: z.string(),
        truncated: z.boolean(),
        totalBytes: z.number().int().nonnegative(),
    }),
    timedOut: z.boolean(),
    cancelled: z.boolean(),
    executionId: z.string().min(1).max(128),
});

export type WorkspaceCommandResult = z.infer<
    typeof WorkspaceCommandResultSchema
>;

export const CancelWorkspaceCommandInputSchema = z.object({
    executionId: z
        .string()
        .min(1)
        .max(128)
        .describe("The executionId returned or assigned to a running command."),
});

export type CancelWorkspaceCommandInput = z.infer<
    typeof CancelWorkspaceCommandInputSchema
>;

export const CancelWorkspaceCommandResultSchema = z.object({
    success: z.boolean(),
    error: z.string().optional(),
    cancelled: z.boolean(),
    pendingCancellation: z.boolean(),
    executionId: z.string().min(1).max(128),
});
