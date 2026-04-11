// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isChunkedFileOrErrorItemArray } from "../src/pythonChunker.js";

describe("pythonChunker - isChunkedFileOrErrorItemArray", () => {
    test("rejects non-array values", () => {
        expect(isChunkedFileOrErrorItemArray(null)).toBe(false);
        expect(isChunkedFileOrErrorItemArray(undefined)).toBe(false);
        expect(isChunkedFileOrErrorItemArray("string")).toBe(false);
        expect(isChunkedFileOrErrorItemArray(42)).toBe(false);
        expect(isChunkedFileOrErrorItemArray({})).toBe(false);
    });

    test("accepts empty array", () => {
        expect(isChunkedFileOrErrorItemArray([])).toBe(true);
    });

    test("accepts valid ChunkerErrorItem", () => {
        const input = [{ error: "something went wrong" }];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(true);
    });

    test("accepts valid ChunkedFile with chunks", () => {
        const input = [
            {
                fileName: "foo.py",
                chunks: [
                    {
                        chunkId: "chunk-1",
                        treeName: "Module",
                        codeName: "foo",
                        blobs: [],
                        parentId: "",
                        children: [],
                        fileName: "foo.py",
                        lineNo: 1,
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(true);
    });

    test("accepts mix of ChunkedFile and ChunkerErrorItem", () => {
        const input = [
            { error: "parse error", filename: "bad.py" },
            {
                fileName: "good.py",
                chunks: [
                    {
                        chunkId: "c1",
                        treeName: "Module",
                        codeName: "good",
                        blobs: [],
                        parentId: "",
                        children: ["c2"],
                        fileName: "good.py",
                        lineNo: 1,
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(true);
    });

    test("rejects ChunkerErrorItem with non-string error", () => {
        const input = [{ error: 42 }];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects ChunkedFile missing fileName", () => {
        const input = [
            {
                chunks: [
                    {
                        chunkId: "c1",
                        treeName: "Module",
                        codeName: "foo",
                        blobs: [],
                        parentId: "",
                        children: [],
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects ChunkedFile with non-array chunks", () => {
        const input = [{ fileName: "foo.py", chunks: "not-an-array" }];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects chunk missing required fields", () => {
        // Missing 'treeName'
        const input = [
            {
                fileName: "foo.py",
                chunks: [
                    {
                        chunkId: "c1",
                        blobs: [],
                        parentId: "",
                        children: [],
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects chunk with non-array blobs", () => {
        const input = [
            {
                fileName: "foo.py",
                chunks: [
                    {
                        chunkId: "c1",
                        treeName: "Module",
                        codeName: "foo",
                        blobs: "not-array",
                        parentId: "",
                        children: [],
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects chunk with non-array children", () => {
        const input = [
            {
                fileName: "foo.py",
                chunks: [
                    {
                        chunkId: "c1",
                        treeName: "Module",
                        codeName: "foo",
                        blobs: [],
                        parentId: "",
                        children: "not-array",
                    },
                ],
            },
        ];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects array containing null", () => {
        const input = [null];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });

    test("rejects array containing primitive", () => {
        const input = ["string-element"];
        expect(isChunkedFileOrErrorItemArray(input)).toBe(false);
    });
});
