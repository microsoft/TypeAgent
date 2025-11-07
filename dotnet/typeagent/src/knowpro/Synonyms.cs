// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class TermSynonym
{
    [JsonPropertyName("term")]
    public string Term { get; set; }

    [JsonPropertyName("relatedTerms")]
    public string[] RelatedTerms { get; set; }

    public void ToLower()
    {
        Term = Term?.ToLower();
        RelatedTerms?.ToLower();
    }

    public static IList<TermSynonym> LoadResource(System.Reflection.Assembly assembly, string name)
    {
        string json = Resource.LoadResourceText(assembly, name);
        if (string.IsNullOrEmpty(json))
        {
            return [];
        }
        IList<TermSynonym> synonyms = Serializer.FromJson<TermSynonym[]>(json);
        synonyms.ForEach((s) => s.ToLower());
        return synonyms;
    }
}

public class AliasMap : MultiMap<string, Term>
{
    public AliasMap()
        : base()
    {
    }

    public AliasMap(IList<TermSynonym> synonyms)
    : base()
    {
        Add(synonyms);
    }

    public void Add(IList<TermSynonym> synonyms)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(synonyms, nameof(synonyms));
        //
        // We want to inject the primary term as an alias for each of its related terms
        // Basically flip the mapping
        //
        foreach (var ts in synonyms)
        {
            string alias = ts.Term;
            foreach (var relatedTerm in ts.RelatedTerms)
            {
                Add(relatedTerm, alias);
            }
        }
    }

    public static AliasMap LoadResource(System.Reflection.Assembly assembly, string name)
    {
        return new AliasMap(TermSynonym.LoadResource(assembly, name));
    }
}
