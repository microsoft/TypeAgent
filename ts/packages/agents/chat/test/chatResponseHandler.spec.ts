// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    getAttachmentFileName,
    rehydrateImages,
} from "../src/chatResponseHandler.js";

type ReadFn = (path: string) => Promise<string | undefined>;

// Build a minimal ActionContext whose sessionStorage.read is driven by `read`
// and records the paths it was asked to read.
function createMockContext(read: ReadFn): {
    context: ActionContext;
    reads: string[];
} {
    const reads: string[] = [];
    const context = {
        sessionContext: {
            sessionStorage: {
                read: (path: string) => {
                    reads.push(path);
                    return read(path);
                },
            },
        },
    } as unknown as ActionContext;
    return { context, reads };
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

describe("rehydrateImages", () => {
    it("skips a related file missing from user_files instead of throwing", async () => {
        const { context, reads } = createMockContext(() => {
            return Promise.reject(new Error("ENOENT"));
        });

        const html = await rehydrateImages(context, [
            "pipelines/azure-build-docker-container.yml",
        ]);

        expect(html).toBe("<div></div>");
        // The forward-slash path is reduced to its base name before lookup.
        expect(reads).toEqual([
            "\\..\\user_files\\azure-build-docker-container.yml",
        ]);
    });

    it("embeds an uploaded image that exists in user_files", async () => {
        const { context } = createMockContext(() => Promise.resolve("AAAA"));

        const html = await rehydrateImages(context, ["cat.png"]);

        expect(html).toContain("base64,AAAA");
    });

    it("keeps embedding later files after skipping a missing one", async () => {
        const { context } = createMockContext((path) =>
            path.endsWith("missing.yml")
                ? Promise.reject(new Error("ENOENT"))
                : Promise.resolve("BBBB"),
        );

        const html = await rehydrateImages(context, ["missing.yml", "dog.png"]);

        expect(html).toContain("base64,BBBB");
    });
});
