// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getSessionNames, getSessionsDirPath } from "agent-dispatcher/explorer";
import fs from "node:fs";
import path from "node:path";

export class TypeAgentList {
    constructor(
        public name: string,
        public items: TypeAgentList[] | string[],
    ) {}
}

export class KnowledgeGraph {
    constructor(public id: string, public parents?: string[]) {};
}

type EntityFacet = {  
    name: string;  
    value: {  
      amount: number;  
      units: string;  
    };  
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
  

export class VisualizationNotifier {
    private static instance: VisualizationNotifier;

    public onListChanged: ((lists: TypeAgentList) => void) | null;

    public onKnowledgeUpdated: ((knowledge: KnowledgeGraph[][]) => void) | null;

    private knowledgeFileDebounce: number = 0;

    private constructor() {
        this.onListChanged = null;
        this.onKnowledgeUpdated = null;
        

        // file watchers
        fs.watch(getSessionsDirPath(), { recursive: true}, async (_, fileName) => {
            if (fileName?.endsWith("lists.json")) {
                const l = await this.enumerateLists();
                if (this.onListChanged != null) {
                    this.onListChanged!(l);
                }    
            }
          });

          //TODO: implement knowledge
          const kDir: string = path.join("conversation", "knowledge");
          fs.watch(getSessionsDirPath(), { recursive: true}, async (_, fileName) => {
            if (fileName!.indexOf(kDir) > -1) {

                // TODO: debounce
                ++this.knowledgeFileDebounce;

                setTimeout(async () => {
                    --this.knowledgeFileDebounce;

                    if (this.knowledgeFileDebounce == 0) {
                        const k = await this.enumerateKnowledge();
                        if (this.onKnowledgeUpdated != null) {
                            this.onKnowledgeUpdated!(k);
                        }    
        
                    }
                }, 1000);
            }
          });

        // run first file scans
        setTimeout(async () => {
            const l = await this.enumerateLists();
            if (this.onListChanged != null) {
                this.onListChanged!(l);
            }
        }, 3000);

        setTimeout(async () => {
            const know = await this.enumerateKnowledge();
            if (this.onKnowledgeUpdated != null) {
                this.onKnowledgeUpdated!(know);
            }
        }, 3500);

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

        const sessions: string[] = await getSessionNames();

        // get all the sessions
        sessions.map((n) => {

            // TODO: remove after testing
            if (n.startsWith(".")) {
                return;
            }

            let newList = new TypeAgentList(n, new Array<TypeAgentList>());
            (retValue.items as TypeAgentList[]).push(newList);

            // get the lists for all sessions
            try {
                const listsRaw: Buffer = fs.readFileSync(
                    path.join(getSessionsDirPath(), n, "list", "lists.json"),
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
        for(let i = 0; i < 6; i++) {
            retValue.push(new Array<KnowledgeGraph>());
        }

        const sessions: string[] = await getSessionNames();
        const lastSession: string = sessions[sessions.length - 1];

        // level 0
        retValue[0].push(new KnowledgeGraph(`${lastSession} - Knowledge`));

        // get the knowledge for this session
        const knowledgeMap: Map<string, Knowledge> = new Map<string, Knowledge>();
        const knowledgeDir: string = path.join(getSessionsDirPath(), lastSession, "conversation", "knowledge");
        const files: string[] = fs.readdirSync(knowledgeDir);
        files.map((f) => {

            // level 1
            retValue[1].push(new KnowledgeGraph(f, [`${lastSession} - Knowledge`]));

            const s: Buffer = fs.readFileSync(path.join(knowledgeDir, f));
            const kk: Knowledge = JSON.parse(s.toString()) //todo: finish

            knowledgeMap.set(f, kk);
        });

        // level 2
        const entities: KnowledgeGraph = new KnowledgeGraph("entities", []);
        const topics: KnowledgeGraph = new KnowledgeGraph("topics", []);
        const actions: KnowledgeGraph = new KnowledgeGraph("actions", []);
        retValue[2].push(entities);
        retValue[2].push(topics);
        retValue[2].push(actions);

        knowledgeMap.forEach((k: Knowledge, s: string) => {
            // level 2 - parents
            if (k.entities?.length > 0) {
                entities.parents?.push(s);

                // level 3
                k.entities.map((n: Entity) => {
                    n.value.type.map((t: string) => {
                        retValue[3].push(new KnowledgeGraph(t, ["entities"]))
                    });                    
                    //retValue[3].push(new KnowledgeGraph(, ["entities"]))
                });
            }

            // level 2 - parents
            if (k.topics?.length > 0) {
                topics.parents?.push(s);

                // level 3
                k.topics.map((n: Topic) => {
                    retValue[3].push(new KnowledgeGraph(n.value, ["topics"]));
                });
            }
            
            // level 2 - parents
            if (k.actions?.length > 0) {
                actions.parents?.push(s);

                // level 3
                k.actions.map((a: Action) => {
                    a.value.verbs.map((v: string) => {
                        retValue[3].push(new KnowledgeGraph(v, ["actions"]));
                    })
                    //retValue[3].push(new KnowledgeGraph(n.value.name, ["entities"]))
                });
            }
        });



        return retValue;
    }
}
