// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public partial class ConcreteEntity
{
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

    private static bool IsDefined(string value)
    {
        return !string.IsNullOrEmpty(value) && value != NoneEntityName;
    }
}
