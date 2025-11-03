// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.KnowledgeExtractor;

public class Action : TypeAgent.KnowPro.Action
{
    [JsonPropertyName("inverseVerbs")]
    public string[]? InverseVerbs { get; set; }

    public TypeAgent.KnowPro.Action? ToInverseAction()
    {
        if (InverseVerbs.IsNullOrEmpty())
        {
            return null;
        }
        var inverseVerbs = InverseVerbs.Filter(
            (v) => !string.IsNullOrEmpty(v) && v != NoneEntityName
        );
        if (inverseVerbs.IsNullOrEmpty())
        {
            return null;
        }

        string? subjectEntityName = null;
        string? objectEntityName = null;
        string? indirectObjectEntityName = NoneEntityName;
        if (!string.IsNullOrEmpty(ObjectEntityName))
        {
            subjectEntityName = ObjectEntityName;
            objectEntityName = SubjectEntityName;
        }
        else if (!string.IsNullOrEmpty(indirectObjectEntityName))
        {
            subjectEntityName = IndirectObjectEntityName;
            indirectObjectEntityName = SubjectEntityName;
        }
        if (string.IsNullOrEmpty(subjectEntityName) || subjectEntityName == NoneEntityName)
        {
            return null;
        }
        TypeAgent.KnowPro.Action action = new()
        {
            Verbs = InverseVerbs,
            VerbTense = VerbTense,
            SubjectEntityName = subjectEntityName,
            ObjectEntityName = objectEntityName,
            IndirectObjectEntityName = indirectObjectEntityName,
            SubjectEntityFacet = SubjectEntityFacet,
        };
        if (!Params.IsNullOrEmpty())
        {
            action.Params = Params;
        }
        return action;
    }
}

public class KnowledgeResponse
{
    [JsonPropertyName("entities")]
    [JsonRequired]
    public ConcreteEntity[] Entities { get; set; }

    [JsonPropertyName("actions")]
    [JsonRequired]
    public Action[] Actions { get; set; }

    [JsonPropertyName("topics")]
    public string[] Topics { get; set; }
}
