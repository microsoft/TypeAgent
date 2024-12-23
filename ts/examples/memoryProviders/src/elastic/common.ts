import { Client } from "@elastic/elasticsearch";
import { createHash } from "crypto";

export async function createElasicClient(
    uri: string,
    createNew: boolean,
): Promise<Client> {
    if (createNew) {
        await deleteDatabase(uri);
    }

    const elasticApiKey = process.env.ELASTIC_API_KEY;
    if (!elasticApiKey) {
        throw new Error("ELASTIC_API_KEY environment variable not set");
    }

    try {
        const elasticClient = new Client({
            node: uri,
            auth: {
              apiKey : elasticApiKey
            }
        });
        return elasticClient;
    } catch (err) {
        throw new Error(`Failed to create elastic client: ${err}`);
    }
}

export async function deleteDatabase(filePath: string): Promise<void> {
    // TODO
    console.log("deleteDatabase");
}

export function generateTextId(text: string): string {
    // Hash text to create an id
    const hash = createHash("sha256").update(text, "utf-8").digest("hex");
    return hash;
}

/**
 * Converts a given string into a valid Elasticsearch index name by
 * replacing invalid characters with underscores.
 *
 * @param {string} name - The name to be converted.
 * @returns {string} A valid index name.
 */
export function toValidIndexName(name: string): string {
  // Regex of all invalid characters
  const invalidChars = /[<>\"\\\/\|\?\*]/g;
  // Replace invalid chars with underscores
  return name.replace(invalidChars, '_').toLowerCase();
}
