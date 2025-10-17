// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Settings that impact how schema is exported to support Json polymorphism
/// See <a href="https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism">Json Polymorphism</a> for more information
/// </summary>
public class JsonPolymorphismSettings
{
    /// <summary>
    /// Discriminators are needed for Json Polymorphism: so the Json Deserializer can distinguish which 
    /// object should be deserialized to instances of which sub-class
    /// By default discriminators are emitted and in a format recognized by System.Text.Json serilization
    ///   "$type": "{type.Name}"
    /// You can customize this using 
    /// </summary>
    public bool IncludeDiscriminator { get; set; } = true;

    /// <summary>
    /// Include a comment reminding the model to emit the discriminator first
    /// </summary>
    public bool IncludeComment { get; set; } = true;

    /// <summary>
    /// Use this to customize how type discriminators are produced.
    /// By default, the name of the type is used
    /// </summary>
    public Func<Type, string> DiscriminatorGenerator { get; set; }
}
