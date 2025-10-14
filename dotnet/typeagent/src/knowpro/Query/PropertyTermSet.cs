// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;

namespace TypeAgent.KnowPro.Query;

internal class PropertyTermSet
{
    private readonly Dictionary<string, Term> _terms;

    public PropertyTermSet()
    {
        _terms = [];
    }

    public void Add(string propertyName, Term propertyValue)
    {
        var key = MakeKey(propertyName, propertyValue.Text);
        _terms.TryAdd(key, propertyValue);
    }

    public bool Has(string propertyName, Term propertyValue)
    {
        var key = MakeKey(propertyName, propertyValue.Text);
        return _terms.ContainsKey(key);
    }

    public bool Has(string propertyName, string propertyValueText)
    {
        var key = MakeKey(propertyName, propertyValueText);
        return _terms.ContainsKey(key);
    }

    public void Clear()
    {
        _terms.Clear();
    }

    private static string MakeKey(string propertyName, string propertyValueText)
    {
        return $"{propertyName}:{propertyValueText}";
    }
}
