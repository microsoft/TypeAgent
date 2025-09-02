// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class TSTNode<TData> {
    constructor(public c: string) {
        this.count = 0;
    }
    count: number;
    left?: TSTNode<TData>;
    middle?: TSTNode<TData>;
    right?: TSTNode<TData>;
    data: TData | undefined;
}

export interface BaseTSTData {
    sortIndex?: number;
}

export class TST<TData extends BaseTSTData> {
    private root: TSTNode<TData> | undefined = undefined;

    init() {
        this.root = undefined;
    }

    insert(key: string, data: TData) {
        this.put(key, data);
    }

    size(): number {
        if (this.root === undefined) {
            return 0;
        } else {
            return this.root.count;
        }
    }

    isEmpty(): boolean {
        if (this.root === undefined) {
            return true;
        } else {
            return this.root.count === 0;
        }
    }

    contains(key: string): boolean {
        if (key === undefined) {
            throw new Error("key is undefined");
        }
        return this.get(key) !== undefined;
    }

    get(key: string): TData | undefined {
        if (key === undefined) {
            throw new Error("key is undefined");
        }
        if (key.length === 0) {
            throw new Error("key must have length >= 1");
        }
        let x = this.getRadix(this.root, key, 0);
        if (x === undefined) {
            return undefined;
        }
        return x.data;
    }

    getRadix(
        x: TSTNode<TData> | undefined,
        key: string,
        d: number,
    ): TSTNode<TData> | undefined {
        if (x === undefined) {
            return undefined;
        }
        if (key.length === 0) {
            throw new Error("key must have length >= 1");
        }
        let c = key.charAt(d);
        if (c < x.c) {
            return this.getRadix(x.left, key, d);
        } else if (c > x.c) {
            return this.getRadix(x.right, key, d);
        } else if (d < key.length - 1) {
            return this.getRadix(x.middle, key, d + 1);
        } else {
            return x;
        }
    }

    put(key: string, data: TData) {
        if (key === undefined) {
            throw new Error("key is undefined");
        }
        if (data === undefined) {
            this.delete(key);
            return;
        }
        const isNewKey = !this.contains(key);
        this.root = this.putRadix(this.root, key, data, 0, isNewKey);
    }

    putRadix(
        x: TSTNode<TData> | undefined,
        key: string,
        data: TData,
        d: number,
        isNewKey: boolean,
    ): TSTNode<TData> {
        let c = key.charAt(d);
        if (x === undefined) {
            x = new TSTNode<TData>(c);
        }
        if (c < x.c) {
            x.left = this.putRadix(x.left, key, data, d, isNewKey);
        } else if (c > x.c) {
            x.right = this.putRadix(x.right, key, data, d, isNewKey);
        } else if (d < key.length - 1) {
            x.middle = this.putRadix(x.middle, key, data, d + 1, isNewKey);
            if (isNewKey) {
                x.count++;
            }
        } else {
            x.data = data;
            if (isNewKey) {
                x.count++;
            }
        }
        return x;
    }

    delete(key: string) {
        if (key === undefined) {
            throw new Error("key is undefined");
        }
        if (this.contains(key)) {
            this.root = this.deleteRadix(this.root, key, 0);
            if (this.root !== undefined) {
                this.root.count--;
            }
        }
    }

    deleteRadix(
        x: TSTNode<TData> | undefined,
        key: string,
        d: number,
    ): TSTNode<TData> | undefined {
        if (x === undefined) {
            return undefined;
        }
        if (d === key.length - 1) {
            x.count--;
            x.data = undefined;
        } else {
            let c = key.charAt(d);
            if (c < x.c) {
                x.left = this.deleteRadix(x.left, key, d);
            } else if (c > x.c) {
                x.right = this.deleteRadix(x.right, key, d);
            } else {
                x.count--;
                x.middle = this.deleteRadix(x.middle, key, d + 1);
            }
        }
        if (x.count === 0) {
            if (x.left === undefined && x.right === undefined) {
                return undefined;
            } else if (x.left === undefined) {
                return x.right;
            } else if (x.right === undefined) {
                return x.left;
            } else {
                const y = x;
                x = this.minNode(y.right);
                x.right = this.deleteMinNode(y.right);
                x.left = y.left;
            }
        }
        return x;
    }

    minNode(x: TSTNode<TData> | undefined): TSTNode<TData> {
        if (x === undefined) {
            throw new Error("called minNode() with undefined");
        }
        if (x.left === undefined) {
            return x;
        }
        return this.minNode(x.left);
    }

    deleteMinNode(x: TSTNode<TData> | undefined): TSTNode<TData> | undefined {
        if (x === undefined) {
            throw new Error("called deleteMinNode() with undefined");
        }
        if (x.left === undefined) {
            return x.right;
        }
        x.left = this.deleteMinNode(x.left);
        return x;
    }

    keys(): string[] {
        const keys: string[] = [];
        const data: TData[] = [];
        this.collect(this.root, "", keys, data);
        return keys;
    }

    data(): TData[] {
        const keys: string[] = [];
        const data: TData[] = [];
        this.collect(this.root, "", keys, data);
        return data;
    }

    dataWithPrefix(prefix: string): TData[] {
        if (prefix === undefined) {
            throw new Error("prefix is undefined");
        } else if (prefix.length === 0) {
            return this.data().sort((a, b) => {
                return (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
            });
        }
        const keys: string[] = [];
        const data: TData[] = [];
        const x = this.getRadix(this.root, prefix, 0);
        if (x === undefined) {
            return data;
        }
        if (x.data !== undefined) {
            data.push(x.data);
        }
        this.collect(x.middle, prefix, keys, data);
        return data.sort((a, b) => {
            return (a.sortIndex ?? 0) - (b.sortIndex ?? 0);
        });
    }

    collect(
        x: TSTNode<TData> | undefined,
        prefix: string,
        keys: string[],
        data: TData[],
    ) {
        if (x === undefined) {
            return;
        }
        this.collect(x.left, prefix, keys, data);
        if (x.data !== undefined) {
            keys.push(prefix + x.c);
            data.push(x.data);
        }
        this.collect(x.middle, prefix + x.c, keys, data);
        this.collect(x.right, prefix, keys, data);
    }

    dataThatMatch(pattern: string): TData[] {
        if (pattern === undefined) {
            throw new Error("pattern is undefined");
        }
        const keys: string[] = [];
        const data: TData[] = [];
        this.collectPattern(this.root, "", pattern, keys, data);
        return data;
    }

    collectPattern(
        x: TSTNode<TData> | undefined,
        prefix: string,
        pattern: string,
        keys: string[],
        data: TData[],
    ) {
        if (x === undefined) {
            return;
        }
        const d = prefix.length;
        if (d === pattern.length) {
            if (x.data !== undefined) {
                keys.push(prefix);
                data.push(x.data);
            }
            return;
        }
        const c = pattern.charAt(d);
        if (c === "." || c < x.c) {
            this.collectPattern(x.left, prefix, pattern, keys, data);
        }
        if (c === "." || c === x.c) {
            if (d === pattern.length - 1 && x.data !== undefined) {
                keys.push(prefix + x.c);
            } else if (d < pattern.length - 1) {
                this.collectPattern(
                    x.middle,
                    prefix + x.c,
                    pattern,
                    keys,
                    data,
                );
            }
        }
        if (c === "." || c > x.c) {
            this.collectPattern(x.right, prefix, pattern, keys, data);
        }
    }
}
