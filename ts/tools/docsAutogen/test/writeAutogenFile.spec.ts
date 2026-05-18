// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    composeAutogenFile,
    writeAutogenFile,
} from "../src/writeAutogenFile.js";
import { END_MARKER, START_MARKER } from "../src/autogenRegion.js";

const SAMPLE_BODY =
    "<!-- AUTOGEN:DOCS:HASH:sha256=" +
    "0".repeat(64) +
    " -->\n<!-- AUTOGEN:DOCS:SOURCE: ./README.md -->\n\n# pkg — AI-generated documentation\n\n> banner\n\n## Overview\n\nbody\n\n## Reference\n\n### Entry points\n- `.` → `./dist/index.js`\n\n---\n\n_Auto-generated against commit `abc` on `2026-01-01T00:00:00Z` by `docs-generate.yml`. Re-run hint._";

describe("composeAutogenFile", () => {
    it("wraps the body with copyright comments and AUTOGEN markers", () => {
        const file = composeAutogenFile(SAMPLE_BODY);
        expect(file).toContain("<!-- Copyright (c) Microsoft Corporation. -->");
        expect(file).toContain("<!-- Licensed under the MIT License. -->");
        expect(file).toContain(START_MARKER);
        expect(file).toContain(END_MARKER);
        // Body sits between the markers.
        const startIdx = file.indexOf(START_MARKER);
        const endIdx = file.indexOf(END_MARKER);
        const middle = file.slice(startIdx, endIdx);
        expect(middle).toContain("# pkg — AI-generated documentation");
        expect(middle).toContain("## Reference");
    });
});

describe("writeAutogenFile", () => {
    it("writes a new README.AUTOGEN.md when none exists", async () => {
        const dir = await fs.mkdtemp(
            path.join(os.tmpdir(), "docsautogen-write-"),
        );
        try {
            const result = await writeAutogenFile(dir, SAMPLE_BODY);
            expect(result.verdict).toBe("wrote");
            const written = await fs.readFile(
                path.join(dir, "README.AUTOGEN.md"),
                "utf8",
            );
            expect(written).toContain("# pkg");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("returns unchanged when the file would be byte-identical", async () => {
        const dir = await fs.mkdtemp(
            path.join(os.tmpdir(), "docsautogen-write-"),
        );
        try {
            await writeAutogenFile(dir, SAMPLE_BODY);
            const result = await writeAutogenFile(dir, SAMPLE_BODY);
            expect(result.verdict).toBe("unchanged");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it("returns footer-only when only the staleness footer changed", async () => {
        const dir = await fs.mkdtemp(
            path.join(os.tmpdir(), "docsautogen-write-"),
        );
        try {
            await writeAutogenFile(dir, SAMPLE_BODY);
            const newBody = SAMPLE_BODY.replace(
                "2026-01-01T00:00:00Z",
                "2026-12-31T23:59:59Z",
            ).replace("`abc`", "`def`");
            const result = await writeAutogenFile(dir, newBody);
            expect(result.verdict).toBe("footer-only");
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
