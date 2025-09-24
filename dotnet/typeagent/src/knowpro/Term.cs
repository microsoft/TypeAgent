// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Term
{
    /// <summary>
    /// The text of the term
    /// </summary>
    public string Text { get; set; }
    /// <summary>
    /// Optional weighting for the term
    /// </summary>
    public float? Weight { get; set; }

    public static string PrepareTermText(string termText)
    {
        termText = termText.Trim();
        return termText.ToLower();
    }
}
