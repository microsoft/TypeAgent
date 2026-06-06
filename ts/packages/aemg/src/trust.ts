// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Trust tiers gate every merge and supersession decision in AEMG.
 * Higher tiers win conflicts against lower tiers.
 */
export enum TrustTier {
    ExternalInferred = 0,
    ExtractorInferred = 1,
    ToolObserved = 2,
    UserAsserted = 3,
}

export function trustRank(tier: TrustTier): number {
    return tier;
}

/** Returns true if `a` is at least as trusted as `b`. */
export function trustAtLeast(a: TrustTier, b: TrustTier): boolean {
    return trustRank(a) >= trustRank(b);
}
