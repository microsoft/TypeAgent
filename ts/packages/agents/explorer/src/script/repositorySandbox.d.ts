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

interface RepositoryApi {
    ls(relativePath?: string, options?: LsOptions): Promise<string[]>;
    glob(pattern: string, options?: GlobOptions): Promise<string[]>;
    grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;
    read(relativePath: string, options?: ReadOptions): Promise<string>;
}

type ExploreParams = FlowParams;

interface ExploreProgramResult {
    success: boolean;
    message?: string;
    error?: string;
}
