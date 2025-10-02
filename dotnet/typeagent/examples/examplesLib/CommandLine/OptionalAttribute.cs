// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib.CommandLine;

[AttributeUsage(AttributeTargets.Parameter)]
public class OptionalAttribute : Attribute
{
    public OptionalAttribute() { }
}
