import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up two levels: from src/common to dist
const distRoot = path.resolve(__dirname, "../dist");

export const DIST_ROOT = distRoot;
export const OUTPUT_DIR = path.join(distRoot, "output-data");
export const CHUNKED_DOCS_DIR = path.join(OUTPUT_DIR, "chunked-docs");
export const LOGS_DIR = path.join(OUTPUT_DIR, "logs");

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
