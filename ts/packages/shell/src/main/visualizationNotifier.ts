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

export class VisualizationNotifier {
    private static instance: VisualizationNotifier;

    public onListChanged: ((lists: TypeAgentList) => void) | null;

    private constructor() {
        this.onListChanged = null;

        // file watchers
        fs.watch(getSessionsDirPath(), { recursive: true}, async (_, fileName) => {
            if (fileName?.endsWith("lists.json")) {
                const l = await VisualizationNotifier.enumerateLists();
                if (this.onListChanged != null) {
                    this.onListChanged!(l);
                }    
            }
          });

        // run first file scan
        setTimeout(async () => {
            const l = await VisualizationNotifier.enumerateLists();
            if (this.onListChanged != null) {
                this.onListChanged!(l);
            }
        }, 3000);
    }

    public static getinstance = (): VisualizationNotifier => {
        if (!VisualizationNotifier.instance) {
            VisualizationNotifier.instance = new VisualizationNotifier();
        }

        return VisualizationNotifier.instance;
    };

    public static async enumerateLists(): Promise<TypeAgentList> {
        let retValue: TypeAgentList = new TypeAgentList(
            "sessions",
            new Array<TypeAgentList>(),
        );

        const sessions: string[] = await getSessionNames();

        // get all the sessions
        sessions.map((n) => {
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
}
