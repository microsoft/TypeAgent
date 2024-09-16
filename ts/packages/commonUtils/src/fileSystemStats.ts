// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";

export function getDirectorySize(directory: string) : number {
  let size = 0;
  const files = fs.readdirSync(directory);

  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(directory, files[i]);
    const stats = fs.statSync(filePath);

    if (stats.isFile()) {
      size += stats.size;
    } else if (stats.isDirectory()) {
      size += getDirectorySize(filePath);
    }
  }

  return size;
}