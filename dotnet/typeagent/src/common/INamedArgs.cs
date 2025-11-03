// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.Common;

public interface INamedArgs
{
    string? Get(string name);

    string GetRequired(string name);

    T? Get<T>(string name);
}
