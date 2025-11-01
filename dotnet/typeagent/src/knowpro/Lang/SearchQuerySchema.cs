// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class FacetTerm
{
    // the name of the facet, such as "color", "profession", "patent number"; "*" means match any facet name
    [Comment("the name of the facet, such as \"color\", \"profession\", \"patent number\"; \"*\" means match any facet name")]
    [JsonPropertyName("facetName")]
    [JsonRequired]
    public string FacetName { get; set; } = string.Empty;

    // the value of the facet, such as "red", "writer"; "*" means match any facet value
    [Comment("the value of the facet, such as \"red\", \"writer\"; \"*\" means match any facet value")]
    [JsonPropertyName("facetValue")]
    [JsonRequired]
    public string FacetValue { get; set; } = string.Empty;
}

// Use to find information about specific, tangible people, places, institutions or things only..
// This includes entities with particular facets
// Abstract concepts or topics are not entityTerms. Use string for them
// Any terms will match fuzzily.
[Comment("Use to find information about specific, tangible people, places, institutions or things only..\nThis includes entities with particular facets\nAbstract concepts or topics are not entityTerms. Use string for them\nAny terms will match fuzzily.")]
public class EntityTerm
{
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano" or "we", "I"; "*" means match any entity name
    [Comment("the name of the entity or thing such as \"Bach\", \"Great Gatsby\", \"frog\" or \"piano\" or \"we\", \"I\"; \"*\" means match any entity name")]
    [JsonPropertyName("name")]
    [JsonRequired]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("isNamePronoun")]
    public bool IsNamePronoun { get; set; }

    // the specific types of the entity such as "book", "movie", "song", "speaker", "person", "artist", "animal", "instrument", "school", "room", "museum", "food" etc.
    // Generic types like "object", "thing" etc. are NOT allowed
    // An entity can have multiple types; entity types should be single words
    [Comment("the specific types of the entity such as \"book\", \"movie\", \"song\", \"speaker\", \"person\", \"artist\", \"animal\", \"instrument\", \"school\", \"room\", \"museum\", \"food\" etc.\nGeneric types like \"object\", \"thing\" etc. are NOT allowed\nAn entity can have multiple types; entity types should be single words")]
    [JsonPropertyName("type")]
    public List<string>? Type { get; set; }

    // Facet terms search for properties or attributes of the entity.
    // Eg: color(blue), profession(writer), author(*), aunt(Agatha), weight(4kg), phoneNumber(...), etc.
    [Comment("Facet terms search for properties or attributes of the entity.\nEg: color(blue), profession(writer), author(*), aunt(Agatha), weight(4kg), phoneNumber(...), etc.")]
    [JsonPropertyName("facets")]
    public List<FacetTerm>? Facets { get; set; }
}

public enum VerbsTermTense
{
    Past,
    Present,
    Future
}

public class VerbsTerm
{
    // individual words in single or compound verb
    [Comment("individual words in single or compound verb")]
    [JsonPropertyName("words")]
    [JsonRequired]
    public List<string> Words { get; set; }

    [JsonPropertyName("tense")]
    public VerbsTermTense Tense { get; set; }
}

public class ActionTerm
{
    // Action verbs describing the interaction
    [Comment("Action verbs describing the interaction")]
    [JsonPropertyName("actionVerbs")]
    public VerbsTerm? ActionVerbs { get; set; }

    // The origin of the action or information, typically the entity performing the action
    [Comment("The origin of the action or information, typically the entity performing the action")]
    [JsonPropertyName("actorEntities")]
    [JsonRequired]
    public ActorEntities ActorEntities { get; set; } = new();

    // the recipient or target of the action or information
    // Action verbs can imply relevant facet names on the targetEntity. E.g. write -> writer, sing -> singer etc.
    [Comment("the recipient or target of the action or information\nAction verbs can imply relevant facet names on the targetEntity. E.g. write -> writer, sing -> singer etc.")]
    [JsonPropertyName("targetEntities")]
    public List<EntityTerm>? TargetEntities { get; set; }

