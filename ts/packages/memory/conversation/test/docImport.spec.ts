// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys, readTestFile } from "test-lib";
import {
    docPartsFromHtml,
    docPartsFromMarkdown,
    importDocMemoryFromTextFile,
} from "../src/docImport.js";
import { verifyMessages } from "./verify.js";
import { getFileName } from "typeagent";

const mdTestFile = "./test/data/aardvark.md";
const htmlTestFile = "./test/data/TypeAgent.html";

describe("docImport.offline", () => {
    const testTimeout = 5 * 60 * 1000;
    test(
        "md_parts",
        () => {
            const docPath = mdTestFile;
            const parts = docPartsFromMarkdown(
                readTestFile(docPath),
                2048,
                getFileName(docPath),
            );
            verifyMessages(parts, 23, 45);
        },
        testTimeout,
    );
    test(
        "html_parts",
        async () => {
            const docPath = htmlTestFile;
            const parts = docPartsFromHtml(
                readTestFile(docPath),
                false,
                2048,
                getFileName(docPath),
            );
            verifyMessages(parts, 26, 80);
        },
        testTimeout,
    );
});

describeIf(
    "docImport.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        test(
            "md_end2end",
            async () => {
                const docPath = mdTestFile;
                const docMemory = await importDocMemoryFromTextFile(
                    docPath,
                    2048,
                    getFileName(docPath),
                );
                verifyMessages(docMemory.messages, 23, 45);
            },
            testTimeout,
        );
        test(
            "html_end2end",
            async () => {
                const docPath = htmlTestFile;
                const docMemory = await importDocMemoryFromTextFile(
                    docPath,
                    2048,
                    getFileName(docPath),
                );
                verifyMessages(docMemory.messages, 26, 80);
            },
            testTimeout,
        );
    },
);
