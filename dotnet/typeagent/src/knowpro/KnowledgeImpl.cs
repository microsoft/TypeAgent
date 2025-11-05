// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public partial class ConcreteEntity
{
    public ConcreteEntity()
    {
        Name = string.Empty;
        Type = [];
    }

    public ConcreteEntity(string name, string type)
    {
        this.Name = name;
        this.Type = [type];
    }

    public override KnowledgeType KnowledgeType => KnowledgeType.Entity;

    [JsonIgnore]
    public bool HasName => !string.IsNullOrEmpty(Name);

    [JsonIgnore]
    public bool HasTypes => !Type.IsNullOrEmpty();

    [JsonIgnore]
    public bool HasFacets => !Facets.IsNullOrEmpty();

    public void MergeEntityFacet(Facet facet)
    {
        if (Facets.IsNullOrEmpty())
        {
            Facets = [];
        }
        else
        {
            // Look for an equal facet
            foreach (var f in Facets)
            {
                if (f.Match(facet))
                {
                    return;
                }
            }
        }
        Facets = Facets.Append(facet);
    }

    internal MergedEntity ToMerged()
    {
        List<string> types = [.. Type];
        types.LowerAndSort();

        return new MergedEntity()
        {
            Name = Name.ToLower(),
            Type = types,
            Facets = !Facets.IsNullOrEmpty() ? ToMergedFacets() : null
        };
    }

    internal MergedFacets ToMergedFacets()
    {
        MergedFacets mergedFacets = [];
        if (!Facets.IsNullOrEmpty())
        {
            foreach (var facet in Facets)
            {
                string name = facet.Name.ToLower();
                string value = facet.Value.ToString().ToLower();
                mergedFacets.AddUnique(name, value);
            }
        }
        return mergedFacets;
    }

}

public partial class Action
{
    public const string NoneEntityName = "none";

    public Action()
    {
        Verbs = [];
        SubjectEntityName = NoneEntityName;
        ObjectEntityName = NoneEntityName;
        IndirectObjectEntityName = NoneEntityName;
    }

    public override KnowledgeType KnowledgeType => KnowledgeType.Action;

    [JsonIgnore]
    public bool HasVerbs => !Verbs.IsNullOrEmpty();

    [JsonIgnore]
    public bool HasSubject => IsDefined(SubjectEntityName);

    [JsonIgnore]
    public bool HasObject => IsDefined(ObjectEntityName);

    [JsonIgnore]
    public bool HasIndirectObject => IsDefined(IndirectObjectEntityName);

    public string VerbString() => string.Join(" ", Verbs);

    private static bool IsDefined(string value)
    {
        return !string.IsNullOrEmpty(value) && value != NoneEntityName;
    }

    public override string ToString()
    {
        StringBuilder text = new StringBuilder();

        AppendEntityName(text, SubjectEntityName);

        text.Append($" [{VerbString()}]");

        AppendEntityName(text, ObjectEntityName);
        AppendEntityName(text, IndirectObjectEntityName);

        text.Append($" {{{VerbTense}}}");

        if (SubjectEntityFacet is not null)
        {
            text.Append($" <{SubjectEntityFacet.ToString()}>");
        }
        return text.ToString();
    }

    private void AppendEntityName(StringBuilder text, string? name)
    {
        if (text.Length > 0)
        {
            text.Append(' ');
        }
        text.Append(IsDefined(name)
            ? $"<{name}>"
            : "<>");
    }
}

public partial class Topic
{
    public Topic()
    {

    }

    public Topic(string text)
    {
        Text = text;
    }

    public override KnowledgeType KnowledgeType => KnowledgeType.Topic;

    public static implicit operator string(Topic topic)
    {
        return topic.Text;
    }
}

public partial class Tag
{
    public override KnowledgeType KnowledgeType => KnowledgeType.Tag;

    public static implicit operator string(Tag tag)
    {
        return tag.Text;
    }
}

public partial class StructuredTag
{
    public override KnowledgeType KnowledgeType => KnowledgeType.STag;
}


public partial class KnowledgeResponse
{
    public IEnumerable<SemanticRef> ToSemanticRefs(TextRange range)
    {
        ArgumentVerify.ThrowIfNull(range, nameof(range));

        if (!Entities.IsNullOrEmpty())
        {
            foreach (var entity in Entities)
            {
                yield return new SemanticRef(entity, range);
            }
        }

        if (!Topics.IsNullOrEmpty())
        {
            foreach (var topic in Topics)
            {
                yield return new SemanticRef(new Topic(topic), range);
            }
        }

        if (!Actions.IsNullOrEmpty())
        {
            foreach (var action in Actions)
            {
                yield return new SemanticRef(action, range);
            }
        }

        if (!InverseActions.IsNullOrEmpty())
        {
            foreach (var action in InverseActions)
            {
                yield return new SemanticRef(action, range);
            }
        }
    }

    //
    // Some knowledge found via actions is actually meant for entities...
    //
    internal void MergeActionKnowledge()
    {
        if (Actions.IsNullOrEmpty())
        {
            return;
        }
        foreach (var action in Actions)
        {
            if (action.SubjectEntityFacet is not null)
            {
                ConcreteEntity? entity = Array.Find(Entities, (c) => c.Name == action.SubjectEntityName);
                entity?.MergeEntityFacet(action.SubjectEntityFacet);
                action.SubjectEntityFacet = null;
            }
        }
    }
}
