// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ArxivQuery } from "./docuProcSchema.js";
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "aiclient";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export async function fetchArxivPapers(
    query: ArxivQuery,
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
        max_results: String(query.maxResults ?? 5),
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

export async function downloadArxivPaper(paper: ArxivPaper) {
    const arxivInfo = getPdfUrlFromId(paper.id);

    const outputDir = path.join(__dirname, "papers");
    const filePath = path.join(
        outputDir,
        `${getValidFilename(arxivInfo.paperId)}.pdf`,
    );

    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

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
        fs.writeFileSync(filePath, buffer);

        console.log(`Downloaded paper: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error("Error downloading paper:", error);
        return null;
    }
}
