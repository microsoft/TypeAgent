// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import { editorialAssessmentSchema } from "../src/viewEditorial.js";

// Existing evidence-contract tests keep their original response scripts. These
// synthetic verdicts agree with those scripts; independent verdicts are tested separately.
export function withWikiChoiceResponses(model: ChatModel): ChatModel {
    let prepared: Record<string, unknown> = {};
    let detailedEditorial = false;
    const original = model.complete.bind(model);
    return {
        ...model,
        async complete(messages, usage, schema, log, signal) {
            if (
                !schema ||
                Array.isArray(schema) ||
                schema.name !== "wiki_choice_answers"
            ) {
                const result = await original(
                    messages,
                    usage,
                    schema,
                    log,
                    signal,
                );
                if (result.success) {
                    prepared = JSON.parse(result.data);
                    detailedEditorial =
                        !Array.isArray(schema) &&
                        schema?.name === "editorial_consequences" &&
                        Array.isArray(prepared.diagnostics);
                }
                return result;
            }
            if (typeof messages === "string")
                throw new Error("Expected structured Wiki decision messages");
            const request = JSON.parse(String(messages[1].content)) as {
                state: { pages?: Array<{ viewId: string }> };
                questions: Record<string, { instructions: string }>;
            };
            if ("safety" in request.questions && !detailedEditorial) {
                const result = await original(
                    [
                        {
                            role: "system",
                            content: request.questions.safety.instructions,
                        },
                        {
                            role: "user",
                            content: JSON.stringify(request.state),
                        },
                    ],
                    usage,
                    editorialAssessmentSchema(),
                    log,
                    signal,
                );
                if (!result.success) return result;
                prepared = JSON.parse(result.data);
            }
            if ("safety" in request.questions) detailedEditorial = false;
            const choices = Object.fromEntries(
                Object.keys(request.questions).map((id) => {
                    let choice: unknown;
                    if (id === "utility")
                        choice =
                            prepared.disposition === "defer" &&
                            prepared.deferBasis === "evidence"
                                ? "defer"
                                : "useful";
                    else if (id === "disposition")
                        choice = prepared.disposition;
                    else if (id === "canonical")
                        choice = prepared.canonicalViewId
                            ? `p${request.state.pages!.findIndex((page) => page.viewId === prepared.canonicalViewId)}`
                            : "none";
                    else if (id === "relation") choice = prepared.relation;
                    else if (id === "completeness") choice = prepared.status;
                    else if (id === "safety")
                        choice = prepared.safe ? "safe" : "unsafe";
                    else {
                        if (!Array.isArray(prepared.failures))
                            throw new Error("No scripted editorial categories");
                        choice = prepared.failures.includes(id)
                            ? "fail"
                            : "pass";
                    }
                    if (typeof choice !== "string")
                        throw new Error(`No scripted Wiki choice for ${id}`);
                    return [id, { type: "choice", choice }];
                }),
            );
            return {
                success: true,
                data: JSON.stringify({ answers: choices }),
            };
        },
    };
}
