// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import puppeteer, { TimeoutError } from "puppeteer";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import path from "path";
import { homedir } from "os";

export async function closeChrome() {
    const { exec } = await import("child_process");

    return new Promise<void>((resolve, reject) => {
        let command = "";

        // Determine the command based on the operating system
        if (process.platform === "win32") {
            command = "taskkill /F /IM chrome.exe /T";
        } else if (process.platform === "darwin") {
            command = 'pkill -9 "Google Chrome"';
        } else {
            command = "pkill -9 chrome";
        }

        console.log(`Attempting to close Chrome with command: ${command}`);

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.log(
                    `Chrome may not be running or couldn't be closed: ${error.message}`,
                );
                // Don't reject since this is not critical
                resolve();
                return;
            }

            if (stderr) {
                console.log(`Chrome close error output: ${stderr}`);
            }

            console.log(`Chrome closed successfully: ${stdout}`);
            resolve();
        });
    });
}

function getChromeExecutablePath(): string {
    const platform = process.platform;
    let chromePath: string | null = null;

    if (platform === "win32") {
        chromePath = path.join(
            "C:",
            "Program Files (x86)",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
        );
        if (!fs.existsSync(chromePath)) {
            chromePath = path.join(
                "C:",
                "Program Files",
                "Google",
                "Chrome",
                "Application",
                "chrome.exe",
            );
        }
    } else if (platform === "darwin") {
        chromePath =
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    } else if (platform === "linux") {
        chromePath = "/usr/bin/google-chrome";
        if (!fs.existsSync(chromePath)) {
            chromePath = "/usr/bin/chromium-browser";
        }
    } else {
        throw new Error("Unsupported OS");
    }

    if (chromePath && fs.existsSync(chromePath)) {
        return chromePath;
    } else {
        throw new Error("Chrome executable not found");
    }
}

function getChromeProfilePath(): string {
    const platform = process.platform;

    if (platform === "win32") {
        return path.join(
            homedir(),
            "AppData",
            "Local",
            "Google",
            "Chrome",
            "User Data",
        );
    } else if (platform === "darwin") {
        return path.join(
            homedir(),
            "Library",
            "Application Support",
            "Google",
            "Chrome",
        );
    } else if (platform === "linux") {
        return path.join(homedir(), ".config", "google-chrome");
    } else {
        throw new Error("Unsupported OS");
    }
}

function getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRestaurantLinks(page: puppeteer.Page): Promise<string[]> {
    return await page.evaluate(() => {
        const links = Array.from(
            document.querySelectorAll('a[href*="/Restaurant_Review-"]'),
        )
            .map(
                (link) =>
                    `https://www.tripadvisor.com${link.getAttribute("href")}`,
            )
            .map((url) => url.split("#")[0]); // Remove #REVIEWS section

        return [...new Set(links)]; // Remove duplicates
    });
}

async function extractJsonLdData(page: puppeteer.Page): Promise<any | null> {
    try {
        const jsonLd = await page.$$eval(
            'script[type="application/ld+json"]',
            (nodes) => nodes.map((n) => n.textContent).filter(Boolean),
        );

        for (const json of jsonLd) {
            try {
                const parsed = JSON.parse(json!);
                const entryType = parsed["@type"];
                if (
                    entryType === "Restaurant" ||
                    entryType === "FoodEstablishment" ||
                    entryType === "LocalBusiness" ||
                    entryType?.includes("Restaurant")
                ) {
                    return parsed;
                }
            } catch {}
        }
    } catch (err) {
        console.error("Error extracting schema:", err);
    }
    return null;
}

async function scrapePage(
    browser: puppeteer.Browser,
    url: string,
): Promise<any | null> {
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: "load" });
        await page.waitForSelector(
            'div[data-test-target="restaurants-detail"]',
            {
                timeout: 5000,
            },
        );

        const data = await extractJsonLdData(page);
        if (data) {
            data.url = url;
            console.log(`Extracted data for ${url}`);
        }
        return data;
    } catch (err) {
        if (err instanceof TimeoutError) {
            console.error(
                "Custom Message: Element did not appear within 10 seconds.",
            );
        } else {
            console.error(`Failed to scrape ${url}:`, err);
        }
        return null;
    } finally {
        await page.close();
    }
}

