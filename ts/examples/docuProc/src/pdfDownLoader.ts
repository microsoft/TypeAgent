// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { load } from "cheerio";
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
    sourcePath?: string; // path to .tar.gz
}
export interface CatalogEntryWithMeta extends CatalogEntry {
    meta: ArxivPaper;
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

/**
 * Extract the canonical arXiv identifier from any arXiv link or string.
 *
 * ✔ https://arxiv.org/abs/1706.03762v5     → "1706.03762v5"
 * ✔ https://arxiv.org/pdf/1706.03762.pdf   → "1706.03762"
 * ✔ http://export.arxiv.org/abs/cs/0101010 → "cs/0101010"
 * ✔ 1706.03762v4                           → "1706.03762v4"
 * ✔ pdf/1706.03762.pdf                     → "1706.03762"
 */
export function arxivIdFromLink(linkOrId: string): string {
    // Helper: strip leading prefixes & trailing .pdf
    const clean = (s: string) =>
        s
            .replace(/^arXiv:/i, "") // remove "arXiv:" if present
            .replace(/\.pdf$/i, "") // drop file extension
            .replace(/^abs\//, "") // "abs/1706.03762" → "1706.03762"
            .replace(/^pdf\//, ""); // "pdf/1706.03762" → "1706.03762"

    try {
        // If it parses as a URL, look for /abs/... or /pdf/...
        const { pathname } = new URL(linkOrId);
        const [, type, ...rest] = pathname.split("/"); // ["", "abs", "1706.03762v5"]
        if (type === "abs" || type === "pdf") {
            return clean(rest.join("/"));
        }
    } catch {
        /* Not a valid URL → fall through */
    }

    // Handle plain strings like "abs/1706.03762v5" or just the bare ID.
    return clean(linkOrId.trim());
}

export async function downloadArxivPaperOrig(
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

export async function downloadArxivPapersOrig(
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
                        async (paper) => await downloadArxivPaperOrig(paper),
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

export async function downloadArxivPaper(
    paper: ArxivPaper,
): Promise<CatalogEntry | undefined> {
    const { downloadUrl, paperId } = getPdfUrlFromId(paper.id);

    // Create the directory if it doesn't exist
    const validPaperId = getValidFilename(paperId);
    const paperFolder = path.join(PAPER_DOWNLOAD_DIR, validPaperId);

    await createFolderIfNotExists(paperFolder);
    const filePath = path.join(paperFolder, `${validPaperId}.pdf`);

    const metaPath = path.join(
        PAPER_DOWNLOAD_DIR,
        paperId,
        `${validPaperId}.json`,
    );
    const tmpPath = `${filePath}.tmp`;

    try {
        return await withFileLock(filePath, async () => {
            if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
                return buildEntry(undefined);
            }

            const resp = await fetchWithRetry(downloadUrl, {
                method: "GET",
                headers: { Accept: "application/pdf" },
            });
            if (!resp.success) {
                throw new Error(`Failed to download: ${resp.message}`);
            }
            const buf = Buffer.from(
                await (await resp.data.blob()).arrayBuffer(),
            );

            await fsp.writeFile(tmpPath, buf);
            await fsp.rename(tmpPath, filePath);

            await fsp.writeFile(metaPath, JSON.stringify(paper, null, 2));
            const paperTarFile = await downloadArxivSource(paper);
            return buildEntry(paperTarFile);
        });
    } catch (err) {
        console.error("Error downloading paper:", err);
        return undefined;
    }

    // helper to assemble the catalog object
    function buildEntry(paperTarFile: string | undefined): CatalogEntry {
        const paperId = arxivIdFromLink(paper.id);
        if (paperTarFile === undefined) {
            return {
                id: paperId,
                filePath,
                metaPath,
                downloadedAt: new Date().toISOString(),
                tags: deriveTags(paper), // basic tag extractor (below)
            };
        } else {
            return {
                id: paperId,
                filePath,
                metaPath,
                downloadedAt: new Date().toISOString(),
                tags: deriveTags(paper), // basic tag extractor (below)
                sourcePath: paperTarFile,
            };
        }
    }
}

function deriveTags(p: ArxivPaper): string[] {
    const tags = new Set<string>();
    if (p.primary_category) tags.add(p.primary_category);
    if (p.category) tags.add(p.category);
    return [...tags];
}

export function getPaperFolderAndTarFile(paperId: string): {
    paperFolder: string;
    paperTarFile: string;
} {
    const paperFolder = path.join(
        PAPER_DOWNLOAD_DIR,
        getValidFilename(paperId),
    );
    const paperTarFile = path.join(paperFolder, `${paperId}.tar.gz`);
    return { paperFolder, paperTarFile };
}

export function getPaperTarFilePath(paperId: string): string {
    const paperFolder = path.join(
        PAPER_DOWNLOAD_DIR,
        getValidFilename(paperId),
    );
    return path.join(paperFolder, `${paperId}.tar.gz`);
}

export async function downloadArxivSource(
    paper: ArxivPaper,
): Promise<string | undefined> {
    const arxivId = arxivIdFromLink(paper.id);
    const sourceUrl = `https://arxiv.org/e-print/${arxivId}`;
    const paperTarFile = getPaperTarFilePath(arxivId);
    const tmpPath = `${paperTarFile}.tmp`;

    try {
        return await withFileLock(paperTarFile, async () => {
            if (
                fs.existsSync(paperTarFile) &&
                fs.statSync(paperTarFile).size > 0
            ) {
                return paperTarFile;
            }

            const resp = await fetchWithRetry(sourceUrl, {
                method: "GET",
                headers: { Accept: "application/x-gzip" },
            });
            if (!resp.success) {
                console.warn(
                    `⚠️ Source not available for ${arxivId}: ${resp.message}`,
                );
                return undefined;
            }

            const buf = Buffer.from(
                await (await resp.data.blob()).arrayBuffer(),
            );
            await fsp.writeFile(tmpPath, buf);
            await fsp.rename(tmpPath, paperTarFile);

            console.log(`Downloaded LaTeX source: ${paperTarFile}`);
            return paperTarFile;
        });
    } catch (err) {
        console.error("Error downloading LaTeX source:", err);
        return undefined;
    }
}

export async function downloadArxivPapers(
    query: PdfDownloadQuery,
): Promise<ArxivPaper[]> {
    const apiUrl = "https://export.arxiv.org/api/query";

    const field = query.searchField ?? "title"; // sensible default
    const prefix =
        field === "author" ? "au:" : field === "all" ? "all:" : "ti:";

    const qs = new URLSearchParams({
        search_query: `${prefix}${query.searchTerm}`,
        start: String(query.start ?? 0),
        max_results: String(query.maxResults ?? 3),
        sortBy: query.sortBy ?? "relevance",
        sortOrder: query.sortOrder ?? "descending",
    });

    // ----- call arXiv --------------------------------------------------------
    const response = await fetchWithRetry(`${apiUrl}?${qs}`, {
        method: "GET",
        headers: { Accept: "application/xml" },
    });
    if (!response.success) {
        throw new Error(`HTTP error! Status: ${response.message}`);
    }

    // ----- parse XML ---------------------------------------------------------
    const xml = await response.data.text();
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const entries = parsed.feed?.entry ?? [];
    const papers: ArxivPaper[] = Array.isArray(entries) ? entries : [entries];
    if (papers.length === 0) return papers; // nothing found

    // ----- determine which papers are new ----------------------
    const catalog = await loadCatalog();
    const newPapers = papers.filter((p) => !catalog[arxivIdFromLink(p.id)]);

    if (newPapers.length === 0) {
        console.log("No new papers to download.");
        return papers;
    }
    console.log(`Found ${newPapers.length} new papers to download.`);

    // ----- download PDFs + metadata --------------------------------
    const newEntries = await Promise.all(
        newPapers.map((p) => downloadArxivPaper(p)),
    );

    // ----- merge new entries back into the catalog atomically ----------------
    await updateCatalog((cat) => {
        for (const entry of newEntries) {
            if (entry) cat[entry.id] = entry;
        }
    });

    return papers;
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
    const base = path.basename(filename, ".pdf");
    return base.replace(/__/g, "/");
}

function getPdfUrlFromId(id: string): { paperId: string; downloadUrl: string } {
    const pid = id.split("/").slice(4).join("/");
    return { paperId: `${pid}`, downloadUrl: `https://arxiv.org/pdf/${pid}` };
}

export async function loadCatalog(): Promise<Record<string, CatalogEntry>> {
    return withFileLock(PAPER_CATALOG_PATH, async () => {
        const raw = await fsp.readFile(PAPER_CATALOG_PATH, "utf8");
        return raw.trim() ? JSON.parse(raw) : {};
    });
}

export async function updateCatalog(
    updateEntry: (cat: Record<string, CatalogEntry>) => void,
): Promise<void> {
    return withFileLock(PAPER_CATALOG_PATH, async () => {
        const raw = await fsp.readFile(PAPER_CATALOG_PATH, "utf8");
        const catalog: Record<string, CatalogEntry> = raw.trim()
            ? JSON.parse(raw)
            : {};
        updateEntry(catalog);
        await writeJsonPretty(PAPER_CATALOG_PATH, catalog);
    });
}

export async function fetchArxivCategories(): Promise<
    Record<string, string> | undefined
> {
    const url = "https://arxiv.org/category_taxonomy";
    try {
        const response = await fetch(url);

        if (!response.ok) {
            console.error(
                `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
            );
            return undefined;
        }

        const html = await response.text();
        const $ = load(html);

        const categoryMap: Record<string, string> = {};

        $("#category_taxonomy_list h4").each((_, elem) => {
            const codeWithName = $(elem).text().trim(); // Example: "cs.CL (Computation and Language)"
            const code = codeWithName.split(" ")[0].trim(); // "cs.CL"
            const name = $(elem)
                .find("span")
                .text()
                .replace(/[()]/g, "")
                .trim(); // "Computation and Language"

            if (code && name) {
                categoryMap[code] = name;
            }
        });

        return categoryMap;
    } catch (error: any) {
        console.error(
            `Error fetching or parsing arXiv categories: ${error.message}`,
        );
        return undefined;
    }
}

export async function loadCatalogWithMeta(): Promise<
    Record<string, CatalogEntryWithMeta>
> {
    const catalog = await loadCatalog(); // Use your existing one!

    const loadMetaPromises = Object.values(catalog).map(async (entry) => {
        try {
            const metaRaw = await fsp.readFile(entry.metaPath, "utf-8");
            const metaJson = JSON.parse(metaRaw) as ArxivPaper;

            return {
                ...entry,
                meta: metaJson,
            };
        } catch (error: any) {
            console.error(
                `Failed to load meta for id ${entry.id}:`,
                error.message,
            );
            return undefined;
        }
    });

    const entriesWithMeta = await Promise.all(loadMetaPromises);

    const map: Record<string, CatalogEntryWithMeta> = {};
    for (const result of entriesWithMeta) {
        if (result) {
            map[result.id] = result;
        }
    }
    return map;
}
