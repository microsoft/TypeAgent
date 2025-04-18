// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command, Flags } from '@oclif/core';
import puppeteer, { TimeoutError } from 'puppeteer';
import * as fs from 'fs-extra';
import * as path from 'path';
import { homedir } from 'os';

export default class Scrape extends Command {
  static description = 'Scrape restaurant data from TripAdvisor';

  static examples = [
    '<%= config.bin %> scrape --mode=discovery',
    '<%= config.bin %> scrape --mode=direct --input=path/to/urls.json',
    '<%= config.bin %> scrape --mode=discovery --base-url="https://www.tripadvisor.com/Restaurants-g60878-Seattle_Washington.html" --pages=5',
  ];

  static flags = {
    mode: Flags.string({
      char: 'm',
      description: 'Scraping mode: "discovery" or "direct"',
      options: ['discovery', 'direct'],
      default: 'discovery',
    }),
    'base-url': Flags.string({
      char: 'u',
      description: 'Base URL for discovery mode',
      default: 'https://www.tripadvisor.com/Restaurants-g58541-Kirkland_Washington.html',
    }),
    pages: Flags.integer({
      char: 'p',
      description: 'Number of pages to scrape in discovery mode',
      default: 8,
    }),
    headless: Flags.boolean({
      char: 'h',
      description: 'Run browser in headless mode',
      default: false,
    }),
    input: Flags.string({
      char: 'i',
      description: 'JSON file containing URLs for direct mode',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Output file path',
    }),
  };

  async closeChrome(): Promise<void> {
    const { exec } = require('child_process');

    return new Promise<void>((resolve) => {
      let command = '';

      // Determine the command based on the operating system
      if (process.platform === 'win32') {
        command = 'taskkill /F /IM chrome.exe /T';
      } else if (process.platform === 'darwin') {
        command = 'pkill -9 "Google Chrome"';
      } else {
        command = 'pkill -9 chrome';
      }

      this.log(`Attempting to close Chrome with command: ${command}`);

      exec(command, (error: any, stdout: string, stderr: string) => {
        if (error) {
          this.log(
            `Chrome may not be running or couldn't be closed: ${error.message}`,
          );
        }

        if (stderr) {
          this.log(`Chrome close error output: ${stderr}`);
        }

        if (stdout) {
          this.log(`Chrome closed successfully: ${stdout}`);
        }
        
        resolve();
      });
    });
  }

  getChromeExecutablePath(): string {
    const platform = process.platform;
    let chromePath: string | null = null;

    if (platform === 'win32') {
      chromePath = path.join(
        'C:',
        'Program Files (x86)',
        'Google',
        'Chrome',
        'Application',
        'chrome.exe',
      );
      if (!fs.existsSync(chromePath)) {
        chromePath = path.join(
          'C:',
          'Program Files',
          'Google',
          'Chrome',
          'Application',
          'chrome.exe',
        );
      }
    } else if (platform === 'darwin') {
      chromePath =
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (platform === 'linux') {
      chromePath = '/usr/bin/google-chrome';
      if (!fs.existsSync(chromePath)) {
        chromePath = '/usr/bin/chromium-browser';
      }
    } else {
      throw new Error('Unsupported OS');
    }

    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    } else {
      throw new Error('Chrome executable not found');
    }
  }

  getChromeProfilePath(): string {
    const platform = process.platform;

    if (platform === 'win32') {
      return path.join(
        homedir(),
        'AppData',
        'Local',
        'Google',
        'Chrome',
        'User Data',
      );
    } else if (platform === 'darwin') {
      return path.join(
        homedir(),
        'Library',
        'Application Support',
        'Google',
        'Chrome',
      );
    } else if (platform === 'linux') {
      return path.join(homedir(), '.config', 'google-chrome');
    } else {
      throw new Error('Unsupported OS');
    }
  }

  getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getRestaurantLinks(page: puppeteer.Page): Promise<string[]> {
    return await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll('a[href*="/Restaurant_Review-"]'),
      )
        .map(
          (link) =>
            `https://www.tripadvisor.com${link.getAttribute('href')}`,
        )
        .map((url) => url.split('#')[0]); // Remove #REVIEWS section

