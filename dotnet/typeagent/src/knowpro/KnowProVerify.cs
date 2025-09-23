// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro;

public class KnowProVerify
{
    public static void VerifyMessageOrdinal(int messageOrdinal)
    {
        ArgumentVerify.ThrowIfLessThan(messageOrdinal, 0, nameof(messageOrdinal));
    }

    public static void VerifySemanticRefOrdinal(int semanticRefOrdinal)
    {
        ArgumentVerify.ThrowIfLessThan(semanticRefOrdinal, 0, nameof(semanticRefOrdinal));
    }
}