async function runDiscoveryMode(
    browser: puppeteer.Browser,
    baseUrl: string,
    numPages: number,
    outputFile: string,
) {
    const page = await browser.newPage();
    let allRestaurantData: any[] = [];

    let currentPage = 1;
    let nextPageUrl: string | null = baseUrl;

    while (nextPageUrl && currentPage <= numPages) {
        console.log(`Scraping page: ${nextPageUrl}`);
        await page.goto(nextPageUrl, { waitUntil: "load" });

        const restaurantLinks = await getRestaurantLinks(page);
        console.log(`Found ${restaurantLinks.length} unique restaurants.`);

        await page.waitForSelector('a[href*="/Restaurant_Review-"]'); // Wait for restaurant links to appear

        // Visit each restaurant page and extract JSON-LD metadata
        for (const link of restaurantLinks) {
            console.log(`Visiting: ${link}`);
            // Wait for a random delay between 2 to 3 seconds before making the next request
            const waitTime = getRandomDelay(2000, 3000);
            console.log(`Waiting ${waitTime}ms before the next request...`);
            await delay(waitTime);

            const jsonLdData = await scrapePage(browser, link);

            // Check for duplicates before adding
            if (
                jsonLdData &&
                jsonLdData?.name &&
                !allRestaurantData.some(
                    (entry) => entry.name === jsonLdData.name,
                )
            ) {
                console.log(`Adding: ${jsonLdData.name}`);
                allRestaurantData.push(jsonLdData);
            } else {
                console.log(`Skipping duplicate: ${jsonLdData.name}`);
            }
        }

        // Find the "Next" button for pagination
        nextPageUrl = await page.evaluate(() => {
            const nextButton = document.querySelector(
                'a[aria-label="Next page"]',
            );
            return nextButton
                ? `https://www.tripadvisor.com${nextButton.getAttribute("href")}`
                : null;
        });
        currentPage++;

        if (nextPageUrl) {
            const waitTime = getRandomDelay(3000, 6000);
            console.log(`Waiting ${waitTime}ms before the next page...`);
            await delay(waitTime);
        }
    }

    console.log(`Scraped a total of ${allRestaurantData.length} restaurants.`);

    // Save the extracted data to a file
    await fs.writeJson(outputFile, allRestaurantData, { spaces: 2 });
    console.log(`Data saved to ${outputFile}`);

    await browser.close();
}

async function runDirectMode(browser: puppeteer.Browser, inputFile: string) {
    const urls: string[] = fs.readJsonSync(inputFile);
    const results: any[] = [];

    for (const url of urls) {
        const waitTime = getRandomDelay(2000, 3000);
        console.log(`Waiting ${waitTime}ms before the next request...`);
        await delay(waitTime);

        const data = await scrapePage(browser, url);
        if (data) results.push(data);
    }

    const outPath = path.join(path.dirname(inputFile), "output_direct.json");
    fs.writeJsonSync(outPath, results, { spaces: 2 });
    console.log(`Saved ${results.length} entries to ${outPath}`);
}

(async () => {
    const args = process.argv.slice(2);
    const modeArg = args.find((arg) => arg.startsWith("--mode="));
    const mode = modeArg?.split("=")[1] || "discovery";
    const inputFile = args.find((arg) => arg.endsWith(".json"));

    await closeChrome();

    const browser = await puppeteer.launch({
        executablePath: getChromeExecutablePath(),
        userDataDir: getChromeProfilePath(),
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
        if (mode === "direct") {
            if (inputFile) {
                await runDirectMode(browser, inputFile);
            } else {
                console.error(
                    "Please provide a JSON file of URLs for direct mode.",
                );
            }
        } else {
            const baseUrl =
                "https://www.tripadvisor.com/Restaurants-g58541-Kirkland_Washington.html";
            const dirName = fileURLToPath(new URL(".", import.meta.url));
            const outputFile = path.join(
                dirName,
                "tripadvisor_restaurants.json",
            );
            const numPages = 8;
            await runDiscoveryMode(browser, baseUrl, numPages, outputFile);
        }
    } catch (error) {
        console.error("An error occurred during scraping:", error);
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
})();
