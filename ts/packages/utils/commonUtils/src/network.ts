// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const nonPublicIpv4 = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    nonPublicIpv4.addSubnet(network, prefix, "ipv4");
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

const publicIpv6Exceptions = new BlockList();
for (const [network, prefix] of [
    ["2001:1::1", 128],
    ["2001:1::2", 128],
    ["2001:1::3", 128],
    ["2001:3::", 32],
    ["2001:4:112::", 48],
    ["2001:20::", 28],
    ["2001:30::", 28],
] as const) {
    publicIpv6Exceptions.addSubnet(network, prefix, "ipv6");
}

const nonPublicIpv6 = new BlockList();
for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["100:0:0:1::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
] as const) {
    nonPublicIpv6.addSubnet(network, prefix, "ipv6");
}

export type PublicIpAddress = {
    address: string;
    family: 4 | 6;
};

export type HostnameResolver = (
    hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

export function createPinnedLookup(address: PublicIpAddress) {
    return {
        family: address.family,
        lookup: (
            _hostname: string,
            _options: unknown,
            callback: (
                error: NodeJS.ErrnoException | null,
                resolvedAddress: string,
                family: number,
            ) => void,
        ) => callback(null, address.address, address.family),
    };
}

export class PrivateNetworkTargetError extends Error {
    constructor(hostname: string) {
        super(`Private network target is not allowed: ${hostname}`);
        this.name = "PrivateNetworkTargetError";
    }
}

function normalizeHostname(hostname: string): string {
    let normalized = hostname.toLowerCase();
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        normalized = normalized.slice(1, -1);
    }
    while (normalized.endsWith(".")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

export function isPublicIpAddress(address: string): boolean {
    const normalized = normalizeHostname(address);
    const family = isIP(normalized);
    if (family === 4) {
        return !nonPublicIpv4.check(normalized, "ipv4");
    }
    if (family === 6) {
        return (
            globalIpv6.check(normalized, "ipv6") &&
            (publicIpv6Exceptions.check(normalized, "ipv6") ||
                !nonPublicIpv6.check(normalized, "ipv6"))
        );
    }
    return false;
}

const defaultHostnameResolver: HostnameResolver = (hostname) =>
    lookup(hostname, { all: true, verbatim: true });

export async function resolvePublicIpAddress(
    hostname: string,
    resolveHostname: HostnameResolver = defaultHostnameResolver,
): Promise<PublicIpAddress> {
    const normalized = normalizeHostname(hostname);
    if (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".internal") ||
        normalized.endsWith(".home.arpa")
    ) {
        throw new PrivateNetworkTargetError(hostname);
    }

    const family = isIP(normalized);
    if (family !== 0) {
        if (!isPublicIpAddress(normalized)) {
            throw new PrivateNetworkTargetError(hostname);
        }
        return { address: normalized, family: family as 4 | 6 };
    }

    const lookupResults = await resolveHostname(normalized);
    const addresses = lookupResults.map(({ address }) => {
        const normalizedAddress = normalizeHostname(address);
        return {
            address: normalizedAddress,
            family: isIP(normalizedAddress),
        };
    });
    if (
        addresses.length === 0 ||
        addresses.some(
            ({ address, family: addressFamily }) =>
                addressFamily === 0 || !isPublicIpAddress(address),
        )
    ) {
        throw new PrivateNetworkTargetError(hostname);
    }

    const selected = addresses[0];
    return {
        address: selected.address,
        family: selected.family as 4 | 6,
    };
}
