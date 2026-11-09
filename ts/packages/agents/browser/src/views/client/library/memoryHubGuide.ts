// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TroubleshootingGuideContent } from "@typeagent/memory-service";
import { rbField, rbNode } from "./memoryHubDocumentUi";

export function createGuideEditor(
    original: TroubleshootingGuideContent,
    changed: () => void,
) {
    const content: TroubleshootingGuideContent = JSON.parse(
        JSON.stringify(original),
    );
    const element = rbNode("section");
    element.setAttribute("aria-label", "Troubleshooting guide editor");
    element.append(
        rbField("View title", content.title, (value) => {
            content.title = value;
            changed();
        }),
    );
    for (const section of content.sections) {
        const row = rbNode("section");
        row.append(
            rbField(`Heading ${section.id}`, section.heading, (value) => {
                section.heading = value;
                changed();
            }),
            rbField(
                `Narrative ${section.id}`,
                section.body,
                (value) => {
                    section.body = value;
                    changed();
                },
                { multiline: true },
            ),
        );
        element.append(row);
    }
    for (const label of element.querySelectorAll("label"))
        label
            .querySelector("input,textarea")
            ?.setAttribute("aria-label", label.textContent ?? "");
    return { element, read: () => content };
}
