// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class LangSearchRagOptions
{
    public int? MaxMessageMatches { get; set; }

    public bool? ExactMatch { get; set; }
    /// <summary>
    /// The maximum # of total message characters to select
    /// The query processor will ensure that the cumulative character count of message matches
    /// is less than this number
    /// </summary>
    public int? MaxCharsInBudget { get; set; }

}
