import path from "path";
import { fileURLToPath } from "url";
import * as fsp from "fs/promises";
import * as fs from "fs";
import { lock } from "proper-lockfile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up two levels: from src/common to dist
const distRoot = path.resolve(__dirname, "../dist");

export const DIST_ROOT = distRoot;
export const OUTPUT_DIR = path.join(distRoot, "output-data");
export const CHUNKED_DOCS_DIR = path.join(OUTPUT_DIR, "chunked-docs");
export const LOGS_DIR = path.join(OUTPUT_DIR, "logs");

export const PAPER_DOWNLOAD_DIR = path.join(OUTPUT_DIR, "papers/downloads");

export const PAPER_CATALOG_PATH = path.join(
    OUTPUT_DIR,
    "papers",
    "downloaded_papers.json",
);

export function resolveFilePath(filePath: string): string {
    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(__dirname, filePath);
}

export function resolveAndValidateFiles(filenames: string[]): string[] {
    const missingFiles: string[] = [];

    const absFilenames = filenames.map((f) => {
        const absPath = resolveFilePath(f);
        if (!fs.existsSync(absPath)) {
            missingFiles.push(absPath);
        }
        return `"${absPath}"`;
    });

    if (missingFiles.length > 0) {
        console.error("❌ The following files were not found:");
        missingFiles.forEach((file) => console.error("  -", file));
        throw new Error("One or more input files do not exist.");
    }

    return absFilenames;
}

export async function withFileLock<T>(
    file: string,
    fn: () => Promise<T>,
): Promise<T> {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, "", { flag: "a" }); // touch – ensures file exists

    const release = await lock(file, {
        retries: { retries: 5, factor: 2, minTimeout: 50, maxTimeout: 200 },
        realpath: false,
    });

    try {
        return await fn();
    } finally {
        await release();
    }
}
