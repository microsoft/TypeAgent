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

    [JsonIgnore]
    public bool HasName => !string.IsNullOrEmpty(Name);

    [JsonIgnore]
    public bool HasTypes => !Type.IsNullOrEmpty();

    [JsonIgnore]
    public bool HasFacets => !Facets.IsNullOrEmpty();
}

public partial class Action
{
    const string NoneEntityName = "none";

    public Action()
    {
        Verbs = [];
        SubjectEntityName = NoneEntityName;
        ObjectEntityName = NoneEntityName;
        IndirectObjectEntityName = NoneEntityName;
    }

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
}

public partial class Topic
{
    public static implicit operator string(Topic topic)
    {
        return topic.Text;
    }
}

public partial class Tag
{
    public static implicit operator string(Tag tag)
    {
        return tag.Text;
    }
}