    // additional entities participating in the action.
    // E.g. in the phrase "Jane ate the spaghetti with the fork", "the fork" would be an additional entity
    // E.g. in the phrase "Did Jane speak about Bach with Nina", "Bach" would be the additional entity "
    [Comment("additional entities participating in the action.\nE.g. in the phrase \"Jane ate the spaghetti with the fork\", \"the fork\" would be an additional entity\nE.g. in the phrase \"Did Jane speak about Bach with Nina\", \"Bach\" would be the additional entity")]
    [JsonPropertyName("additionalEntities")]
    public List<EntityTerm>? AdditionalEntities { get; set; }

    // Is the intent of the phrase translated to this ActionTerm to actually get information about a specific entities?
    // Examples:
    // true: if asking for specific information about an entity, such as "What is Mia's phone number?" or "Where did Jane study?"
    // false if involves actions and interactions between entities, such as "What phone number did Mia mention in her note to Jane?"
    [Comment("Is the intent of the phrase translated to this ActionTerm to actually get information about a specific entities?\nExamples:\ntrue: if asking for specific information about an entity, such as \"What is Mia's phone number?\" or \"Where did Jane study?\"\nfalse if involves actions and interactions between entities, such as \"What phone number did Mia mention in her note to Jane?\"")]
    [JsonPropertyName("isInformational")]
    public bool IsInformational { get; set; }
}

public class SearchFilter
{
    [JsonPropertyName("actionSearchTerm")]
    public ActionTerm? ActionSearchTerm { get; set; }

    // entitySearchTerms cannot contain entities already in actionSearchTerms
    [Comment("entitySearchTerms cannot contain entities already in actionSearchTerms")]
    [JsonPropertyName("entitySearchTerms")]
    public List<EntityTerm>? EntitySearchTerms { get; set; }

    // Concepts, topics or other terms that don't fit ActionTerms or EntityTerms
    // - Do not use noisy searchTerms like "topic", "topics", "subject", "discussion" etc. even if they are mentioned in the user request
    // - Phrases like 'email address' or 'first name' are a single term
    // - use empty searchTerms array when use asks for summaries
    [Comment("Concepts, topics or other terms that don't fit ActionTerms or EntityTerms\n- Do not use noisy searchTerms like \"topic\", \"topics\", \"subject\", \"discussion\" etc. even if they are mentioned in the user request\n- Phrases like 'email address' or 'first name' are a single term\n- use empty searchTerms array when use asks for summaries")]
    [JsonPropertyName("searchTerms")]
    public List<string>? SearchTerms { get; set; }

    // Use only if request explicitly asks for time range, particular year, month etc.
    [Comment("Use only if request explicitly asks for time range, particular year, month etc.")]
    [JsonPropertyName("timeRange")]
    public DateTimeRange? TimeRange { get; set; }
}

public class SearchExpr
{
    [JsonPropertyName("rewrittenQuery")]
    public string RewrittenQuery { get; set; } = string.Empty;

    [JsonPropertyName("filters")]
    [JsonRequired]
    public List<SearchFilter> Filters { get; set; }
}

// One expression for each search required by user request
// Each SearchExpr runs independently, so make them standalone by resolving references like 'it', 'that', 'them' etc.
[Comment("One expression for each search required by user request\nEach SearchExpr runs independently, so make them standalone by resolving references like 'it', 'that', 'them' etc.")]
public class SearchQuery
{
    [JsonPropertyName("searchExpressions")]
    [JsonRequired]
    public List<SearchExpr> SearchExpressions { get; set; }
}

// Handles actorEntities: EntityTerm[] | "*"
[JsonConverter(typeof(ActorEntitiesConverter))]
public class ActorEntities
{
    public List<EntityTerm>? Entities { get; set; }

    public bool IsWildcard { get; set; }

    public bool IsArray()
    {
        // If the action has no subject, disable scope
        // isEntityTermArray checks for wildcards etc
        return !(IsWildcard || Entities.IsNullOrEmpty());
    }
}
