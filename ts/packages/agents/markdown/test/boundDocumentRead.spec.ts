// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    computeContentRevision,
    readBoundDocument,
    type DocumentBinding,
} from "../src/agent/documentUpdatePersistence.js";

describe("asynchronous bound document reads", () => {
    let temporaryDirectory: string;
    let binding: DocumentBinding;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-read-"),
        );
        const root = path.join(temporaryDirectory, "workspace");
        fs.mkdirSync(root);
        const filePath = path.join(fs.realpathSync(root), "plan.md");
        fs.writeFileSync(filePath, "original");
        binding = {
            token: "binding",
            root: fs.realpathSync(root),
            relativePath: "plan.md",
            filePath,
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test("reads a large UTF-8 document without synchronous content I/O", async () => {
        const content = "# Large 😀 document\n".repeat(200_000);
        fs.writeFileSync(binding.filePath, content);
        const syncRead = jest.spyOn(fs, "readFileSync");
        const result = await readBoundDocument(binding);
        expect(result).toEqual({
            content,
            filePath: binding.filePath,
            revision: computeContentRevision(content),
        });
        expect(syncRead).not.toHaveBeenCalledWith(binding.filePath, "utf-8");
    });

    test("missing nested documents do not create directories", async () => {
        binding.relativePath = "missing/nested/plan.md";
        binding.filePath = path.join(binding.root, binding.relativePath);
        await expect(readBoundDocument(binding)).rejects.toThrow(
            /binding changed/,
        );
        expect(fs.existsSync(path.join(binding.root, "missing"))).toBe(false);
    });

    async function readWhileSuspended(
        phase: "open" | "close",
        mutate: () => void,
    ) {
        let pause!: () => void;
        let resume!: () => void;
        const paused = new Promise<void>((resolve) => {
            pause = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
            resume = resolve;
        });
        const open = fs.promises.open;
        jest.spyOn(fs.promises, "open").mockImplementationOnce(
            async (...args) => {
                const handle = await open(...args);
                if (phase === "open") {
                    pause();
                    await resumed;
                } else {
                    const close = handle.close.bind(handle);
                    jest.spyOn(handle, "close").mockImplementationOnce(
                        async () => {
                            await close();
                            pause();
                            await resumed;
                        },
                    );
                }
                return handle;
            },
        );
        const reading = readBoundDocument(binding);
        await paused;
        try {
            mutate();
        } finally {
            resume();
        }
        return reading;
    }

    test.each(["open", "close"] as const)(
        "rejects a replaced file during %s",
        async (phase) => {
            await expect(
                readWhileSuspended(phase, () => {
                    fs.renameSync(binding.filePath, binding.filePath + ".old");
                    fs.writeFileSync(binding.filePath, "replacement");
                }),
            ).rejects.toThrow(/binding file changed/);
        },
    );

    test("rejects in-place content changes while closing", async () => {
        await expect(
            readWhileSuspended("close", () => {
                fs.writeFileSync(binding.filePath, "changed document");
            }),
        ).rejects.toThrow(/revision mismatch/);
    });

    test("rejects a root rebound to a junction while closing", async () => {
        const outside = path.join(temporaryDirectory, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "plan.md"), "outside");
        await expect(
            readWhileSuspended("close", () => {
                fs.renameSync(binding.root, binding.root + ".old");
                fs.symlinkSync(outside, binding.root, "junction");
            }),
        ).rejects.toThrow(/workspace root changed/);
    });

    test("rejects a root replacement even if the same file is moved back", async () => {
        await expect(
            readWhileSuspended("close", () => {
                fs.renameSync(binding.root, binding.root + ".old");
                fs.mkdirSync(binding.root);
                fs.renameSync(
                    path.join(binding.root + ".old", "plan.md"),
                    binding.filePath,
                );
            }),
        ).rejects.toThrow(/workspace root changed/);
    });
});
