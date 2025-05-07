// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";
import * as kp from "knowpro";

export class SqliteAliasMap implements kp.ITermToRelatedTerms {
    private db: sqlite.Database;
    private sql_add: sqlite.Statement;
    private sql_get: sqlite.Statement;
    constructor(
        db: sqlite.Database,
        public tableName: string,
        ensureExists: boolean = true,
    ) {
        this.db = db;
        if (ensureExists) {
            this.ensureDb();
        }
        this.sql_add = this.sqlAdd();
        this.sql_get = this.sqlGet();
    }

    public addRelatedTerm(termText: string, relatedTerm: kp.Term | kp.Term[]) {
        if (Array.isArray(relatedTerm)) {
            for (const relatedText of relatedTerm) {
                this.addUnique(termText, relatedText);
            }
        } else {
            this.addUnique(termText, relatedTerm);
        }
    }

    public lookupTerm(text: string): kp.Term[] | undefined {
        if (!text) {
            return undefined;
        }
        let relatedTerms: kp.Term[] | undefined;
        for (const row of this.sql_get.iterate(text)) {
            let termMapRow = row as TermMapRow;
            relatedTerms ??= [];
            relatedTerms.push({
                text: termMapRow.relatedTerm,
                weight: termMapRow.weight,
            });
        }
        return relatedTerms;
    }

    private addUnique(termText: string, relatedTerm: kp.Term) {
        if (termText && relatedTerm.text) {
            this.sql_add.run(termText, relatedTerm.text, relatedTerm.weight);
        }
    }

    private ensureDb() {
        const schemaSql = `  
        CREATE TABLE IF NOT EXISTS ${this.tableName} (  
          term TEXT NOT NULL,
          relatedTerm TEXT NOT NULL,
          weight REAL,
          PRIMARY KEY(term, relatedTerm)  
        );`;
        this.db.exec(schemaSql);
    }

    private sqlAdd() {
        return this.db.prepare(
            `INSERT OR IGNORE INTO ${this.tableName} (term, relatedTerm, weight) VALUES (?, ?, ?)`,
        );
    }

    private sqlGet() {
        return this.db.prepare(
            `SELECT relatedTerm, weight FROM ${this.tableName} WHERE term = (?)`,
        );
    }
}

type TermMapRow = {
    term: string;
    relatedTerm: string;
    weight?: number | undefined;
};
