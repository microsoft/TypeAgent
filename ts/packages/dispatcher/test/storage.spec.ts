// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getStorage } from "../src/execute/storageImpl.js";
import { uint8ArrayToBase64 } from "common-utils";

const tempDir = path.join(os.tmpdir(), ".typeagent");
try {
    await fs.promises.mkdir(tempDir, { recursive: true });
} catch {}

describe("Storage", () => {
    const storage = getStorage("test", tempDir);
    const fileName = "test.data";
    beforeEach(async () => {
        try {
            await storage.delete(fileName);
        } catch {}
    });
    afterEach(async () => {
        try {
            await storage.delete(fileName);
        } catch {}
    });
    it("read/write utf8", async () => {
        const text = "hello world";
        await storage.write(fileName, text);
        expect(await storage.read(fileName, "utf8")).toStrictEqual(text);
    });

    it("read/write binary", async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        await storage.write(fileName, data);
        const readData = await storage.read(fileName);

        // Node return a Buffer (which works the same as Uint8Array)
        const checkData = new Uint8Array(readData.buffer);
        expect(checkData).toStrictEqual(data);
    });

    it("read/write base64", async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const base64 = uint8ArrayToBase64(data);
        await storage.write(fileName, base64, "base64");
        expect(await storage.read(fileName, "base64")).toStrictEqual(base64);

        // The file itself should be binary.
        const readData = await storage.read(fileName);

        // Node return a Buffer (which looks the same as Uint8Array)
        const checkData = new Uint8Array(readData.buffer);
        expect(checkData).toStrictEqual(data);
    });
});
