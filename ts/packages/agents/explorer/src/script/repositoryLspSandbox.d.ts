// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Additional declarations presented only to the LSP benchmark variant.

interface LspRequest {
    method: "definition" | "references";
    path: string;
    // 1-based source line hint; the host resolves the nearest exact identifier.
    line: number;
    symbol: string;
    maxResults?: number;
}

interface LspLocation {
    path: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
}

interface RepositoryApi {
    lsp(request: LspRequest): Promise<LspLocation[]>;
}
