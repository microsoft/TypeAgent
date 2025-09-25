// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public partial class ConcreteEntity
{
    [JsonIgnore]
    public bool HasFacets => !Facets.IsNullOrEmpty();

    public string ToJson()
    {
        return Serializer.ToJson(this);
    }

    public static ConcreteEntity FromJson(string json)
    {
        return Serializer.FromJson<ConcreteEntity>(json);
    }
}

public partial class Action
{
    const string NoneEntityName = "none";

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
