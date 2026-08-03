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
    // Host-clamped to 1000 lines per read.
    limit?: number;
}

interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

interface RepositoryApi {
    ls(relativePath?: string, options?: LsOptions): Promise<string[]>;
    glob(pattern: string, options?: GlobOptions): Promise<string[]>;
    grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;
    read(relativePath: string, options?: ReadOptions): Promise<string>;
}

type ExploreParams = FlowParams;

interface ExploreLocation {
    path: string;
    startLine: number;
    endLine: number;
}

interface ExploreProgramResult {
    success: boolean;
    message?: string;
    error?: string;
    // Discovery and refinement may return advisory candidates derived from inspected evidence.
    // Candidates never ground final submission or displace independent reads.
    locations?: ExploreLocation[];
}
