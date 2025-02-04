// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import {
    downloadArxivPaper,
    fetchArxivPapers,
    printArxivPaperParsedData,
} from "./docuProc.js";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

console.log("Lets start processing your documents ...");
const papers: any[] | undefined = await fetchArxivPapers({
    searchTerm: "transformer",
    searchField: "title",
    maxResults: 3,
});
if (papers !== undefined && papers.length > 0) {
    console.log(`Found ${papers.length} papers`);
    console.log("Downloading papers ...");
    console.log("---------------------------------");

    printArxivPaperParsedData(papers);
    papers.forEach(async (paper) => {
        try {
            await downloadArxivPaper(paper);
        } catch (error) {
            console.error("Error downloading paper:", error);
        }
    });
}
