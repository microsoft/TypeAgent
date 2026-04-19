// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;

namespace autoShell;

/// <summary>
/// Shared JSON serialization options for consistent output formatting.
/// </summary>
internal static class JsonOptions
{
    /// <summary>
    /// Serializes with camelCase property names to match TypeScript conventions.
    /// </summary>
    public static readonly JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
