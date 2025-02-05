// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import {
    downloadArxivPaper,
    fetchArxivPapers,
    extractTextChunksFromPdf,
    printArxivPaperParsedData,
} from "./docuProc.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

console.log("Lets start processing your documents ...");
const papers: any[] | undefined = await fetchArxivPapers({
    searchTerm: "transformer",
    searchField: "title",
    maxResults: 1,
});
if (papers !== undefined && papers.length > 0) {
    console.log(`Found ${papers.length} papers`);
    console.log("Downloading papers ...");
    console.log("---------------------------------");

    printArxivPaperParsedData(papers);
    papers.forEach(async (paper) => {
        try {
            const pdfFilePath: string | undefined =
                await downloadArxivPaper(paper);
            if (pdfFilePath !== undefined) {
                await extractTextChunksFromPdf(pdfFilePath);
            }
        } catch (error) {
            console.error("Error downloading paper:", error);
        }
    });
}
