// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Canonical Azure region tokens recognized by the typed Config layer.
 *
 * The list is deliberately closed: a region not in this set is rejected
 * at config-load time. Adding a new region means editing this file —
 * which forces a code review and keeps YAML files comparable across
 * developers. The escape hatch for one-off / preview regions is the
 * `extra:` passthrough on `Config`.
 */
export const REGIONS = [
    "eastus",
    "eastus2",
    "westus",
    "westus2",
    "westus3",
    "centralus",
    "northcentralus",
    "southcentralus",
    "westcentralus",
    "swedencentral",
    "francecentral",
    "germanywestcentral",
    "norwayeast",
    "northeurope",
    "westeurope",
    "uksouth",
    "ukwest",
    "switzerlandnorth",
    "japaneast",
    "japanwest",
    "australiaeast",
    "koreacentral",
    "southeastasia",
    "eastasia",
    "centralindia",
    "southindia",
    "brazilsouth",
    "canadacentral",
    "canadaeast",
] as const;

export type Region = (typeof REGIONS)[number];

const REGION_SET: ReadonlySet<string> = new Set(REGIONS);

export function isRegion(value: unknown): value is Region {
    return typeof value === "string" && REGION_SET.has(value);
}

/**
 * Convert a YAML-cased region (e.g. `swedencentral`) into the uppercase
 * env-var suffix used by the legacy `AZURE_OPENAI_*_SWEDENCENTRAL`
 * convention. Used by the compatibility shim.
 */
export function regionToEnvSuffix(region: Region): string {
    return region.toUpperCase();
}

/**
 * Inverse of `regionToEnvSuffix`: parse a single env-var suffix token
 * back into a canonical region (or `undefined` if it doesn't match).
 * Used by the importer to recognize regional variants in flat .env files.
 */
export function regionFromEnvSuffix(suffix: string): Region | undefined {
    const lower = suffix.toLowerCase();
    return REGION_SET.has(lower) ? (lower as Region) : undefined;
}

/**
 * Heuristically derive a region from an Azure OpenAI endpoint URL by
 * scanning the hostname for any canonical region token. Works for the
 * standard `*-openai-<region>*.openai.azure.com` and
 * `*.cognitiveservices.azure.com` host patterns. Returns `undefined`
 * if no token matches — caller should require an explicit `region:`.
 */
/**
 * Common short names that appear in Azure resource hostnames in
 * place of the canonical region token (e.g. `*-openai-sweden*` for
 * `swedencentral`). Used by `regionFromUrl` so that hosts like
 * `octo-aisystems-openai-sweden.openai.azure.com` resolve cleanly
 * without needing an explicit `region:` in the YAML.
 */
const URL_REGION_ALIASES: ReadonlyMap<string, Region> = new Map([
    ["sweden", "swedencentral"],
    ["france", "francecentral"],
    ["korea", "koreacentral"],
    ["japan", "japaneast"],
    ["uk", "uksouth"],
    ["australia", "australiaeast"],
    ["canada", "canadacentral"],
    ["brazil", "brazilsouth"],
    ["norway", "norwayeast"],
    ["switzerland", "switzerlandnorth"],
    ["germany", "germanywestcentral"],
    ["india", "centralindia"],
]);

export function regionFromUrl(url: string): Region | undefined {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase();
    } catch {
        return undefined;
    }
    // Prefer the longest canonical match so e.g. "eastus2" wins over "eastus".
    let best: Region | undefined;
    for (const r of REGIONS) {
        if (host.includes(r) && (!best || r.length > best.length)) {
            best = r;
        }
    }
    if (best) return best;
    // Fall back to known short-form aliases.
    for (const [alias, region] of URL_REGION_ALIASES) {
        if (host.includes(alias)) return region;
    }
    return undefined;
}
