// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowProTest;

/// <summary>
///  A Parameterized search request to run against the index
/// Includes several "test" flags that are mapped to their lower level equivalents
/// </summary>
public class SearchRequest
{
    public string Query { get; set; } = string.Empty;

    public bool? ApplyScope { get; set; }

    public int? CharBudget { get; set; }

    public bool? Exact { get; set; }

    public bool? ExactScope { get; set; }

    public bool? Fallback { get; set; }

    public int? MessageTopK { get; set; }

    public KnowledgeType? KType { get; set; }

    public string? Tag { get; set; }

    public string? Thread { get; set; }

    public string? When { get; set; }

    public bool? Scoped { get; set; }
}
