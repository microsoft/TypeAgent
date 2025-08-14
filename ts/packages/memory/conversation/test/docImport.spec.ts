// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

//import { describeIf, hasTestKeys } from "test-lib";
import { importDocMemoryFromTextFile } from "../src/docImport.js";
import { verifyMessages } from "./verify.js";

describe("docImport.online", () => { //() => hasTestKeys(),
    const testTimeout = 5 * 60 * 1000;
    test(
        "md_end2end",
        async () => {
            const mdPath = "./test/data/aardvark.md";
            const docMemory = await importDocMemoryFromTextFile(
                mdPath,
                2048,
                "aardvark",
            );
            verifyMessages(docMemory.messages, 23, 45);
        },
        testTimeout,
    );
    test(
        "html_end2end",
        async () => {
            const mdPath = "./test/data/TypeAgent.html";
            const docMemory = await importDocMemoryFromTextFile(
                mdPath,
                2048,
                "TypeAgent",
            );
            verifyMessages(docMemory.messages, 26, 80);
        },
        testTimeout,
    );
});
