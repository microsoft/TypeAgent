// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PackageInputs } from "./packageInputs.js";
import {
    assembleOverviewPrompt,
    type AssembledPrompt,
    type PromptOptions,
} from "./promptAssembly.js";
import {
    validateOverview,
    type OverviewValidation,
} from "./overviewValidation.js";

/**
 * Minimal subset of aiclient's ChatModel that this generator depends
 * on. Declared structurally so tests can pass a plain object without
 * pulling aiclient in.
 */
export interface OverviewChatModel {
    complete(
        prompt: string | ChatPromptSection[],
    ): Promise<
        { success: true; data: string } | { success: false; message: string }
    >;
}

export interface ChatPromptSection {
    role: "system" | "user" | "assistant";
    content: string;
}

export type OverviewStatus =
    | "ok"
    | "ok-with-warnings"
    | "model-error"
    | "validation-failed";

export interface OverviewResult {
    status: OverviewStatus;
    /** The Overview body to embed (always defined; falls back to a placeholder on failure). */
    body: string;
    /** True when `body` is a deterministic placeholder and no LLM text was retained. */
    isPlaceholder: boolean;
    validation: OverviewValidation | undefined;
    attempts: number;
    diagnostics: string[];
    prompt: AssembledPrompt;
}

export interface GenerateOverviewOptions {
    promptOptions?: PromptOptions;
    /** Maximum number of attempts including the first. Default: 2 (one retry). */
    maxAttempts?: number;
}

/**
 * Generate an Overview body via the supplied chat model. Returns a
 * structured result describing what happened so callers can log it.
 *
 * On any failure (model error, validation never passing) the body
 * falls back to a deterministic placeholder so the README is still
 * publishable. The caller can then decide whether to write that
 * placeholder or skip the package.
 */
export async function generateOverview(
    inputs: PackageInputs,
    referenceMarkdown: string,
    model: OverviewChatModel,
    options: GenerateOverviewOptions = {},
): Promise<OverviewResult> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    const prompt = await assembleOverviewPrompt(
        inputs,
        referenceMarkdown,
        options.promptOptions,
    );
    const diagnostics: string[] = [];

    let lastValidation: OverviewValidation | undefined;
    let priorViolations: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const messages: ChatPromptSection[] = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ];
        if (priorViolations.length > 0) {
            messages.push({
                role: "system",
                content: `The previous draft was rejected by the structural validator. Fix every issue below and emit a fresh Overview body.\n\n- ${priorViolations.join("\n- ")}`,
            });
        }

        const result = await model.complete(messages);
        if (!result.success) {
            diagnostics.push(
                `Attempt ${attempt}: model error: ${result.message}`,
            );
            return {
                status: "model-error",
                body: placeholderBody(inputs),
                isPlaceholder: true,
                validation: undefined,
                attempts: attempt,
                diagnostics,
                prompt,
            };
        }

        const candidate = stripExtraneous(result.data);
        const validation = validateOverview(candidate);
        lastValidation = validation;

        if (validation.valid) {
            const status: OverviewStatus =
                validation.warnings.length > 0 ? "ok-with-warnings" : "ok";
            for (const w of validation.warnings) {
                diagnostics.push(`Attempt ${attempt}: warning: ${w}`);
            }
            return {
                status,
                body: candidate,
                isPlaceholder: false,
                validation,
                attempts: attempt,
                diagnostics,
                prompt,
            };
        }

        diagnostics.push(
            `Attempt ${attempt}: validation failed: ${validation.violations.join("; ")}`,
        );
        priorViolations = validation.violations;
    }

    return {
        status: "validation-failed",
        body: placeholderBody(inputs),
        isPlaceholder: true,
        validation: lastValidation,
        attempts: maxAttempts,
        diagnostics,
        prompt,
    };
}

/**
 * Strip the LLM's accidental scaffolding so the validator sees just
 * the prose body. Removes leading/trailing whitespace and a leading
 * "## AI Overview" (or legacy "## Overview") line if the model
 * included it despite instructions.
 */
function stripExtraneous(raw: string): string {
    let s = raw.trim();
    s = s.replace(/^\s*##\s+(?:AI\s+)?Overview\s*\r?\n+/iu, "");
    return s.trim();
}

function placeholderBody(inputs: PackageInputs): string {
    const desc =
        inputs.description?.trim() ||
        `Workspace package \`${inputs.pkg.name}\`.`;
    return `${desc}\n\n> 📝 **Placeholder Overview — AI authoring failed.** Re-run with \`--llm\` to retry, or replace with hand-written prose. The deterministic Reference section below is already populated.`;
}