      return [...new Set(links)]; // Remove duplicates
    });
  }

  async extractJsonLdData(page: puppeteer.Page): Promise<any | null> {
    try {
      const jsonLd = await page.$$eval(
        'script[type="application/ld+json"]',
        (nodes) => nodes.map((n) => n.textContent).filter(Boolean),
      );

      for (const json of jsonLd) {
        try {
          const parsed = JSON.parse(json!);
          const entryType = parsed['@type'];
          if (
            entryType === 'Restaurant' ||
            entryType === 'FoodEstablishment' ||
            entryType === 'LocalBusiness' ||
            entryType?.includes('Restaurant')
          ) {
            return parsed;
          }
        } catch {}
      }
    } catch (err) {
      this.error(`Error extracting schema: ${err}`);
    }
    return null;
  }

  async scrapePage(
    browser: puppeteer.Browser,
    url: string,
  ): Promise<any | null> {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector(
        'div[data-test-target="restaurants-detail"]',
        {
          timeout: 5000,
        },
      );

      const data = await this.extractJsonLdData(page);
      if (data) {
        data.url = url;
        this.log(`Extracted data for ${url}`);
      }
      return data;
    } catch (err) {
      if (err instanceof TimeoutError) {
        this.warn(
          'Element did not appear within 5 seconds.'
        );
      } else {
        this.warn(`Failed to scrape ${url}: ${err}`);
      }
      return null;
    } finally {
      await page.close();
    }
  }

  async runDiscoveryMode(
    browser: puppeteer.Browser,
    baseUrl: string,
    numPages: number,
    outputFile: string,
  ): Promise<void> {
    const page = await browser.newPage();
    let allRestaurantData: any[] = [];

    let currentPage = 1;
    let nextPageUrl: string | null = baseUrl;

    while (nextPageUrl && currentPage <= numPages) {
      this.log(`Scraping page: ${nextPageUrl}`);
      await page.goto(nextPageUrl, { waitUntil: 'load' });

      const restaurantLinks = await this.getRestaurantLinks(page);
      this.log(`Found ${restaurantLinks.length} unique restaurants.`);

      await page.waitForSelector('a[href*="/Restaurant_Review-"]'); // Wait for restaurant links to appear

      // Visit each restaurant page and extract JSON-LD metadata
      for (const link of restaurantLinks) {
        this.log(`Visiting: ${link}`);
        // Wait for a random delay between 2 to 3 seconds before making the next request
        const waitTime = this.getRandomDelay(2000, 3000);
        this.log(`Waiting ${waitTime}ms before the next request...`);
        await this.delay(waitTime);

        const jsonLdData = await this.scrapePage(browser, link);

        // Check for duplicates before adding
        if (
          jsonLdData &&
          jsonLdData?.name &&
          !allRestaurantData.some(
            (entry) => entry.name === jsonLdData.name,
          )
        ) {
          this.log(`Adding: ${jsonLdData.name}`);
          allRestaurantData.push(jsonLdData);
        } else if (jsonLdData) {
          this.log(`Skipping duplicate: ${jsonLdData.name}`);
        }
      }

      // Find the "Next" button for pagination
      nextPageUrl = await page.evaluate(() => {
        const nextButton = document.querySelector(
          'a[aria-label="Next page"]',
        );
        return nextButton
          ? `https://www.tripadvisor.com${nextButton.getAttribute('href')}`
          : null;
      });
      currentPage++;

      if (nextPageUrl) {
        const waitTime = this.getRandomDelay(3000, 6000);
        this.log(`Waiting ${waitTime}ms before the next page...`);
        await this.delay(waitTime);
      }
    }

    this.log(`Scraped a total of ${allRestaurantData.length} restaurants.`);

    // Save the extracted data to a file
    await fs.writeJson(outputFile, allRestaurantData, { spaces: 2 });
    this.log(`Data saved to ${outputFile}`);
  }

  async runDirectMode(
    browser: puppeteer.Browser, 
    inputFile: string,
    outputFile: string
  ): Promise<void> {
    const urls: string[] = await fs.readJSON(inputFile);
    const results: any[] = [];

    for (const url of urls) {
      const waitTime = this.getRandomDelay(2000, 3000);
      this.log(`Waiting ${waitTime}ms before the next request...`);
      await this.delay(waitTime);

      const data = await this.scrapePage(browser, url);
      if (data) results.push(data);
    }

    await fs.writeJSON(outputFile, results, { spaces: 2 });
    this.log(`Saved ${results.length} entries to ${outputFile}`);
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Scrape);
    const mode = flags.mode;
    const inputFile = flags.input;
    const baseUrl = flags['base-url'];
    const numPages = flags.pages;
    const headless = flags.headless;

    // Validate inputs
    if (mode === 'direct' && !inputFile) {
      this.error('Direct mode requires an input file. Use --input=path/to/urls.json');
      return;
    }

    // Determine output file
    let outputFile: string;
    if (flags.output) {
      outputFile = flags.output;
    } else {
      if (mode === 'direct' && inputFile) {
        outputFile = path.join(
          path.dirname(inputFile),
          `${path.basename(inputFile, '.json')}_scraped.json`
        );
      } else {
        outputFile = path.join(process.cwd(), 'tripadvisor_restaurants.json');
      }
    }

    try {
      await this.closeChrome();

      const browser = await puppeteer.launch({
        executablePath: this.getChromeExecutablePath(),
        userDataDir: this.getChromeProfilePath(),
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      try {
        if (mode === 'direct') {
          if (inputFile) {
            this.log(`Running in direct mode using URLs from ${inputFile}`);
            await this.runDirectMode(browser, inputFile, outputFile);
          }
        } else {
          this.log(`Running in discovery mode starting from ${baseUrl}`);
          this.log(`Will scrape up to ${numPages} pages`);
          await this.runDiscoveryMode(browser, baseUrl, numPages, outputFile);
        }
      } finally {
        await browser.close();
        this.log('Browser closed.');
      }
    } catch (error) {
      this.error(`An error occurred during scraping: ${error}`);
    }
  }
}