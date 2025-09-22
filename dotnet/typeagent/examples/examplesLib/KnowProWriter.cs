// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ExamplesLib;

public static class KnowProPrinter
{
    public static void Write(ConcreteEntity entity)
    {
        if (entity is not null)
        {
            Console.WriteLine(entity.Name.ToUpper());
        }
    }
}
