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
