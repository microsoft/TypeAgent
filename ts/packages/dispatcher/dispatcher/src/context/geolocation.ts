// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:geolocation");

export interface GeoLocation {
    city: string;
    region: string;
    country: string;
    lat: number;
    lon: number;
    timezone: string;
}

let cachedLocation: GeoLocation | undefined;
let initPromise: Promise<GeoLocation | undefined> | undefined;

/**
 * Initialize geolocation by querying an IP-based geolocation API.
 * The result is cached for the lifetime of the process.
 * Safe to call multiple times; subsequent calls return the cached result.
 */
export async function initializeGeolocation(): Promise<
    GeoLocation | undefined
> {
    if (cachedLocation) {
        return cachedLocation;
    }
    if (initPromise) {
        return initPromise;
    }
    initPromise = fetchGeolocation();
    cachedLocation = await initPromise;
    initPromise = undefined;
    return cachedLocation;
}

/**
 * Get the cached geolocation. Returns undefined if not yet initialized
 * or if the lookup failed.
 */
export function getCachedGeolocation(): GeoLocation | undefined {
    return cachedLocation;
}

/**
 * Get a human-readable location string for use in prompts.
 * Returns undefined if geolocation is not available.
 */
export function getLocationString(): string | undefined {
    if (!cachedLocation) {
        return undefined;
    }
    const { city, region, country, lat, lon, timezone } = cachedLocation;
    return (
        `Location: ${city}, ${region}, ${country} ` +
        `(lat ${lat}, lon ${lon}). Timezone: ${timezone}.`
    );
}

async function fetchGeolocation(): Promise<GeoLocation | undefined> {
    try {
        // ip-api.com is free for non-commercial use and requires no API key.
        // It returns JSON with city, regionName, country, lat, lon, timezone.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(
                "http://ip-api.com/json/?fields=city,regionName,country,lat,lon,timezone",
                { signal: controller.signal },
            );
            if (!response.ok) {
                debug(`Geolocation API returned ${response.status}`);
                return undefined;
            }
            const data = (await response.json()) as {
                city?: string;
                regionName?: string;
                country?: string;
                lat?: number;
                lon?: number;
                timezone?: string;
            };
            if (
                data.city &&
                data.regionName &&
                data.country &&
                data.lat !== undefined &&
                data.lon !== undefined &&
                data.timezone
            ) {
                const location: GeoLocation = {
                    city: data.city,
                    region: data.regionName,
                    country: data.country,
                    lat: data.lat,
                    lon: data.lon,
                    timezone: data.timezone,
                };
                debug(`Geolocation resolved: ${JSON.stringify(location)}`);
                return location;
            }
            debug(`Geolocation API returned incomplete data`);
            return undefined;
        } finally {
            clearTimeout(timeout);
        }
    } catch (e: any) {
        debug(`Geolocation lookup failed: ${e.message}`);
        return undefined;
    }
}
