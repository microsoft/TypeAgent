import * as fs from 'fs';
import * as path from 'path';

interface Restaurant {
  url: string;
  [key: string]: any;
}

function dedupeRestaurantsByUrl(inputPath: string): void {
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    return;
  }

  const rawData = fs.readFileSync(inputPath, 'utf-8');
  let data: Restaurant[];

  try {
    data = JSON.parse(rawData);
  } catch (e) {
    console.error(`Failed to parse JSON: ${e}`);
    return;
  }

  if (!Array.isArray(data)) {
    console.error('Expected a JSON array of restaurant objects.');
    return;
  }

  const seen = new Set<string>();
  const deduped = data.filter(entry => {
    if (entry.url && !seen.has(entry.url)) {
      seen.add(entry.url);
      return true;
    }
    return false;
  });

  const parsedPath = path.parse(inputPath);
  const outputPath = path.join(parsedPath.dir, `${parsedPath.name}_deduped${parsedPath.ext}`);

  fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf-8');
  console.log(`Deduplicated data written to ${outputPath}`);
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: ts-node dedupeRestaurants.ts <path-to-json>');
  process.exit(1);
}

dedupeRestaurantsByUrl(inputFile);
