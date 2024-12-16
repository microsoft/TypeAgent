// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import fs from "fs";
import { fileURLToPath } from "node:url";
import { InstacartActions } from "./schema/userActions.mjs";
import { ECommerceSiteAgent } from "../commerce/translator.mjs";

export async function createInstacartPageTranslator(
  model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
  const packageRoot = path.join("..", "..", "..");
  const pageSchema = await fs.promises.readFile(
    fileURLToPath(
      new URL(
        path.join(packageRoot, "./src/agent/instacart/schema/userActions.mts"),
        import.meta.url,
      ),
    ),
    "utf8",
  );

  const agent = new ECommerceSiteAgent<InstacartActions>(
    pageSchema,
    "InstacartActions",
    model,
  );
  return agent;
}
