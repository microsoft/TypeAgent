// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.ConversationMemory;

public static class EntityFactory
{
    public static ConcreteEntity Person(string name) => new ConcreteEntity(name, "person");
}
