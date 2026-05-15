// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PackageInputs } from "./packageInputs.js";
import {
    assembleDocumentationPrompt,
    type AssembledPrompt,
    type PromptOptions,
} from "./promptAssembly.js";
import {
    validateDocumentation,
    type DocumentationValidation,
} from "./documentationValidation.js";
import { repairOutput } from "./repairOutput.js";

/**
 * Minimal subset of aiclient's ChatModel that this generator depends
 * on. Declared structurally so tests can pass a plain object without
 * pulling aiclient in.
 */
export interface DocumentationChatModel {
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

export type DocumentationStatus =
    | "ok"
    | "ok-with-warnings"
    | "model-error"
    | "validation-failed";

export interface DocumentationResult {
    status: DocumentationStatus;
    /** The documentation body to embed (always defined; falls back to a placeholder on failure). */
    body: string;
    /** True when `body` is a deterministic placeholder and no LLM text was retained. */
    isPlaceholder: boolean;
    validation: DocumentationValidation | undefined;
    attempts: number;
    diagnostics: string[];
    prompt: AssembledPrompt;
}

export interface GenerateDocumentationOptions {
    promptOptions?: PromptOptions;
    /** Maximum number of attempts including the first. Default: 3 (two retries). */
    maxAttempts?: number;
}

/**
 * Generate the AI-authored documentation body via the supplied chat
 * model. Returns a structured result describing what happened so
 * callers can log it.
 *
 * On any failure (model error, validation never passing) the body
 * falls back to a deterministic placeholder so the file is still
 * publishable.
 */
export async function generateDocumentation(
    inputs: PackageInputs,
    referenceMarkdown: string,
    model: DocumentationChatModel,
    options: GenerateDocumentationOptions = {},
): Promise<DocumentationResult> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    const prompt = await assembleDocumentationPrompt(
        inputs,
        referenceMarkdown,
        options.promptOptions,
    );
    const diagnostics: string[] = [];

    let lastValidation: DocumentationValidation | undefined;
    let priorViolations: string[] = [];
    let lastModelError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const messages: ChatPromptSection[] = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ];
        if (priorViolations.length > 0) {
            messages.push({
                role: "system",
                content: `The previous draft was rejected by the structural validator. Fix every issue below and emit a fresh documentation body.\n\n- ${priorViolations.join("\n- ")}`,
            });
        }

        const result = await model.complete(messages);
        if (!result.success) {
            // Treat model errors (rate limits, transient 5xx, network
            // blips) the same as validation failures: spend a retry
            // attempt rather than burning the whole budget on one bad
            // response. Only emit the placeholder if every attempt
            // also fails.
            lastModelError = result.message;
            diagnostics.push(
                `Attempt ${attempt}: model error: ${result.message}`,
            );
            priorViolations = [];
            continue;
        }

        const candidate = repairOutput(stripExtraneous(result.data));
        const validation = validateDocumentation(candidate);
        lastValidation = validation;
        lastModelError = undefined;

        if (validation.valid) {
            const status: DocumentationStatus =
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

    // All attempts exhausted. Distinguish "model never returned a
    // successful response" from "model returned but validator rejected
    // every draft" so callers can decide whether to preserve any
    // existing on-disk content.
    return {
        status:
            lastModelError !== undefined ? "model-error" : "validation-failed",
        body: placeholderBody(inputs),
        isPlaceholder: true,
        validation: lastValidation,
        attempts: maxAttempts,
        diagnostics,
        prompt,
    };
}

/**
 * Strip incidental scaffolding the LLM sometimes emits despite
 * instructions: leading/trailing whitespace, an H1 line, or a stray
 * `## (AI )?Overview` heading inserted before the actual section
 * content.
 *
 * Removing the H1 lets a model accidentally emit a title without
 * tripping validation. Other heading shapes are preserved — the
 * multi-section validator handles them.
 */
function stripExtraneous(raw: string): string {
    let s = raw.trim();
    // Strip a leading H1 (e.g. "# discord-agent\n\n").
    s = s.replace(/^\s*#\s+[^\n]+\r?\n+/u, "");
    // Strip a leading "## (AI )?Documentation" or similar
    // "title-shaped" H2 the model may invent before the real
    // ## Overview section.
    s = s.replace(/^\s*##\s+(?:AI\s+)?(?:Documentation|README)\s*\r?\n+/iu, "");
    return s.trim();
}

function placeholderBody(inputs: PackageInputs): string {
    const desc =
        inputs.description?.trim() ||
        `Workspace package \`${inputs.pkg.name}\`.`;
    const lines: string[] = [];
    lines.push("## Overview");
    lines.push("");
    lines.push(
        "> 📝 **Placeholder documentation — AI authoring failed.** Re-run with `--llm` to retry, or replace with hand-written prose. The deterministic Reference section below is already populated.",
    );
    lines.push("");
    lines.push(desc);
    lines.push("");
    if (inputs.readmeContext.exists && inputs.readmeContext.handAuthored) {
        lines.push(
            "See [`./README.md`](./README.md) for the hand-written documentation.",
        );
        lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
}
