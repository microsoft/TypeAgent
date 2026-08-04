// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage } from "@typeagent/agent-sdk";
import path from "node:path";
import {
    getAttachmentFileName,
    isImageAttachment,
    rehydrateImageAttachments,
} from "../src/image.js";

type ReadFn = (path: string) => Promise<string | undefined>;

// Minimal Storage whose read is driven by `read` and records the paths and
// encodings it was asked for, so tests can assert on the user_files lookup.
function createStorage(read: ReadFn): {
    storage: Storage;
    reads: string[];
    encodings: (string | undefined)[];
} {
    const reads: string[] = [];
    const encodings: (string | undefined)[] = [];
    const storage = {
        read: (path: string, encoding?: string) => {
            reads.push(path);
            encodings.push(encoding);
            return read(path);
        },
    } as unknown as Storage;
    return { storage, reads, encodings };
}

describe("getAttachmentFileName", () => {
    it("strips a POSIX path to its base name", () => {
        expect(
            getAttachmentFileName("pipelines/azure-build-docker-container.yml"),
        ).toBe("azure-build-docker-container.yml");
    });

    it("strips a Windows path to its base name", () => {
        expect(getAttachmentFileName("a\\b\\photo.png")).toBe("photo.png");
    });

    it("uses the last separator when both kinds are present", () => {
        expect(getAttachmentFileName("a/b\\c/photo.png")).toBe("photo.png");
    });

    it("returns the input unchanged when there is no separator", () => {
        expect(getAttachmentFileName("photo.png")).toBe("photo.png");
    });
});

describe("isImageAttachment", () => {
    it.each(["photo.png", "a/b/PHOTO.JPG", "scan.jpeg", "art.gif"])(
        "treats %s as an image",
        (name) => {
            expect(isImageAttachment(name)).toBe(true);
        },
    );

    it.each([
        "pipelines/azure-build-docker-container.yml",
        "notes.ts",
        "styles.css",
        "README",
    ])("treats %s as a non-image", (name) => {
        expect(isImageAttachment(name)).toBe(false);
    });
});

describe("rehydrateImageAttachments", () => {
    it("embeds an uploaded image that exists in user_files", async () => {
        const { storage, encodings } = createStorage(() =>
            Promise.resolve("AAAA"),
        );

        const html = await rehydrateImageAttachments(storage, ["cat.png"]);

        // The MIME type is emitted once (regression: no doubled "image/").
        expect(html).toContain("data:image/png;base64,AAAA");
        // The image is read as base64; dropping that would corrupt the data URL.
        expect(encodings).toEqual(["base64"]);
    });

    it("skips a non-image reference without touching storage", async () => {
        const { storage, reads } = createStorage(() =>
            Promise.reject(new Error("should not be read")),
        );

        const html = await rehydrateImageAttachments(storage, [
            "pipelines/azure-build-docker-container.yml",
        ]);

        expect(html).toBe("<div></div>");
        expect(reads).toEqual([]);
    });

    it("normalizes a path to a host-correct user_files lookup", async () => {
        const { storage, reads } = createStorage(() => Promise.resolve("BBBB"));

        await rehydrateImageAttachments(storage, ["shots/dog.png"]);

        expect(reads).toEqual([path.join("..", "user_files", "dog.png")]);
    });

    it("skips an image name that is missing from user_files", async () => {
        const { storage } = createStorage(() =>
            Promise.reject(new Error("ENOENT")),
        );

        const html = await rehydrateImageAttachments(storage, ["ghost.png"]);

        expect(html).toBe("<div></div>");
    });

    it("keeps embedding later images after skipping earlier entries", async () => {
        const { storage } = createStorage((path) =>
            path.endsWith("dog.png")
                ? Promise.resolve("CCCC")
                : Promise.reject(new Error("ENOENT")),
        );

        const html = await rehydrateImageAttachments(storage, [
            undefined,
            "notes.yml",
            "ghost.png",
            "dog.png",
        ]);

        expect(html).toContain("data:image/png;base64,CCCC");
    });
});
