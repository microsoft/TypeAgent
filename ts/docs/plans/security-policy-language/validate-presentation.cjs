// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require("node:fs");
const path = require("node:path");
const JSZip = require(
    path.join(
        process.env.TEMP,
        "typeagent-presentation-tools",
        "node_modules",
        "jszip",
    ),
);

const slideWidth = 12192000;
const slideHeight = 6858000;
const presentationPath = path.join(
    __dirname,
    "OPA-Rego-Executive-Recommendation.pptx",
);

async function validate() {
    const archive = await JSZip.loadAsync(fs.readFileSync(presentationPath));
    const slides = Object.keys(archive.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((left, right) =>
            left.localeCompare(right, undefined, { numeric: true }),
        );
    const notes = Object.keys(archive.files).filter((name) =>
        /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
    );
    const requiredParts = [
        "[Content_Types].xml",
        "ppt/presentation.xml",
        "ppt/theme/theme1.xml",
    ];
    const issues = [];

    for (const part of requiredParts) {
        if (!archive.file(part)) {
            issues.push(`Missing package part: ${part}`);
        }
    }

    for (const slideName of slides) {
        const xml = await archive.file(slideName).async("string");
        const transforms = xml.matchAll(
            /<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(-?\d+)" cy="(-?\d+)"\/>/g,
        );

        for (const transform of transforms) {
            const [left, top, width, height] = transform.slice(1).map(Number);
            if (
                left < 0 ||
                top < 0 ||
                width < 0 ||
                height < 0 ||
                left + width > slideWidth + 1000 ||
                top + height > slideHeight + 1000
            ) {
                issues.push(
                    `${slideName}: out-of-bounds object at ${left},${top} (${width}x${height})`,
                );
            }
        }
    }

    if (slides.length !== 12) {
        issues.push(`Expected 12 slides, found ${slides.length}`);
    }
    if (notes.length !== 12) {
        issues.push(`Expected 12 speaker-note pages, found ${notes.length}`);
    }

    console.log(`Slides: ${slides.length}`);
    console.log(`Speaker notes: ${notes.length}`);
    console.log(`Package size: ${fs.statSync(presentationPath).size} bytes`);
    console.log(`Validation issues: ${issues.length}`);

    if (issues.length > 0) {
        console.error(issues.join("\n"));
        process.exitCode = 1;
    }
}

validate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
