import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

export const executor = {
    async act(action, { page }) {
        const args = action.arguments;
        if (
            typeof action.selector !== "string" ||
            !Array.isArray(args) ||
            !(
                (action.method === "click" && args.length === 0) ||
                (action.method === "fill" &&
                    args.length === 1 &&
                    typeof args[0] === "string") ||
                (action.method === "press" &&
                    args.length === 1 &&
                    args[0] === "Enter")
            )
        )
            throw new Error("unsupported_host_action");
        const target = page.locator(action.selector);
        await target[action.method](...args);
        return { success: true };
    },
};

export async function startFixture() {
    const routes = new Map([
        ["/shopping", new URL("./fixture.html", import.meta.url)],
        ["/crossword", new URL("../crossword/fixture.html", import.meta.url)],
    ]);
    const server = createServer(async (request, response) => {
        const file = routes.get(request.url);
        if (!file || request.method !== "GET") {
            response.writeHead(404).end();
            return;
        }
        try {
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "Content-Security-Policy":
                    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'",
            });
            response.end(await readFile(file));
        } catch {
            response.writeHead(500).end();
        }
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

export async function openBrowser() {
    const executablePath = [
        chromium.executablePath(),
        join(
            process.env["ProgramFiles(x86)"] ?? "",
            "Microsoft/Edge/Application/msedge.exe",
        ),
        join(
            process.env.ProgramFiles ?? "",
            "Google/Chrome/Application/chrome.exe",
        ),
    ].find((path) => existsSync(path));
    if (!executablePath)
        throw new Error(
            "browser_unavailable: install a Playwright Chromium or local Edge/Chrome",
        );
    const profile = await mkdtemp(join(tmpdir(), "decision-owned-"));
    let context;
    try {
        context = await chromium.launchPersistentContext(profile, {
            executablePath,
            headless: true,
            viewport: null,
            args: ["--disable-background-networking", "--no-first-run"],
        });
        const page = context.pages()[0] ?? (await context.newPage());
        await page.setViewportSize({ width: 1100, height: 800 });
        return {
            executor,
            context,
            page,
            async close() {
                try {
                    await context.close();
                } finally {
                    await rm(profile, { recursive: true, force: true });
                }
            },
        };
    } catch (error) {
        await context?.close().catch(() => {});
        await rm(profile, { recursive: true, force: true });
        throw error;
    }
}
