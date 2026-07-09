// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared TypeChat structured-output helper for the offline "distiller family"
// (keyword / guideline / lever / corpus authoring): a one-shot LLM call that
// returns a typed JSON object validated — and auto-repaired — against a
// TypeScript schema, or `undefined` on any failure so callers can fall back
// deterministically. The model is injected (not created here) so callers keep a
// unit-testable seam; this is never on a collision hot path.

import { createJsonTranslator, TypeChatLanguageModel } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

// Distill a `typeName`-shaped object from `request` via TypeChat. `schemaText` is
// TypeScript source that defines `typeName`; TypeChat appends it to the prompt
// and validates (repairing once) the model's JSON against it. Returns `undefined`
// when the model errors, throws, or the response can't be validated/repaired —
// the caller decides the fallback.
export async function distillJson<T extends object>(
    model: TypeChatLanguageModel,
    request: string,
    schemaText: string,
    typeName: string,
): Promise<T | undefined> {
    try {
        const validator = createTypeScriptJsonValidator<T>(
            schemaText,
            typeName,
        );
        const translator = createJsonTranslator<T>(model, validator);
        const result = await translator.translate(request);
        return result.success ? result.data : undefined;
    } catch {
        return undefined;
    }
}
