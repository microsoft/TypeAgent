// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PdfDownloadQuery } from "./pdfDownloadSchema.js";
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "aiclient";
import path from "path";
import fs from "fs";
import { OUTPUT_DIR } from "./common.js";

interface ArxivPaperAuthor {
    name: string;
    affiliation?: string;
}

interface ArxivPaper {
    id: string; // arXiv ID
    title: string;
    author: ArxivPaperAuthor[];
    summary: string;
    link: string;
    category?: string;
    primary_category?: string;
    comment?: string;
    published: string;
    journal_ref?: string;
}

const PAPER_DOWNLOAD_DIR = path.join(
    OUTPUT_DIR,
    "papers/downloads",
);

const PAPER_CATALOG_PATH = path.join(
    OUTPUT_DIR,
    "papers/downloads",
    "downloaded_papers.json",
);

function loadDownloadedPapers(): Set<string> {
    try {
        if (fs.existsSync(PAPER_CATALOG_PATH)) {
            const data = fs.readFileSync(PAPER_CATALOG_PATH, "utf8");
            return new Set(JSON.parse(data));
        }
    } catch (error) {
        console.error("Error loading downloaded papers catalog:", error);
    }
    return new Set();
}

function saveDownloadedPapersCatalog(downloadedPapers: Set<string>) {
    try {
        fs.writeFileSync(
            PAPER_CATALOG_PATH,
            JSON.stringify([...downloadedPapers], null, 2),
            "utf8",
        );
    } catch (error) {
        console.error("Error saving downloaded papers catalog:", error);
    }
}

export async function downloadArxivPapers(
    query: PdfDownloadQuery,
): Promise<any[] | undefined> {
    const apiUrl = "https://export.arxiv.org/api/query";

    let searchPrefix = "";
    switch (query.searchField) {
        case "title":
            searchPrefix = "ti:";
            break;
        case "author":
            searchPrefix = "au:";
            break;
        case "all":
        default:
            searchPrefix = "all:";
            break;
    }

    const queryParams = new URLSearchParams({
        search_query: `${searchPrefix}${query.searchTerm}`,
        start: String(query.start ?? 0),
        max_results: String(query.maxResults ?? 3),
        sortBy: query.sortBy ?? "relevance",
        sortOrder: query.sortOrder ?? "descending",
    });

    try {
        const options: RequestInit = {
            method: "GET",
            headers: {
                Accept: "application/xml",
            },
        };
        const response = await fetchWithRetry(
            `${apiUrl}?${queryParams}`,
            options,
        );

        if (!response.success) {
            throw new Error(`HTTP error! Status: ${response.message}`);
        }
        const xmlData = await response.data.text();
        if (xmlData !== undefined) {
            const parser = new XMLParser({ ignoreAttributes: false });
            const parsedXml = parser.parse(xmlData);

            const entries = parsedXml.feed.entry || [];
            const papers: ArxivPaper[] = Array.isArray(entries)
                ? entries
                : [entries];

            if (papers.length > 0) {
                const downloadedPapers = loadDownloadedPapers();
                const newPapers = papers.filter((paper) => {
                    const paperId = paper.id;
                    if (downloadedPapers.has(paperId)) {
                        return false;
                    }
                    downloadedPapers.add(paperId);
                    return true;
                });

                await Promise.all(
                    newPapers.map(
                        async (paper) => await downloadArxivPaper(paper),
                    ),
                );
                saveDownloadedPapersCatalog(downloadedPapers);
            }
            return papers;
        }
    } catch (error) {
        console.error("Error fetching arXiv papers:", error);
        return [];
    }

    return undefined;
}

export function printArxivPaperParsedData(papers: ArxivPaper[]) {
    if (papers.length === 0) {
        console.log("No papers found.");
        return;
    }

    papers.forEach((paper, index) => {
        console.log(`Paper #${index + 1}`);
        console.log("------------");

        console.log(`ID: ${paper.id}`);
        console.log(`Title: ${paper.title || "No title available"}`);
        console.log(`Summary: ${paper.summary || "No summary available"}`);

        if (paper.author?.length > 0) {
            const authors = paper.author
                .map((author) => {
                    const affiliation = author.affiliation
                        ? ` (${author.affiliation})`
                        : "";
                    return `${author.name}${affiliation}`;
                })
                .join(", ");
            console.log(`Authors: ${authors}`);
        } else {
            console.log("Authors: No authors available");
        }
    });
}

export async function createFolderIfNotExists(
    folderPath: string,
): Promise<void> {
    try {
        await fs.promises.mkdir(folderPath, { recursive: true });
        console.log(`Folder '${folderPath}' is ready.`);
    } catch (error) {
        console.error("Error creating folder:", error);
    }
}

export function getValidFilename(paperId: string): string {
    return paperId.replace(/\//g, "__");
}

export function getPaperIdFromFilename(filename: string): string {
    return filename.replace(/__/g, "/");
}

function getPdfUrlFromId(id: string): { paperId: string; downloadUrl: string } {
    const pid = id.split("/").slice(4).join("/");
    return { paperId: `${pid}`, downloadUrl: `https://arxiv.org/pdf/${pid}` };
}

export async function downloadArxivPaper(
    paper: ArxivPaper,
): Promise<string | undefined> {
    const arxivInfo = getPdfUrlFromId(paper.id);

    if(!fs.existsSync(PAPER_DOWNLOAD_DIR)) {
        fs.mkdirSync(PAPER_DOWNLOAD_DIR, { recursive: true });
    }
    
    const filePath = path.join(
        PAPER_DOWNLOAD_DIR,
        `${getValidFilename(arxivInfo.paperId)}.pdf`,
    );

    try {
        createFolderIfNotExists(PAPER_DOWNLOAD_DIR);
        const options: RequestInit = {
            method: "GET",
            headers: {
                Accept: "application/pdf",
            },
        };

        const response = await fetchWithRetry(arxivInfo.downloadUrl, options);
        if (!response.success) {
            throw new Error(`Failed to download paper: ${response.message}`);
        }

        const pdfBlob = await response.data.blob();
        const buffer = Buffer.from(await pdfBlob.arrayBuffer());
        fs.writeFileSync(filePath, buffer, { flag: "w" });

        console.log(`Downloaded paper: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error("Error downloading paper:", error);
        return undefined;
    }
}
