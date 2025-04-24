// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PdfDownloadQuery } from "./pdfDownloadSchema.js";
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "aiclient";
import path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";
import {
    PAPER_DOWNLOAD_DIR,
    PAPER_CATALOG_PATH,
    withFileLock,
} from "./common.js";
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
export interface CatalogEntry {
    id: string; // arXiv ID
    filePath: string;
    metaPath: string;
    downloadedAt: string;
    tags: string[];
}

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

export async function downloadArxivPaper(
    paper: ArxivPaper,
): Promise<string | undefined> {
    const { downloadUrl, paperId } = getPdfUrlFromId(paper.id);

    const filePath = path.join(
        PAPER_DOWNLOAD_DIR,
        `${getValidFilename(paperId)}.pdf`,
    );
    const tmpPath = `${filePath}.tmp`;

    try {
        return await withFileLock(filePath, async () => {
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                return filePath;
            }

            const options: RequestInit = {
                method: "GET",
                headers: { Accept: "application/pdf" },
            };
            const response = await fetchWithRetry(downloadUrl, options);
            if (!response.success) {
                throw new Error(
                    `Failed to download paper: ${response.message}`,
                );
            }

            const buffer = Buffer.from(
                await (await response.data.blob()).arrayBuffer(),
            );
            await fsp.writeFile(tmpPath, buffer);
            await fsp.rename(tmpPath, filePath);

            console.log(`Downloaded paper: ${filePath}`);
            return filePath;
        });
    } catch (err) {
        console.error("Error downloading paper:", err);
        return undefined;
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

export async function writeJsonPretty(
    file: string,
    data: unknown,
): Promise<void> {
    await fs.promises.writeFile(file, JSON.stringify(data, null, 2), "utf8");
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

export async function loadCatalog(): Promise<Record<string, CatalogEntry>> {
    try {
        const raw = await fs.promises.readFile(PAPER_CATALOG_PATH, "utf8");
        return JSON.parse(raw) as Record<string, CatalogEntry>;
    } catch {
        return {};
    }
}

export async function saveCatalog(
    catalog: Record<string, CatalogEntry>,
): Promise<void> {
    await writeJsonPretty(PAPER_CATALOG_PATH, catalog);
}
