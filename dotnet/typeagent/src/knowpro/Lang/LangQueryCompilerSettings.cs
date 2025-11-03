// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

public class LangQueryCompilerSettings
{
    public LangQueryCompilerSettings()
    {
        ApplyScope = true;
        ExactScope = false;
        VerbScope = true;
    }

    public LangQueryCompilerSettings(LangQueryCompilerSettings src)
    {
        ArgumentVerify.ThrowIfNull(src, nameof(src));
        ApplyScope = src.ApplyScope;
        ExactScope = src.ExactScope;
        VerbScope = src.VerbScope;
        TermFilter = src.TermFilter;
    }

    /// <summary>
    /// Is fuzzy matching enabled when applying scope?
    /// </summary>
    public bool ExactScope { get; set; }
    /// <summary>
    /// Is fuzzy matching enabled when applying scope?
    /// </summary>
    public bool VerbScope { get; set; }
    /// <summary>
    /// Are scope constraints enabled 
    /// </summary>
    public bool ApplyScope { get; set; }
    /// <summary>
    /// Use to ignore noise terms etc.
    /// </summary>
    public Func<string, bool>? TermFilter { get; set; }
}
