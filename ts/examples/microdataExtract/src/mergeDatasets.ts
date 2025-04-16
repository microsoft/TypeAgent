import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

interface Restaurant {
  [key: string]: any;
}

function normalizeSameAs(sameAs: string | string[] | undefined): string[] {
  if (!sameAs) return [];
  const urls = Array.isArray(sameAs) ? sameAs : [sameAs];

  return urls.map(rawUrl => {
    try {
      const url = new URL(rawUrl);

      if (url.hostname.includes('tripadvisor.com')) {
        // Normalize to https://www.tripadvisor.com + path + search
        return `https://www.tripadvisor.com${url.pathname}${url.search}`;
      }

      return rawUrl;
    } catch (e) {
      // In case of an invalid URL, return as-is
      return rawUrl;
    }
  });
}

function mergeRestaurants(parsed: Restaurant, crawl: Restaurant): Restaurant {
  return {
    ...parsed,
    aggregateRating: crawl.aggregateRating,
    address: crawl.address,
    priceRange: crawl.priceRange,
  };
}

function mergeData(parsedPath: string, crawlPath: string): void {
  const parsedData: Restaurant[] = JSON.parse(fs.readFileSync(parsedPath, 'utf-8'));
  const crawlData: Restaurant[] = JSON.parse(fs.readFileSync(crawlPath, 'utf-8'));

  const parsedBySameAs: Map<string, Restaurant> = new Map();
  const matchedParsed = new Set<Restaurant>();
  const matchedCrawl = new Set<Restaurant>();

  // Index parsed entries by each of their normalized sameAs URLs
  parsedData.forEach(entry => {
    normalizeSameAs(entry.sameAs).forEach(url => {
      parsedBySameAs.set(url, entry);
    });
  });

  const mergedOnlyOverlap: Restaurant[] = [];
  const onlyCrawl: Restaurant[] = [];

  crawlData.forEach(crawlEntry => {
    const crawlUrl = crawlEntry.url;
    const match = parsedBySameAs.get(crawlUrl);

    if (match) {
      matchedParsed.add(match);
      matchedCrawl.add(crawlEntry);
      mergedOnlyOverlap.push(mergeRestaurants(match, crawlEntry));
    } else {
      onlyCrawl.push(crawlEntry);
    }
  });

  const onlyParsed = parsedData.filter(p => !matchedParsed.has(p));

  // Extract tripadvisor.com URLs from unmatched parsed entries
  const missingCrawlTripadvisorUrls: string[] = onlyParsed.flatMap(p =>
    normalizeSameAs(p.sameAs).filter(url => url.includes('www.tripadvisor.com'))
  );

  const mergedFull = [...mergedOnlyOverlap, ...onlyCrawl, ...onlyParsed];

  const outputDir = path.dirname(parsedPath);

  function writeOutput(name: string, data: any) {
    const outPath = path.join(outputDir, `${name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Wrote ${name} → ${outPath}`);
  }

  writeOutput('merged_only_overlap', mergedOnlyOverlap);
  writeOutput('only_crawl', onlyCrawl);
  writeOutput('only_parsed', onlyParsed);
  writeOutput('merged_full', mergedFull);
  writeOutput('missing_crawl', missingCrawlTripadvisorUrls);
}

// CLI usage
const parsedFile = process.argv[2];
const crawlFile = process.argv[3];

if (!parsedFile || !crawlFile) {
  console.error('Usage: ts-node mergeRestaurantData.ts <parsed.json> <crawl.json>');
  process.exit(1);
}

mergeData(parsedFile, crawlFile);
