// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import sqlite from "better-sqlite3";
import * as ms from "memory-storage";

// Website visit frequency table
export interface VisitFrequency {
    domain: string;
    visitCount: number;
    lastVisitDate: string;
    averageTimeSpent?: number;
}

export class VisitFrequencyTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "visitFrequency", [
            ["domain", { type: "string" }],
            ["visitCount", { type: "number" }],
            ["lastVisitDate", { type: "string" }],
            ["averageTimeSpent", { type: "number", optional: true }],
        ]);
    }

    public getTopDomainsByVisits(limit: number = 10): VisitFrequency[] {
        const stmt = this.db.prepare(`
            SELECT * FROM visitFrequency 
            ORDER BY visitCount DESC 
            LIMIT ?
        `);
        return stmt.all(limit) as VisitFrequency[];
    }
}

// Website categories table
export interface WebsiteCategory {
    domain: string;
    category: string;
    confidence: number;
}

export class WebsiteCategoryTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "websiteCategories", [
            ["domain", { type: "string" }],
            ["category", { type: "string" }],
            ["confidence", { type: "number" }],
        ]);
    }

    public getCategoriesForDomain(domain: string): WebsiteCategory[] {
        const stmt = this.db.prepare(`
            SELECT * FROM websiteCategories 
            WHERE domain = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(domain) as WebsiteCategory[];
    }

    public getDomainsByCategory(category: string): WebsiteCategory[] {
        const stmt = this.db.prepare(`
            SELECT * FROM websiteCategories 
            WHERE category = ? 
            ORDER BY confidence DESC
        `);
        return stmt.all(category) as WebsiteCategory[];
    }
}

// Bookmark folder structure table
export interface BookmarkFolder {
    folderPath: string;
    url: string;
    title: string;
    dateAdded: string;
}

export class BookmarkFolderTable extends ms.sqlite.SqliteDataFrame {
    constructor(public db: sqlite.Database) {
        super(db, "bookmarkFolders", [
            ["folderPath", { type: "string" }],
            ["url", { type: "string" }],
            ["title", { type: "string" }],
            ["dateAdded", { type: "string" }],
        ]);
    }

    public getBookmarksByFolder(folderPath: string): BookmarkFolder[] {
        const stmt = this.db.prepare(`
            SELECT * FROM bookmarkFolders 
            WHERE folderPath LIKE ? 
            ORDER BY dateAdded DESC
        `);
        return stmt.all(`${folderPath}%`) as BookmarkFolder[];
    }

    public getAllFolders(): string[] {
        const stmt = this.db.prepare(`
            SELECT DISTINCT folderPath FROM bookmarkFolders 
            ORDER BY folderPath
        `);
        return stmt.all().map((row: any) => row.folderPath);
    }
}
