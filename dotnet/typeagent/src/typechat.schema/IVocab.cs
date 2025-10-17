// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// A Vocabulary is a string table whose values need not be hardcoded in code
/// Example: lists of product names
/// This means that each time a schema is generated, it can be different.
///
/// These string tables can be emitted in Typescript schema, e.g. like this:
/// type FourSeasons: 'Winter' | 'Spring' | 'Summer' | 'Fall'
///
/// The string tables can also be automatically validated to ensure the model sends back know strings.
/// Any error can be sent to the model for correction
/// 
/// </summary>
public interface IVocab : IEnumerable<VocabEntry>
{
    bool Contains(VocabEntry entry);
    bool Contains(VocabEntry entry, StringComparison comparison);
}
