// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CollaborationManager } from "../src/view/route/collaborationManager.js";

describe("markdown document operations", () => {
    test("applies generated markdown without a connected view client", () => {
        const manager = new CollaborationManager();
        manager.initializeDocument("cli-document", null);

        const content = manager.applyOperations("cli-document", [
            {
                type: "insert",
                position: 0,
                content: [
                    {
                        type: "heading",
                        attrs: { level: 1 },
                        content: [
                            {
                                type: "text",
                                text: "CLI validation",
                            },
                        ],
                    },
                    {
                        type: "bullet_list",
                        content: [
                            {
                                type: "list_item",
                                content: [
                                    {
                                        type: "paragraph",
                                        content: [
                                            {
                                                type: "text",
                                                text: "Created headlessly.",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ]);

        expect(content).toBe("# CLI validation\n\n- Created headlessly.\n\n");
        expect(manager.getDocumentContent("cli-document")).toBe(content);
    });

    test("applies a batch atomically when an operation is invalid", () => {
        const manager = new CollaborationManager();
        manager.initializeDocument("atomic-document", null);
        manager.setDocumentContent("atomic-document", "original");

        expect(() =>
            manager.applyOperations("atomic-document", [
                {
                    type: "insert",
                    position: 8,
                    content: [{ type: "text", text: " updated" }],
                },
                {
                    type: "delete",
                    from: 5,
                    to: 3,
                },
            ]),
        ).toThrow("Invalid document range");
        expect(manager.getDocumentContent("atomic-document")).toBe("original");
    });
});
