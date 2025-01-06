// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getInstanceSessionNames,
    getInstanceSessionsDirPath,
} from "agent-dispatcher/explorer";
import fs from "node:fs";
import path from "node:path";

export class TypeAgentList {
    constructor(
        public name: string,
        public items: TypeAgentList[] | string[],
    ) {}
}

export class KnowledgeGraph {
    constructor(
        public id: string,
        public parents?: string[],
    ) {}
}

type EntityFacet = {
    name: string;
    value:
        | {
              amount: number;
              units: string;
          }
        | string;
};

type EntityValue = {
    name: string;
    type: string[];
    facets?: EntityFacet[];
};

type Entity = {
    value: EntityValue;
    sourceIds: string[];
};

type Topic = {
    value: string;
    sourceIds: string[];
    type: number;
};

type ActionParam = {
    name: string;
    value: number | string;
};

type ActionValue = {
    verbs: string[];
    verbTense: string;
    subjectEntityName: string;
    objectEntityName: string;
    indirectObjectEntityName: string;
    params?: ActionParam[];
};

type Action = {
    value: ActionValue;
    sourceIds: string[];
};

type Knowledge = {
    entities: Entity[];
    topics: Topic[];
    actions: Action[];
};

export type KnowledgeHierarchy = {
    name: string;
    imports: string[];
};

export class VisualizationNotifier {
    private static instance: VisualizationNotifier;

    public onListChanged: ((lists: TypeAgentList) => void) | null;

    public onKnowledgeUpdated: ((knowledge: KnowledgeGraph[][]) => void) | null;

    public onHierarchyUpdated:
        | ((hierarchy: KnowledgeHierarchy[]) => void)
        | null;

    public onWordsUpdated: ((words: string[]) => void) | null;

    private knowledgeFileDebounce: number = 0;

    private listFileDebounce: number = 0;

    private constructor() {
        this.onListChanged = null;
        this.onKnowledgeUpdated = null;
        this.onHierarchyUpdated = null;
        this.onWordsUpdated = null;

        // file watchers
        fs.watch(
            getInstanceSessionsDirPath(),
            { recursive: true },
            async (_, fileName) => {
                if (fileName?.endsWith("lists.json")) {
                    ++this.listFileDebounce;

                    setTimeout(async () => {
                        --this.listFileDebounce;

                        const l = await this.enumerateLists();
                        if (this.onListChanged != null) {
                            this.onListChanged!(l);
                        }
                    }, 1000);
                }
            },
        );

        const kDir: string = path.join("conversation", "knowledge");
        fs.watch(
            getInstanceSessionsDirPath(),
            { recursive: true },
            async (_, fileName) => {
                if (fileName && fileName?.indexOf(kDir) > -1) {
                    ++this.knowledgeFileDebounce;

                    setTimeout(async () => {
                        --this.knowledgeFileDebounce;

                        if (this.knowledgeFileDebounce == 0) {
                            const k = await this.enumerateKnowledge();
                            if (this.onKnowledgeUpdated != null) {
                                this.onKnowledgeUpdated!(k);
                            }

                            const h =
                                await this.enumerateKnowledgeForHierarchy();
                            if (this.onHierarchyUpdated != null) {
                                this.onHierarchyUpdated!(h);
                            }

                            const w =
                                await this.enumerateKnowledgeForWordCloud();
                            if (this.onWordsUpdated != null) {
                                this.onWordsUpdated!(w);
                            }
                        }
                    }, 1000);
                }
            },
        );

        // run first file scans
        setTimeout(async () => {
            const l = await this.enumerateLists();
            if (this.onListChanged != null) {
                this.onListChanged!(l);
            }
        }, 100);

        setTimeout(async () => {
            const know = await this.enumerateKnowledge();
            if (this.onKnowledgeUpdated != null) {
                this.onKnowledgeUpdated!(know);
            }
        }, 750);

        setTimeout(async () => {
            const h = await this.enumerateKnowledgeForHierarchy();
            if (this.onHierarchyUpdated != null) {
                this.onHierarchyUpdated!(h);
            }
        }, 1500);

        setTimeout(async () => {
            const w = await this.enumerateKnowledgeForWordCloud();
            if (this.onWordsUpdated != null) {
                this.onWordsUpdated!(w);
            }
        }, 2250);
    }

