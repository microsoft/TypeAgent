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

    public SemanticRef Get(int semanticRefId)
    {
        using var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs WHERE semref_id = @semref_id");
        cmd.Parameters.AddWithValue("semref_id", semanticRefId);

        using var reader = cmd.ExecuteReader();
        if (!reader.Read())
        {
            throw new ArgumentException($"No semanticRef at ordinal {semanticRefId}");
        }

        SemanticRefRow row = ReadSemanticRefRow(reader);
        SemanticRef semanticRef = FromSemanticRefRow(row);
        return semanticRef;
    }


    public Task<SemanticRef> GetAsync(int ordinal)
    {
        return Task.FromResult(Get(ordinal));
    }

    public Task<IList<SemanticRef>> GetAsync(IList<int> ids)
    {
        // TODO: Bulk operations
        IList<SemanticRef> semanticRefs = [];
        foreach (int semrefId in ids)
        {
            semanticRefs.Add(Get(semrefId));
        }
        return Task.FromResult(semanticRefs);
    }

    public async IAsyncEnumerator<SemanticRef> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs WHERE semref_id = ?
");
        using var reader = cmd.ExecuteReader();
        while (await reader.ReadAsync(cancellationToken))
        {
            SemanticRef semanticRef = ReadSemanticRef(reader);
            yield return semanticRef;
        }

    }

    public Task<IList<SemanticRef>> GetSliceAsync(int start, int end)
    {
        using var cmd = _db.CreateCommand(@"
SELECT semref_id, range_json, knowledge_type, knowledge_json
FROM SemanticRefs WHERE semref_id >= ? AND semref_id < ?
ORDER BY semref_id");
        using var reader = cmd.ExecuteReader();
        var semanticRefList = reader.GetList(ReadSemanticRef);
        return Task.FromResult(semanticRefList);
    }

    int GetNextSemanicRefId()
    {
        return GetCount();
    }

    int GetCount()
    {
        if (_count < 0)
        {
            _count = _db.GetCount(SqliteStorageProviderSchema.SemanticRefTable);
        }
        return _count;
    }

    SemanticRef ReadSemanticRef(SqliteDataReader reader)
    {
        var row = ReadSemanticRefRow(reader);
        return FromSemanticRefRow(row);
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

        semanticRef.SemanticRefOrdinal = semanticRefRow.SemanticRefId;
        semanticRef.Range = StorageSerializer.Deserialize<TextRange>(semanticRefRow.RangeJson);
        semanticRef.KnowledgeType = semanticRefRow.KnowledgeType;
        semanticRef.Knowledge = SemanticRef.Deserialize(semanticRefRow.KnowledgeJson, semanticRefRow.KnowledgeType);

        return semanticRef;
    }

    SemanticRefRow ReadSemanticRefRow(SqliteDataReader reader)
    {
        SemanticRefRow row = new SemanticRefRow();

        int iRow = 0;
        row.SemanticRefId = reader.GetInt32(iRow++);
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
    public int SemanticRefId { get; set; }
    public string? RangeJson { get; set; }
    public string? KnowledgeType { get; set; }
    public string? KnowledgeJson { get; set; }
}
