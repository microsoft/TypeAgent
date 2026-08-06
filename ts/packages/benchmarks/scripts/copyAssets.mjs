import {
    constants,
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirsMade = new Set();

function ensureDir(dir) {
    if (dirsMade.has(dir)) return;
    mkdirSync(dir, { recursive: true });
    dirsMade.add(dir);
}

/** Skip when dest exists with same size and mtime >= source (idempotent builds). */
function copyFileFast(from, to) {
    if (!existsSync(from)) return false;
    ensureDir(path.dirname(to));
    if (existsSync(to)) {
        const src = statSync(from);
        const dst = statSync(to);
        if (src.size === dst.size && dst.mtimeMs >= src.mtimeMs) {
            return false;
        }
    }
    copyFileSync(from, to, constants.COPYFILE_FICLONE);
    return true;
}

const files = [
    [
        "src/translationBench/catalog.generated.json",
        "dist/translationBench/catalog.generated.json",
    ],
    [
        "src/translationBench/action-parameters-grader.generated.json",
        "dist/translationBench/action-parameters-grader.generated.json",
    ],
    [
        "src/core/model-prices.generated.json",
        "dist/core/model-prices.generated.json",
    ],
];

for (const [fromRel, toRel] of files) {
    copyFileFast(path.join(root, fromRel), path.join(root, toRel));
}

const yamlSrc = path.join(root, "src/translationBench/synthesizer");
const yamlDst = path.join(root, "dist/translationBench/synthesizer");
if (existsSync(yamlSrc)) {
    for (const name of readdirSync(yamlSrc, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        if (!name.name.endsWith(".yaml") && !name.name.endsWith(".yml")) {
            continue;
        }
        copyFileFast(
            path.join(yamlSrc, name.name),
            path.join(yamlDst, name.name),
        );
    }
}