    public static getinstance = (): VisualizationNotifier => {
        if (!VisualizationNotifier.instance) {
            VisualizationNotifier.instance = new VisualizationNotifier();
        }

        return VisualizationNotifier.instance;
    };

    public async enumerateLists(): Promise<TypeAgentList> {
        let retValue: TypeAgentList = new TypeAgentList(
            "sessions",
            new Array<TypeAgentList>(),
        );

        const sessions: string[] = await getInstanceSessionNames();

        // get all the sessions
        sessions.map((n) => {
            if (n.startsWith(".")) {
                return; // skip sessions starting with '.'
            }

            let newList = new TypeAgentList(n, new Array<TypeAgentList>());
            (retValue.items as TypeAgentList[]).push(newList);

            // get the lists for all sessions
            try {
                const listsRaw: Buffer = fs.readFileSync(
                    path.join(
                        getInstanceSessionsDirPath(),
                        n,
                        "list",
                        "lists.json",
                    ),
                );
                const lists: TypeAgentList[] = JSON.parse(listsRaw.toString());

                lists.map((z: TypeAgentList) => {
                    (newList.items as TypeAgentList[]).push(z);
                });
            } catch (e) {
                console.log(e);
            }
        });

        return retValue;
    }

    public async enumerateKnowledge(): Promise<KnowledgeGraph[][]> {
        let retValue: KnowledgeGraph[][] = new Array<KnowledgeGraph[]>();

        // create levels
        for (let i = 0; i < 6; i++) {
            retValue.push(new Array<KnowledgeGraph>());
        }

        const sessions: string[] = await getInstanceSessionNames();
        const lastSession: string = sessions[sessions.length - 1];

        // level 0
        retValue[0].push(new KnowledgeGraph(`${lastSession} - Knowledge`));

        // get the knowledge for this session
        const knowledgeMap: Map<string, Knowledge> = new Map<
            string,
            Knowledge
        >();
        const knowledgeDir: string = path.join(
            getInstanceSessionsDirPath(),
            lastSession,
            "conversation",
            "knowledge",
        );

        if (!fs.existsSync(knowledgeDir)) {
            return retValue;
        }

        const files: string[] = fs.readdirSync(knowledgeDir);
        files.map((f) => {
            // level 1 - current session
            retValue[1].push(
                new KnowledgeGraph(f, [`${lastSession} - Knowledge`]),
            );

            const s: Buffer = fs.readFileSync(path.join(knowledgeDir, f));
            const kk: Knowledge = JSON.parse(s.toString()); //todo: finish

            knowledgeMap.set(f, kk);
        });

        // level 2 - categories
        const entities: KnowledgeGraph = new KnowledgeGraph("entities", []);
        const topics: KnowledgeGraph = new KnowledgeGraph("topics", []);
        const actions: KnowledgeGraph = new KnowledgeGraph("actions", []);
        retValue[2].push(entities);
        retValue[2].push(topics);
        retValue[2].push(actions);

        // level 3 objects
        const level3: Map<string, Set<string>> = new Map<string, Set<string>>();
        const level4: Map<string, Set<string>> = new Map<string, Set<string>>();

        knowledgeMap.forEach((k: Knowledge, s: string) => {
            // level 2 - parents
            if (k.entities?.length > 0) {
                entities.parents?.push(s);

                // level 3 - entities
                k.entities.map((n: Entity) => {
                    n.value.type.map((t: string) => {
                        if (!level3.get(t)) {
                            level3.set(t, new Set<string>().add("entities"));
                        } else {
                            level3.get(t)!.add("entities");
                        }
                    });
                    if (n.value.facets) {
                        n.value.facets.map((f) => {
                            if (!level4.get(f.value as string)) {
                                if (typeof f.value === "string") {
                                    level4.set(
                                        f.value as string,
                                        new Set<string>().add(n.value.name),
                                    );
                                }
                            } else {
                                if (typeof f.value === "string") {
                                    level4
                                        .get(f.value as string)!
                                        .add(n.value.name);
                                }
                            }
                        });
                    }
                });
            }

            // level 2 - parents
            if (k.topics?.length > 0) {
                topics.parents?.push(s);

                // level 3 - topics
                k.topics.map((n: Topic) => {
                    if (!level3.get(n.value)) {
                        level3.set(n.value, new Set<string>().add("topics"));
                    } else {
                        level3.get(n.value)!.add("topics");
                    }
                });
            }

            // level 2 - parents
            if (k.actions?.length > 0) {
                actions.parents?.push(s);

                // level 3 - actions
                k.actions.map((a: Action) => {
                    a.value.verbs.map((v: string) => {
                        if (!level3.get(v)) {
                            level3.set(v, new Set<string>().add("actions"));
                        } else {
                            level3.get(v)!.add("actions");
                        }
                    });
                });
            }
        });

        const leve3_sorted = new Map(
            [...level3].sort((a, b) => String(a[0]).localeCompare(b[0])),
        );
        leve3_sorted.forEach((value: Set<string>, key: string) => {
            retValue[3].push(new KnowledgeGraph(key, Array.from(value)));
        });

        // TOOO: evaluate and complete L4, 5, & 6
        // level4.forEach((value: Set<string>, key: string) => {
        //     retValue[4].push(new KnowledgeGraph(key, Array.from(value)));
        // });

        return retValue;
    }

