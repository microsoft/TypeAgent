// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import * as Y from "yjs";
import { CollaborationManager } from "../src/view/route/collaborationManager.js";

describe("collaborative snapshot synchronization", () => {
    test.each<[string, string, string, number, number, string]>([
        ["one word", "a red fox", "a blue fox", 2, 3, "blue"],
        ["insert", "abcd", "abXYcd", 2, 0, "XY"],
        ["delete", "abXYcd", "abcd", 2, 2, ""],
        ["empty source", "", "new", 0, 0, "new"],
        ["empty target", "old", "", 0, 3, ""],
        ["no common text", "old", "new", 0, 3, "new"],
        ["shared high surrogate", "a😀z", "a😁z", 1, 2, "😁"],
        ["shared low surrogate", "a😀z", "a🨀z", 1, 2, "🨀"],
        ["emoji insert", "az", "a😀z", 1, 0, "😀"],
        ["emoji delete", "a😀z", "az", 1, 2, ""],
        ["combining mark", "cafe\u0301!", "cafe!", 4, 1, ""],
        [
            "divergent live text",
            "prefix stale suffix",
            "prefix saved suffix",
            8,
            4,
            "aved",
        ],
    ])(
        "%s changes only the differing span",
        (_name, before, after, start, count, inserted) => {
            const manager = new CollaborationManager();
            const doc = new Y.Doc();
            const text = doc.getText("content");
            text.insert(0, before);
            manager.useExistingDocument("doc", doc, null);
            const remove = jest.spyOn(text, "delete");
            const insert = jest.spyOn(text, "insert");
            const updated = jest.fn();
            doc.on("update", updated);

            manager.setDocumentContent("doc", after);

            expect(text.toString()).toBe(after);
            expect(remove.mock.calls).toEqual(count ? [[start, count]] : []);
            expect(insert.mock.calls).toEqual(
                inserted ? [[start, inserted]] : [],
            );
            expect(updated).toHaveBeenCalledTimes(1);
            doc.destroy();
        },
    );

    test("no-op emits no updates and leaves relative positions intact", () => {
        const manager = new CollaborationManager();
        const doc = new Y.Doc();
        const text = doc.getText("content");
        text.insert(0, "a red fox");
        manager.useExistingDocument("doc", doc, null);
        const prefix = Y.createRelativePositionFromTypeIndex(text, 1);
        const suffix = Y.createRelativePositionFromTypeIndex(text, 6);
        const updated = jest.fn();
        doc.on("update", updated);

        manager.setDocumentContent("doc", "a red fox");
        expect(updated).not.toHaveBeenCalled();
        manager.setDocumentContent("doc", "a blue fox");
        expect(
            Y.createAbsolutePositionFromRelativePosition(prefix, doc)?.index,
        ).toBe(1);
        expect(
            Y.createAbsolutePositionFromRelativePosition(suffix, doc)?.index,
        ).toBe(7);
        expect(updated).toHaveBeenCalledTimes(1);
        doc.destroy();
    });

    test("initializes an absent document", () => {
        const manager = new CollaborationManager();
        manager.setDocumentContent("new", "content");
        expect(manager.getDocumentContent("new")).toBe("content");
    });
});
