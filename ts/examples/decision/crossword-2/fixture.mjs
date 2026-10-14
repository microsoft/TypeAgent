import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { puzzleText } from "./puzzle.mjs";

export const revision = "a686b7936bdec1da9199da78b62681853b325e83";
const cache = new URL("../node_modules/.cache/crossword-2/", import.meta.url);
const assets = {
    "exolve-m.js":
        "612ebfcdba966ffeb1ba7e809fef09b2ac2f93d4725d5152536a15af97cebf3d",
    "exolve-m.css":
        "2e63c472e3074207073fa2c8b3c3fab04d1730f18588856f32f30722e02489d9",
    LICENSE: "b367add427f0d7fa9bef17bf0ab286e0803877b3ca6304c5fc34249aa0935b03",
};

function verifyAsset(name, bytes) {
    if (createHash("sha256").update(bytes).digest("hex") !== assets[name])
        throw new Error(`renderer_hash_mismatch: ${name}`);
    return bytes;
}

export async function prepareRenderer() {
    await mkdir(cache, { recursive: true });
    for (const name of Object.keys(assets)) {
        const response = await fetch(
            `https://raw.githubusercontent.com/viresh-ratnakar/exolve/${revision}/${name}`,
        );
        if (!response.ok)
            throw new Error(`renderer_download_failed: ${response.status}`);
        await writeFile(
            new URL(name, cache),
            verifyAsset(name, Buffer.from(await response.arrayBuffer())),
        );
    }
}

export async function startCrosswordFixture() {
    const routes = new Map();
    for (const name of Object.keys(assets)) {
        const bytes = await readFile(new URL(name, cache)).catch(() => {
            throw new Error(
                "renderer_missing: run node crossword-2/fixture.mjs --setup",
            );
        });
        routes.set(`/${name}`, verifyAsset(name, bytes));
    }
    const html = (
        await readFile(new URL("./fixture.html", import.meta.url), "utf8")
    ).replace("__PUZZLE_TEXT__", JSON.stringify(puzzleText));
    routes.set("/", html);
    const server = createServer((request, response) => {
        const body = routes.get(request.url);
        if (!body || request.method !== "GET") {
            response.writeHead(404).end();
            return;
        }
        const type = request.url.endsWith(".js")
            ? "text/javascript"
            : request.url.endsWith(".css")
              ? "text/css"
              : request.url === "/"
                ? "text/html"
                : "text/plain";
        response.writeHead(200, {
            "Content-Type": `${type}; charset=utf-8`,
            "Cache-Control": "no-store",
            "Content-Security-Policy":
                "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'",
        });
        response.end(body);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    if (process.argv.includes("--setup")) await prepareRenderer();
    else {
        const fixture = await startCrosswordFixture();
        process.stdout.write(`${fixture.url}/\n`);
    }
}