    public async enumerateKnowledgeForHierarchy(): Promise<
        KnowledgeHierarchy[]
    > {
        let retValue: KnowledgeHierarchy[] = new Array<KnowledgeHierarchy>();

        retValue.push({ name: "knowledge.entity", imports: [] });
        retValue.push({ name: "knowledge.action", imports: [] });
        retValue.push({ name: "knowledge.topic", imports: [] });
        retValue.push({ name: "knowledge.message", imports: [] });
        retValue.push({ name: "knowledge.type", imports: [] });
        retValue.push({ name: "knowledge.param", imports: [] });

        const sessions: string[] = await getInstanceSessionNames();
        const lastSession: string = sessions[sessions.length - 1];

        // get the knowledge for this session
        const knowledgeMap: Map<string, Knowledge> = new Map<
            string,
            Knowledge
        >();
        const knowledgeDir: string = path.join(
            getInstanceSessionsDirPath(),
            lastSession,
            "conversation",
            "knowledge",
        );

        if (!fs.existsSync(knowledgeDir)) {
            return retValue;
        }

        const files: string[] = fs.readdirSync(knowledgeDir);
        files.map((f) => {
            const s: Buffer = fs.readFileSync(path.join(knowledgeDir, f));
            const kk: Knowledge = JSON.parse(s.toString()); //todo: finish

            knowledgeMap.set(f, kk);

            if (kk.entities?.length > 0) {
                kk.entities.map((e) => {
                    let newE: KnowledgeHierarchy = {
                        name: `knowledge.entities.${e.value.name.replace(".", ",")}`,
                        imports: [
                            "knowledge.entity",
                            `knowledge.messages.${f}`,
                        ],
                    };
                    e.value.type.map((t) => {
                        retValue.push({
                            name: `knowledge.types.${t}`,
                            imports: [
                                "knowledge.type",
                                `knowledge.messages.${f}`,
                            ],
                        });
                        newE.imports.push(`knowledge.types.${t}`);
                    });

                    retValue.push(newE);

                    // TODO: enumerate facets
                });
            }

            if (kk.topics?.length > 0) {
                kk.topics.map((t) => {
                    retValue.push({
                        name: `knowledge.topics.${t.value}`,
                        imports: ["knowledge.topic", `knowledge.messages.${f}`],
                    });
                });
            }

            if (kk.actions?.length > 0) {
                kk.actions.map((a) => {
                    a.value.verbs.map((v) => {
                        retValue.push({
                            name: `knowledge.actions.${v}`,
                            imports: [
                                "knowledge.action",
                                `knowledge.messages.${f}`,
                            ],
                        });
                    });

                    if (a.value.subjectEntityName != "none") {
                        retValue.push({
                            name: `knowledge.entities.${a.value.subjectEntityName.replace(".", "_")}`,
                            imports: ["knowledge.entity"],
                        });
                    }

                    if (a.value.objectEntityName != "none") {
                        retValue.push({
                            name: `knowledge.entities.${a.value.objectEntityName}`,
                            imports: ["knowledge.entity"],
                        });
                    }

                    if (a.value.indirectObjectEntityName != "none") {
                        retValue.push({
                            name: `knowledge.entities.${a.value.indirectObjectEntityName}`,
                            imports: ["knowledge.entity"],
                        });
                    }

                    a.value.params?.map((p) => {
                        if (typeof p === "string") {
                            let valueImports = [
                                "knowledge.param",
                                `knowledge.messages.${f}`,
                            ];

                            if (a.value.subjectEntityName != "none") {
                                valueImports.push(
                                    `knowledge.entities.${a.value.subjectEntityName.replace(".", "_")}`,
                                );
                            }

                            if (a.value.objectEntityName != "none") {
                                valueImports.push(
                                    `knowledge.entities.${a.value.objectEntityName}`,
                                );
                            }

                            if (a.value.indirectObjectEntityName != "none") {
                                valueImports.push(
                                    `knowledge.entities.${a.value.indirectObjectEntityName}`,
                                );
                            }

                            retValue.push({
                                name: `knowledge.params.${p}`,
                                imports: valueImports,
                            });
                        }
                    });
                });
            }

            // the original message that has the aforementioned EATs
            let hh: KnowledgeHierarchy = {
                name: `knowledge.messages.${f}`,
                imports: new Array<string>("knowledge.message"),
            };
            retValue.push(hh);
        });

        return retValue;
    }

