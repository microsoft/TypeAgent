// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sharp from "sharp";

describe("shared Sharp native runtime", () => {
    test("preserves image metadata and aspect ratio during the image knowledge resize path", async () => {
        const source = await sharp({
            create: {
                width: 40,
                height: 20,
                channels: 3,
                background: "#3399cc",
            },
        })
            .png()
            .withMetadata({ density: 144 })
            .toBuffer();
        const image = sharp(source, { failOn: "error" });
        expect(await image.metadata()).toMatchObject({
            width: 40,
            height: 20,
            format: "png",
            density: 144,
        });
        const resized = await image
            .resize(16, 16, { fit: "inside" })
            .withMetadata()
            .toBuffer();
        expect(await sharp(resized).metadata()).toMatchObject({
            width: 16,
            height: 8,
            format: "png",
            density: 144,
        });
    });
});
