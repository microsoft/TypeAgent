// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace TypeAgent.KnowPro.Query;

internal class TermSet
{
    Dictionary<string, Term> _termSet;

    public TermSet()
    {
        _termSet = [];
    }

    public int Count => _termSet.Count;

    public bool Has(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));

        return _termSet.ContainsKey(term.Text);
    }

    public Term? Get(string term) => _termSet.GetValueOrDefault(term);

    public Term? Get(Term term) => Get(term.Text);

    public bool Add(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));

        if (_termSet.ContainsKey(term.Text))
        {
            return false;
        }
        _termSet.Add(term.Text, term);
        return true;
    }

    public void AddOrUnion(IEnumerable<Term> terms)
    {
        ArgumentVerify.ThrowIfNull(terms, nameof(terms));
        foreach (var term in terms)
        {
            AddOrUnion(term);
        }
    }

    public void AddOrUnion(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));

        if (_termSet.TryGetValue(term.Text, out var existingTerm))
        {
            var existingScore = existingTerm.Weight ?? 0;
            var newScore = term.Weight ?? 0;
            if (existingScore < newScore)
            {
                existingTerm.Weight = newScore;
            }
        }
        else
        {
            _termSet[term.Text] = term;
        }
    }

    public void Remove(Term term)
    {
        ArgumentVerify.ThrowIfNull(term, nameof(term));
        _termSet.Remove(term.Text);
    }

    public void Clear()
    {
        _termSet.Clear();
    }
}
