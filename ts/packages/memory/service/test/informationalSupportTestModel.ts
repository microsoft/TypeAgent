// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { informationalFields } from "../src/informationalSupport.js";
import type {
    ViewBuildSnapshot,
    ViewSupportReport,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";

export async function controlledInformationalValidation(
    _input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
): Promise<ViewSupportReport> {
    return controlledInformationalSupport(output);
}

// Injected protocol approval for lifecycle tests, not factual-quality evidence.
export function controlledInformationalSupport(
    output: ViewSynthesisOutput,
): ViewSupportReport {
    return {
        supported: true,
        sections: output.content.sections.map((section) => ({
            sectionId: section.id,
            supported: true,
            reason: "Controlled section assessment",
        })),
        relationships: output.relationships.map((edge) => ({
            edgeId: edge.id,
            supported: true,
            reason: "Controlled relationship assessment",
        })),
        missingContext: [],
        reasons: [],
        informational: {
            policy: "informational-support-v1",
            fields: [...informationalFields(output).keys()].map((path) => ({
                path,
                supported: true,
                reason: "Controlled field assessment",
            })),
            issues: [],
        },
    };
}
