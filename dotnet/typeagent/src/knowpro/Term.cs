// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class Term
{
    public Term(string termText, float? weight = null)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(termText, nameof(termText));
        Text = termText;
        Weight = weight;
    }

    /// <summary>
    /// The text of the term
    /// </summary>
    public string Text { get; }

    /// <summary>
    /// Optional weighting for the term
    /// </summary>
    public float? Weight { get; set; }

    public override string ToString()
    {
        return Weight is not null ? $"{Text} [{Weight}]" : Text;
    }

    public static implicit operator string(Term term)
    {
        return term.Text;
    }

    public static implicit operator Term(string term)
    {
        return new Term(term);
    }

    public static string PrepareTermText(string termText)
    {
        termText = termText.Trim();
        return termText.ToLower();
    }
}
