// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace KnowProConsole;

public static class KnowProWriter
{
    public static void Write(ConcreteEntity entity)
    {
        if (entity is not null)
        {
            Console.WriteLine(entity.Name.ToUpper());
        }
    }
}
