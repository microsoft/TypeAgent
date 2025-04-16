// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import puppeteer from "puppeteer";
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

async function extractJsonLdData(page: puppeteer.Page): Promise<any[]> {
    return await page.evaluate(() => {
        return Array.from(
            document.querySelectorAll('script[type="application/ld+json"]'),
        )
            .map((script) => {
                try {
                    return JSON.parse(script.textContent || "{}");
                } catch (e) {
                    return null;
                }
            })
            .filter((data) => data !== null); // Remove invalid JSON entries
    });
}

const BASE_URL =
    "https://www.tripadvisor.com/Restaurants-g58541-Kirkland_Washington.html"; // Seattle restaurants
const dirName = fileURLToPath(new URL(".", import.meta.url));
const OUTPUT_FILE = path.join(dirName, "tripadvisor_restaurants.json");
const numPages = 8; // Number of search result pages to scrape

(async () => {
    await closeChrome();

    const browser = await puppeteer.launch({
        executablePath: getChromeExecutablePath(),
        userDataDir: getChromeProfilePath(),
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    let allRestaurantData: any[] = [];

    let currentPage = 1;
    let nextPageUrl: string | null = BASE_URL;

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

            await page.goto(link, { waitUntil: "load" });

            const jsonLdEntries = await extractJsonLdData(page);

            // Check for duplicates before adding
            jsonLdEntries.forEach((jsonLdData) => {
                if (
                    jsonLdData &&
                    jsonLdData.name &&
                    !allRestaurantData.some(
                        (entry) => entry.name === jsonLdData.name,
                    )
                ) {
                    console.log(`Adding: ${jsonLdData.name}`);
                    allRestaurantData.push(jsonLdData);
                } else {
                    console.log(`Skipping duplicate: ${jsonLdData.name}`);
                }
            });
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
    await fs.writeJson(OUTPUT_FILE, allRestaurantData, { spaces: 2 });
    console.log(`Data saved to ${OUTPUT_FILE}`);

    await browser.close();
})();
