// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PdfDownloadQuery } from "./pdfDownloadSchema.js";
import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry } from "aiclient";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "canvas";

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

interface PdfChunk {
    page: number;
    chunkIndex: number;
    text: string;
    imageRefs?: string[];
}

export async function fetchArxivPapers(
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
        return undefined;
    }
}

export async function extractTextChunksFromPdf(
    pdfPath: string,
    chunkSize: number = 4096,
): Promise<void> {
    try {
        let outputDir = path.join(__dirname, "papers");
        const folderName = path.parse(pdfPath).name;

        outputDir = path.join(outputDir, folderName);
        const pagesDir = path.join(outputDir, "pages");

        createFolderIfNotExists(folderName);
        createFolderIfNotExists(pagesDir);

        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const loadingTask = getDocument({ data });
        const pdfDocument = await loadingTask.promise;

        let chunkIndex = 0;
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
            const page = await pdfDocument.getPage(pageNum);
            const textContent = await page.getTextContent();
            //const operatorList = await page.getOperatorList();

            let currentText = "";
            const imageRefs: string[] = [];

            // Chunk text
            for (const item of textContent.items) {
                if ("str" in item) {
                    currentText += item.str + " ";

                    if (currentText.length >= chunkSize) {
                        // Save the current chunk as a JSON file
                        const chunk: PdfChunk = {
                            page: pageNum,
                            chunkIndex,
                            text: currentText,
                            imageRefs: imageRefs,
                        };

                        const chunkFilename = `p_${pageNum}_c_${chunkIndex}.json`;
                        fs.writeFileSync(
                            path.join(pagesDir, chunkFilename),
                            JSON.stringify(chunk, null, 2),
                        );
                        chunkIndex++;
                        currentText = "";
                    }
                }
            }

            // If any leftover text remains, store it as the last chunk
            if (currentText.length > 0) {
                const chunk: PdfChunk = {
                    page: pageNum,
                    chunkIndex,
                    text: currentText,
                    imageRefs,
                };
                const chunkFilename = `p_${pageNum}_c_${chunkIndex}.json`;
                fs.writeFileSync(
                    path.join(pagesDir, chunkFilename),
                    JSON.stringify(chunk, null, 2),
                );
            }
        }
    } catch (error) {
        console.error("Error extracting text and images:", error);
    }
}

export async function extractTextAndImages(
    pdfPath: string,
    chunkSize: number = 4096,
) {
    try {
        let outputDir = path.join(__dirname, "papers");
        const folderName = path.parse(pdfPath).name;
        outputDir = path.join(outputDir, folderName);

        // Ensure folder exists
        if (!fs.existsSync(outputDir))
            fs.mkdirSync(outputDir, { recursive: true });
        if (!fs.existsSync(path.join(outputDir, "images")))
            fs.mkdirSync(path.join(outputDir, "images"));

        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const loadingTask = getDocument({ data });
        const pdfDocument = await loadingTask.promise;

        console.log("PDF loaded");
        let chunks: PdfChunk[] = [];
        let currentText = "";
        let chunkIndex = 0;

        // Process each page of the PDF
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
            const page = await pdfDocument.getPage(pageNum);
            const textContent = await page.getTextContent();
            const operatorList = await page.getOperatorList();
            const imageRefs: string[] = [];

            // Extract text
            for (const item of textContent.items) {
                if ("str" in item) {
                    currentText += item.str + " ";
                    if (currentText.length >= chunkSize) {
                        chunks.push({
                            text: currentText,
                            page: pageNum,
                            chunkIndex,
                            imageRefs,
                        });
                        currentText = "";
                        chunkIndex++;
                    }
                }
            }

            extractImagesFromPage(operatorList, page, pageNum, outputDir);
        }

        if (currentText.length > 0) {
            chunks.push({
                text: currentText,
                page: pdfDocument.numPages,
                chunkIndex,
                imageRefs: [],
            });
        }

        return chunks;
    } catch (error) {
        console.error("Error extracting text and images:", error);
        return [];
    }
}

export async function extractImagesFromPage(
    operatorList: any,
    page: any,
    pageNum: number,
    outputDir: string,
): Promise<string[]> {
    const imageRefs: string[] = [];
    const viewport = page.getViewport({ scale: 1.0 });
    const scaleFactor = viewport.width / page.getViewport({ scale: 1.0 }).width;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        if (operatorList.fnArray[i] === OPS.paintImageXObject) {
            const imageName = operatorList.argsArray[i][0];

            try {
                const image = await new Promise<any>((resolve, reject) => {
                    page.objs.get(imageName, (img: any) => {
                        if (img) resolve(img);
                        else reject(new Error(`Image ${imageName} not ready`));
                    });
                });

                if (image) {
                    const { width, height, data } = image;

                    const scaledWidth = width * scaleFactor;
                    const scaledHeight = height * scaleFactor;

                    const canvas = createCanvas(scaledWidth, scaledHeight);
                    const ctx = canvas.getContext("2d");

                    const imageData = ctx.createImageData(
                        scaledWidth,
                        scaledHeight,
                    );
                    imageData.data.set(new Uint8ClampedArray(data));
                    ctx.putImageData(imageData, 0, 0);

                    // Save as PNG
                    const imageFilename = `image_p${pageNum}_${i}.png`;
                    const imagePath = path.join(
                        outputDir,
                        "images",
                        imageFilename,
                    );
                    fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

                    imageRefs.push(imageFilename);
                }
            } catch (err: any) {
                console.warn(
                    `Skipping unresolved image ${imageName} on page ${pageNum}: ${err.message}`,
                );
            }
        }
    }

    return imageRefs;
}

export async function extractImagesFromPageV1(
    operatorList: any,
    page: any,
    pageNum: number,
    outputDir: string,
): Promise<string[]> {
    const imageRefs: string[] = [];

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        if (operatorList.fnArray[i] === OPS.paintImageXObject) {
            const imageName = operatorList.argsArray[i][0];

            try {
                const image = await new Promise<any>((resolve, reject) => {
                    page.objs.get(imageName, (img: any) => {
                        if (img) resolve(img);
                        else reject(new Error(`Image ${imageName} not ready`));
                    });
                });

                if (image) {
                    const { width, height, data } = image;
                    const canvas = createCanvas(width, height);
                    const ctx = canvas.getContext("2d");

                    const imageData = ctx.createImageData(width, height);
                    imageData.data.set(new Uint8ClampedArray(data));
                    ctx.putImageData(imageData, 0, 0);

                    const imageFilename = `image_p${pageNum}_${i}.png`;
                    const imagePath = path.join(
                        outputDir,
                        "images",
                        imageFilename,
                    );
                    fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

                    imageRefs.push(imageFilename);
                }
            } catch (err: any) {
                console.warn(
                    `Skipping unresolved image ${imageName} on page ${pageNum}: ${err.message}`,
                );
            }
        }
    }

    return imageRefs;
}
