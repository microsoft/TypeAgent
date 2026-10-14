import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

export async function verifyShopping(page, request) {
    return page.evaluate(
        (request) =>
            request === "Show only cordless tools"
                ? document.querySelector('[data-fixture-id="cordless-filter"]')
                      .checked &&
                  document.querySelector('[data-name="corded saw"]').hidden
                : document.querySelector("dialog").open &&
                  document.querySelector("#detail-title").innerText ===
                      "Cordless Drill",
        request,
    );
}

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

export async function openBrowser({ recordDirectory, demo = false } = {}) {
    if (demo && !recordDirectory)
        throw new Error("demo_requires_record_directory");
    let videoPath;
    if (recordDirectory !== undefined) {
        if (typeof recordDirectory !== "string" || !recordDirectory.trim())
            throw new Error("invalid_record_directory");
        recordDirectory = resolve(recordDirectory);
        await mkdir(dirname(recordDirectory), { recursive: true });
        await mkdir(recordDirectory);
        videoPath = join(recordDirectory, "scenario.webm");
    }
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
    let recordingBrowser;
    try {
        const launchOptions = {
            executablePath,
            headless: true,
            slowMo: demo ? 600 : 0,
            args: ["--disable-background-networking", "--no-first-run"],
        };
        if (recordDirectory) {
            recordingBrowser = await chromium.launch(launchOptions);
            context = await recordingBrowser.newContext({
                viewport: { width: 1100, height: 800 },
                recordVideo: {
                    dir: join(recordDirectory, "raw"),
                    size: { width: 1100, height: 800 },
                },
                serviceWorkers: "block",
            });
        } else {
            context = await chromium.launchPersistentContext(profile, {
                ...launchOptions,
                viewport: null,
            });
        }
        const page = context.pages()[0] ?? (await context.newPage());
        await page.setViewportSize({ width: 1100, height: 800 });
        const video = recordDirectory ? page.video() : undefined;
        if (recordDirectory && !video) throw new Error("video_unavailable");
        return {
            executor,
            context,
            page,
            videoPath,
            recording: videoPath
                ? {
                      file: videoPath,
                      capture: "page-viewport",
                      audio: false,
                      demoPaced: demo,
                      mediaValidated: false,
                  }
                : undefined,
            async caption(text) {
                if (!video) return;
                await page.evaluate((text) => {
                    let caption = document.querySelector(
                        "[data-recording-caption]",
                    );
                    if (!caption) {
                        caption = document.createElement("aside");
                        caption.dataset.recordingCaption = "true";
                        Object.assign(caption.style, {
                            position: "fixed",
                            bottom: "0",
                            left: "0",
                            right: "0",
                            padding: "16px 24px",
                            background: "#192922",
                            color: "white",
                            font: "17px Georgia, serif",
                            whiteSpace: "pre-line",
                            pointerEvents: "none",
                            zIndex: "2147483647",
                        });
                        document.body.style.paddingBottom = "96px";
                        document.body.append(caption);
                    }
                    caption.textContent = text;
                }, text);
            },
            async close() {
                try {
                    let source;
                    try {
                        if (video) source = await video.path();
                    } finally {
                        try {
                            await context.close();
                        } finally {
                            await recordingBrowser?.close();
                        }
                    }
                    if (source)
                        await copyFile(
                            source,
                            videoPath,
                            constants.COPYFILE_EXCL,
                        );
                } finally {
                    await rm(profile, { recursive: true, force: true });
                }
            },
        };
    } catch (error) {
        await context?.close().catch(() => {});
        await recordingBrowser?.close().catch(() => {});
        await rm(profile, { recursive: true, force: true });
        throw error;
    }
}