    public async enumerateKnowledgeForWordCloud(): Promise<string[]> {
        let retValue: string[] = new Array<string>();

        const sessions: string[] = await getInstanceSessionNames();
        const lastSession: string = sessions[sessions.length - 1];

        // get the knowledge for this session
        const knowledgeMap: Map<string, Knowledge> = new Map<
            string,
            Knowledge
        >();
        const knowledgeDir: string = path.join(
            getInstanceSessionsDirPath(),
            lastSession,
            "conversation",
            "knowledge",
        );

        if (!fs.existsSync(knowledgeDir)) {
            return retValue;
        }

        const files: string[] = fs.readdirSync(knowledgeDir);
        files.map((f) => {
            const s: Buffer = fs.readFileSync(path.join(knowledgeDir, f));
            const kk: Knowledge = JSON.parse(s.toString()); //todo: finish

            knowledgeMap.set(f, kk);
        });

        knowledgeMap.forEach((k: Knowledge, _) => {
            if (k.entities?.length > 0) {
                k.entities.map((n: Entity) => {
                    // entity name
                    retValue.push(n.value.name);

                    // entity types
                    n.value.type.map((t: string) => {
                        retValue.push(t);
                    });

                    // facets
                    if (n.value.facets) {
                        n.value.facets.map((f) => {
                            // facet name
                            retValue.push(f.name);

                            // facet value
                            if (typeof f.value === "string") {
                                retValue.push(f.value);
                            } else if (typeof f.value === "object") {
                                retValue.push(f.value.amount.toString());
                                retValue.push(f.value.units);
                            }
                        });
                    }
                });
            }

            if (k.topics?.length > 0) {
                k.topics.map((n: Topic) => {
                    retValue.push(n.value);
                });
            }

            if (k.actions?.length > 0) {
                k.actions.map((a: Action) => {
                    a.value.verbs.map((v: string) => {
                        retValue.push(v);
                    });

                    retValue.push(a.value.subjectEntityName);
                    retValue.push(a.value.objectEntityName);
                    retValue.push(a.value.indirectObjectEntityName);
                });
            }
        });

        return retValue;
    }
}
