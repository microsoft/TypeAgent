// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import puppeteer from "puppeteer";
import { createHash } from "node:crypto";

export const FIXTURE_VERSION = "chromium-pdf-fixtures/2";
export const sha256 = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");

const style = `<style>
@page { size: 600pt 800pt; margin: 0; }
body { margin: 0; font: 12pt 'Times New Roman'; }
section { position: relative; width: 600pt; height: 800pt; break-after: page; }
section:last-child { break-after: auto; }
p { position: absolute; margin: 0; white-space: nowrap; }
</style>`;

function line(text, left, top, size = 12) {
    return `<p style="left:${left}pt;top:${top}pt;font-size:${size}pt">${text}</p>`;
}

function bodyLines(page, columns = 1, count = 12, spacing = 520 / columns) {
    return Array.from({ length: columns }, (_, column) =>
        Array.from({ length: count }, (_, row) =>
            line(
                `P${page}C${column + 1}R${row + 1}`,
                40 + column * spacing,
                130 + row * 28,
            ),
        ).join(""),
    ).join("");
}

export function largeDocumentHtml(pages, images = []) {
    if (![100, 300, 500].includes(pages))
        throw new RangeError("Expected 100, 300 or 500 pages");
    return (
        style +
        Array.from(
            { length: pages },
            (_, index) =>
                `<section>${
                    line("Benchmark manual", 40, 22) +
                    line(`Document section ${index + 1}`, 40, 100, 20) +
                    bodyLines(index + 1) +
                    (images.length
                        ? `<img src="${images[index % images.length]}" style="position:absolute;left:40pt;top:490pt;width:520pt;height:240pt">`
                        : "") +
                    line(String(index + 1), 290, 760)
                }</section>`,
        ).join("")
    );
}

export async function imageHeavyAssets(generator) {
    const images = await generator.page.evaluate(() =>
        Array.from({ length: 8 }, (_, index) => {
            const canvas = document.createElement("canvas");
            canvas.width = 800;
            canvas.height = 600;
            const context = canvas.getContext("2d");
            const image = context.createImageData(canvas.width, canvas.height);
            let seed = index + 1;
            for (let offset = 0; offset < image.data.length; offset += 4) {
                for (let channel = 0; channel < 3; channel++) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    image.data[offset + channel] = seed >>> 24;
                }
                image.data[offset + 3] = 255;
            }
            context.putImageData(image, 0, 0);
            return canvas.toDataURL("image/png");
        }),
    );
    const assets = new Map(
        images.map((image, index) => [
            `http://pdf-fixtures.invalid/image-${index}.png`,
            Buffer.from(image.split(",")[1], "base64"),
        ]),
    );
    await generator.page.setRequestInterception(true);
    generator.page.on("request", (request) => {
        const body = assets.get(request.url());
        void (body
            ? request.respond({ status: 200, contentType: "image/png", body })
            : request.continue());
    });
    return [...assets.keys()];
}

function normalizeDates(data) {
    const input = Buffer.from(data);
    const output = Buffer.from(
        input
            .toString("latin1")
            .replace(
                /\/(CreationDate|ModDate) \(D:\d{14}\+00'00'\)/g,
                "/$1 (D:20000101000000+00'00')",
            ),
        "latin1",
    );
    if (output.length !== input.length)
        throw new Error("PDF metadata normalization changed offsets");
    return output;
}

export async function withPdfGenerator(run) {
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const generate = async (html) => {
            await page.setContent(html);
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() =>
                Promise.all(
                    [...document.images].map((image) => image.decode()),
                ),
            );
            return normalizeDates(
                await page.pdf({
                    preferCSSPageSize: true,
                    printBackground: true,
                    tagged: false,
                }),
            );
        };
        return await run({
            page,
            generate,
            browserVersion: await browser.version(),
        });
    } finally {
        try {
            await browser.close();
        } catch (error) {
            if (error.code !== "EBUSY") throw error;
            process.stderr.write(
                "Chromium exited but Windows locked its temporary profile during cleanup.\n",
            );
        }
    }
}

function boxedPdf(rotation, crop) {
    const stream = "BT /F1 12 Tf 50 650 Td (Box geometry) Tj ET";
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [10 20 610 820] /CropBox [${crop.join(" ")}] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    for (const [index, object] of objects.entries()) {
        offsets.push(pdf.length);
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets)
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(pdf, "ascii");
}

