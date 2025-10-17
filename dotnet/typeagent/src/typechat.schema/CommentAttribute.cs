// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

/// <summary>
/// Comment to add to the exported schema
/// </summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public class CommentAttribute : Attribute
{
    public CommentAttribute() { }

    public CommentAttribute(string text)
    {
        Text = text;
    }

    public string? Text { get; set; }

    public bool HasText => !string.IsNullOrEmpty(Text);
}
