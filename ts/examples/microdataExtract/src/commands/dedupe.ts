// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as path from 'path';
import { DedupeRestaurant } from '../lib/restaurantTypes.js';

export default class Dedupe extends Command {
    static description = 'Deduplicate restaurant data by URL';
  
    static examples = [
      '<%= config.bin %> dedupe path/to/restaurants.json',
      '<%= config.bin %> dedupe path/to/restaurants.json --output custom_output.json',
    ];
  
    static flags = {
      output: Flags.string({
        char: 'o',
        description: 'Custom output filename',
        required: false,
      }),
    };
  
    static args = {
      input: Args.string({
        description: 'Path to input JSON file containing restaurant data',
        required: true,
      }),
    };
  
    async run(): Promise<void> {
      const { args, flags } = await this.parse(Dedupe);
      const inputPath = args.input;
  
      if (!fs.existsSync(inputPath)) {
        this.error(`File not found: ${inputPath}`);
        return;
      }
  
      let data: DedupeRestaurant[];
  
      try {
        const rawData = fs.readFileSync(inputPath, 'utf-8');
        data = JSON.parse(rawData);
      } catch (e) {
        this.error(`Failed to parse JSON: ${e}`);
        return;
      }
  
      if (!Array.isArray(data)) {
        this.error('Expected a JSON array of restaurant objects.');
        return;
      }
  
      const seen = new Set<string>();
      const deduped = data.filter((entry) => {
        if (entry.url && !seen.has(entry.url)) {
          seen.add(entry.url);
          return true;
        }
        return false;
      });
  
      const parsedPath = path.parse(inputPath);
      let outputPath: string;
  
      if (flags.output) {
        outputPath = path.join(parsedPath.dir, flags.output);
      } else {
        outputPath = path.join(
          parsedPath.dir,
          `${parsedPath.name}_deduped${parsedPath.ext}`,
        );
      }
  
      fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf-8');
      this.log(`Deduplicated data written to ${outputPath}`);
      this.log(`Original entries: ${data.length}, Deduplicated entries: ${deduped.length}`);
    }
  }