export async function representativeFixtures(generator) {
    const fixtures = [];
    for (const columns of [1, 2, 3]) {
        fixtures.push({
            name: `columns-${columns}`,
            bytes: await generator.generate(
                style +
                    `<section>${bodyLines(1, columns, 3, columns === 2 ? 300 : 520 / columns)}</section>`,
            ),
            expected: Array.from({ length: columns }, (_, column) =>
                Array.from(
                    { length: 3 },
                    (_, row) => `P1C${column + 1}R${row + 1}`,
                ),
            ).flat(),
        });
    }
    fixtures.push({
        name: "columns-2-midpoint",
        bytes: await generator.generate(
            style + `<section>${bodyLines(1, 2, 3)}</section>`,
        ),
        expected: ["P1C1R1", "P1C1R2", "P1C1R3", "P1C2R1", "P1C2R2", "P1C2R3"],
    });
    for (const partial of [false, true]) {
        const region = (prefix, top) =>
            [0, 1, 2]
                .flatMap((row) =>
                    [40, 210, 390].map((left, column) =>
                        line(
                            `${prefix}C${column + 1}R${row + 1}`,
                            left,
                            top + row * 28,
                        ),
                    ),
                )
                .join("");
        const expectedRegion = (prefix) =>
            [1, 2, 3].flatMap((column) =>
                [1, 2, 3].map((row) => `${prefix}C${column}R${row}`),
            );
        const span = partial
            ? "Spanning text across two columns only"
            : "Spanning text across all three columns with measured content extending into the final column";
        fixtures.push({
            name: `columns-3-${partial ? "partial" : "full"}-span`,
            bytes: await generator.generate(
                style +
                    `<section>${region("Upper", 130)}${line(span, 40, 245)}${region("Lower", 310)}</section>`,
            ),
            expected: [
                ...expectedRegion("Upper"),
                span,
                ...expectedRegion("Lower"),
            ],
        });
    }
    fixtures.push({
        name: "columns-3-uneven",
        bytes: await generator.generate(
            style +
                `<section>${[0, 1, 2]
                    .flatMap((row) =>
                        [40, 200, 400].map((left, column) =>
                            line(
                                `C${column + 1}R${row + 1}${row === 1 ? " longer body text" : ""}`,
                                left,
                                130 + row * 35 + column * 5,
                                column === 1 ? 14 : 12,
                            ),
                        ),
                    )
                    .join("")}</section>`,
        ),
        expected: [1, 2, 3].flatMap((column) =>
            [1, 2, 3].map(
                (row) =>
                    `C${column}R${row}${row === 2 ? " longer body text" : ""}`,
            ),
        ),
    });
    fixtures.push({
        name: "enlarged-body-not-heading",
        bytes: await generator.generate(
            style +
                `<section>${line("An enlarged body sentence.", 40, 120, 24)}${line("Body continuation", 40, 180)}${line("More body", 40, 210)}</section>`,
        ),
        expected: [
            "An enlarged body sentence.",
            "Body continuation",
            "More body",
        ],
    });
    fixtures.push({
        name: "alternating-indents-not-columns",
        bytes: await generator.generate(
            style +
                `<section>${Array.from({ length: 8 }, (_, row) =>
                    line(
                        `Indented line ${row + 1}`,
                        row % 2 ? 300 : 40,
                        130 + row * 30,
                    ),
                ).join("")}</section>`,
        ),
        expected: Array.from(
            { length: 8 },
            (_, row) => `Indented line ${row + 1}`,
        ),
    });
    const overlappingSpan = "Spanning text across two columns only";
    fixtures.push({
        name: "overlapping-span-retains-geometric-order",
        bytes: await generator.generate(
            style +
                `<section>${[0, 1]
                    .flatMap((row) =>
                        [40, 210, 390].map((left, column) =>
                            line(
                                `C${column + 1}R${row + 1}`,
                                left,
                                130 + row * 30,
                            ),
                        ),
                    )
                    .join(
                        "",
                    )}${line(overlappingSpan, 40, 230)}${line("Overlapping peer", 390, 230)}</section>`,
        ),
        expected: [
            "C1R1",
            "C2R1",
            "C3R1",
            "C1R2",
            "C2R2",
            "C3R2",
            overlappingSpan,
            "Overlapping peer",
        ],
    });
    fixtures.push({
        name: "lists-furniture",
        bytes: await generator.generate(
            style +
                [1, 2, 3]
                    .map(
                        (page) =>
                            `<section>${line("Repeated manual", 40, 22)}${line("List title", 40, 100, 24)}${line("- First item", 40, 150)}${line("2. Second item", 40, 180)}${line(String(page), 290, 760)}</section>`,
                    )
                    .join(""),
        ),
    });
    fixtures.push({
        name: "tables-math-captions",
        bytes: await generator.generate(
            style +
                `<section>${line("Name", 40, 130)}${line("Value", 340, 130)}${line("Alpha", 40, 160)}${line("42", 340, 160)}${line("x = y + 2", 40, 220)}${line("Figure 1: sample caption", 40, 300)}${line("café office affine", 40, 360)}</section>`,
        ),
    });
    const scan = await generator.page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 1600;
        const context = canvas.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, 1200, 1600);
        context.fillStyle = "black";
        context.font = "40px serif";
        context.fillText("Scan text requires OCR", 80, 200);
        return canvas.toDataURL("image/png");
    });
    const scanPage = `<section><img src="${scan}" style="width:600pt;height:800pt"></section>`;
    fixtures.push({
        name: "scan-only",
        bytes: await generator.generate(style + scanPage),
    });
    fixtures.push({
        name: "mixed-scan",
        bytes: await generator.generate(
            style +
                `<section>${line("Digital body", 40, 130)}</section>` +
                scanPage,
        ),
    });
    for (const rotation of [0, 90, 180, 270])
        fixtures.push({
            name: `crop-rotate-${rotation}`,
            bytes: boxedPdf(rotation, [30, 40, 590, 780]),
        });
    return fixtures;
}
