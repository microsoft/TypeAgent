// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.KnowPro.Lang;

// Custom converter for ActorEntitiesUnion
public class ActorEntitiesConverter : JsonConverter<ActorEntities>
{
    public override ActorEntities Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String && reader.GetString() == "*")
        {
            reader.Read();
            return new ActorEntities { IsWildcard = true };
        }
        else if (reader.TokenType == JsonTokenType.StartArray)
        {
            var entities = JsonSerializer.Deserialize<List<EntityTerm>>(ref reader, options);
            return new ActorEntities { Entities = entities, IsWildcard = false };
        }
        throw new JsonException("Invalid actorEntities value.");
    }

    public override void Write(Utf8JsonWriter writer, ActorEntities value, JsonSerializerOptions options)
    {
        if (value.IsWildcard)
        {
            writer.WriteStringValue("*");
        }
        else
        {
            JsonSerializer.Serialize(writer, value.Entities, options);
        }
    }
}