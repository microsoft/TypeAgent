// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class LangSearchFilter
{
    public KnowledgeType? KnowledgeType { get; set; }

    public string? ThreadDescription { get; set; }

    public IList<string>? Tags { get; set; }

    public SearchTermGroup? ScopeDefiningTerms { get; set; }
}
