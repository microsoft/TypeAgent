// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro.Storage.Sqlite;

public class SqliteSemanticRefCollection : ISemanticRefCollection
{
    SqliteDatabase _db;
    int _count = -1;

    public SqliteSemanticRefCollection(SqliteDatabase database)
    {
        ArgumentVerify.ThrowIfNull(database, nameof(database));
        _db = database;
    }


    public bool IsPersistent => true;

    public Task<int> GetCountAsync()
    {
        return Task.FromResult(GetCount());
    }

    public void Append(SemanticRef semanticRef)
    {
        SemanticRefRow row = ToSemanticRefRow(semanticRef);

        using var cmd = _db.CreateCommand(
           @"INSERT INTO SemanticRefs (semref_id, range_json, knowledge_type, knowledge_json)
          VALUES (@semref_id, @range_json, @knowledge_type, @knowledge_json);"
        );
        WriteSemanticRefRow(cmd, GetNextSemanicRefId(), row);
        int rowCount = cmd.ExecuteNonQuery();
        if (rowCount > 0)
        {
            _count += rowCount;
        }
    }

    public Task AppendAsync(SemanticRef semanticRef)
    {
        Append(semanticRef);
        return Task.CompletedTask;
    }

    public Task AppendAsync(IEnumerable<SemanticRef> items)
    {
        // TODO: Bulk operations
        foreach (var sr in items)
        {
            Append(sr);
        }
        return Task.CompletedTask;
    }

    public Task<SemanticRef> GetAsync(int ordinal)
    {
        throw new NotImplementedException();
    }

    public Task<IList<SemanticRef>> GetAsync(IList<int> ordinals)
    {
        throw new NotImplementedException();
    }

    public IAsyncEnumerator<SemanticRef> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IList<SemanticRef>> GetSliceAsync(int start, int end)
    {
        throw new NotImplementedException();
    }

    int GetNextSemanicRefId()
    {
        return GetCount();
    }

    int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.MessagesTable);
        }
        return _count;
    }

    SemanticRefRow ToSemanticRefRow(SemanticRef semanticRef)
    {
        SemanticRefRow row = new();
        row.RangeJson = StorageSerializer.Serialize(semanticRef.Range);
        row.KnowledgeType = semanticRef.KnowledgeType;
        row.KnowledgeJson = StorageSerializer.Serialize(semanticRef.Knowledge);
        return row;
    }

    SemanticRef FromSemanticRefRow(SemanticRefRow semanticRefRow)
    {
        SemanticRef semanticRef = new SemanticRef();

        semanticRef.Range = StorageSerializer.Deserialize<TextRange>(semanticRefRow.RangeJson);
        semanticRef.KnowledgeType = semanticRefRow.KnowledgeType;
        semanticRef.Knowledge = SemanticRef.ParseKnowledge(semanticRefRow.KnowledgeJson, semanticRefRow.KnowledgeType);

        return semanticRef;
    }

    SemanticRefRow ReadSemanticRefRow(SqliteDataReader reader)
    {
        SemanticRefRow row = new SemanticRefRow();

        int iRow = 0;
        row.RangeJson = reader.GetStringOrNull(iRow++);
        row.KnowledgeType = reader.GetStringOrNull(iRow++);
        row.KnowledgeJson = reader.GetStringOrNull(iRow++);

        return row;
    }

    void WriteSemanticRefRow(SqliteCommand cmd, int semanticRefId, SemanticRefRow semanticRefRow)
    {
        cmd.AddParameter("@semref_id", semanticRefId);
        cmd.AddParameter("@range_json", semanticRefRow.RangeJson);
        cmd.AddParameter("@knowledge_type", semanticRefRow.KnowledgeType);
        cmd.AddParameter("@knowledge_json", semanticRefRow.KnowledgeJson);
    }
}

internal class SemanticRefRow
{
    public string? RangeJson { get; set; }
    public string? KnowledgeType { get; set; }
    public string? KnowledgeJson { get; set; }
}
