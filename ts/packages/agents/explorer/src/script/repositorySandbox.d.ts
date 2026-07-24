// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Declarations presented to and enforced for generated repository scripts.

interface LsOptions {
    depth?: number;
    maxEntries?: number;
}

interface GrepOptions {
    path?: string;
    glob?: string;
    literal?: boolean;
    maxMatches?: number;
}

interface GlobOptions {
    maxMatches?: number;
}

interface ReadOptions {
    offset?: number;
    // Host-clamped to 200 lines per read.
    limit?: number;
}

interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

interface ExploreLocation {
    path: string;
    startLine: number;
    endLine: number;
}

interface ReadResult {
    text: string;
    location?: ExploreLocation;
}

interface RepositoryApi {
    ls(relativePath?: string, options?: LsOptions): Promise<string[]>;
    glob(pattern: string, options?: GlobOptions): Promise<string[]>;
    grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;
    read(relativePath: string, options?: ReadOptions): Promise<ReadResult>;
}

type ExploreParams = FlowParams;

interface ExploreProgramResult {
    success: boolean;
    message?: string;
    error?: string;
    // Discovery returns []; refinement returns its final repository-grounded
    // locations so the host can validate and submit without another completion.
    locations?: ExploreLocation[];
}

interface DiscoveryProgramResult extends ExploreProgramResult {
    locations: [];
}

interface RefinementProgramResult extends ExploreProgramResult {
    // The host rejects an empty array at runtime.
    locations: ExploreLocation[];
}
