import { FileSystem, ObjectFolderSettings } from "typeagent";
import {
    createTextIndex,
    TextIndex,
    TextIndexSettings,
} from "../knowledgeIndex.js";

export interface LabelIndex<TLabelId = any, TSourceId = any> {
    readonly settings: TextIndexSettings;
    readonly textIndex: TextIndex;

    put(label: string, sourceIds: TSourceId[]): Promise<TLabelId>;
    get(label: string): Promise<TSourceId[] | undefined>;
}

export async function createLabelIndex<TSourceId = any>(
    indexSettings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<LabelIndex<string, TSourceId>> {
    type TagId = string;
    const settings: TextIndexSettings = { ...indexSettings };
    settings.semanticIndex = false;
    const textIndex = await createTextIndex<TSourceId>(
        settings,
        rootPath,
        folderSettings,
        fSys,
    );

    return {
        settings,
        textIndex,
        put,
        get,
    };

    async function put(label: string, sourceIds: TSourceId[]): Promise<TagId> {
        return textIndex.put(label, sourceIds);
    }

    async function get(label: string): Promise<TSourceId[] | undefined> {
        return textIndex.get(label);
    }
}
