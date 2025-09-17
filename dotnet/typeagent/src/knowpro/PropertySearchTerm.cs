// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro;

public class PropertySearchTerm : ISearchTerm
{
    /*
 * PropertySearch terms let you match named property, values
 * - You can  match a well known property name (name("Bach") type("book"))
 * - Or you can provide a SearchTerm as a propertyName.
 *   E.g. to match hue(red)
 *      - propertyName as SearchTerm, set to 'hue'
 *      - propertyValue as SearchTerm, set to 'red'
 *    We also want hue(red) to match any facets called color(red)
 * SearchTerms can included related terms
 *   E.g you could include "color" as a related term for the propertyName "hue". Or 'crimson' for red.
 *
 * See {@link KnowledgePropertyName} for well known property names
 *
 * The the query processor can also related terms using a related terms secondary index, if one is available
 */
    public IPropertyNameSearchTerm PropertyName { get; set; }
    public SearchTerm PropertyValue { get; set; }
}

public interface IPropertyNameSearchTerm { }

public class KnowledgePropertyNameSearchTerm : IPropertyNameSearchTerm
{
    public KnowledgePropertyNameSearchTerm(KnowledgePropertyName value)
    {
        Value = value;
    }

    public KnowledgePropertyName Value { get; }
}

public class PropertyNameSearchTerm : IPropertyNameSearchTerm
{
    public PropertyNameSearchTerm(SearchTerm value)
    {
        Value = value;
    }

    public SearchTerm Value { get; }
}