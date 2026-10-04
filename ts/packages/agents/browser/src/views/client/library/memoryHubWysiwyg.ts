// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Crepe, CrepeFeature } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { createMermaidPreview } from "./utils/mermaidView";

export type Wysiwyg = {
    destroy(): Promise<void>;
};

export async function mountWysiwyg(
    host: HTMLElement,
    markdown: string,
    onChange: (markdown: string) => void,
): Promise<Wysiwyg> {
    const renderDiagram = createMermaidPreview(host);
    const crepe = new Crepe({
        root: host,
        defaultValue: markdown,
        features: {
            [CrepeFeature.ImageBlock]: false,
        },
        featureConfigs: {
            [CrepeFeature.CodeMirror]: {
                renderPreview: (language, content) =>
                    language.toLowerCase() === "mermaid" && content.trim()
                        ? renderDiagram(content)
                        : null,
            },
        },
    });
    let baseline: string | undefined;
    crepe.on((listener) => {
        listener.markdownUpdated((_ctx, updated) => {
            if (baseline === undefined) return;
            // Unchanged content keeps its exact original text.
            onChange(updated === baseline ? markdown : updated);
        });
    });
    await crepe.create();
    baseline = crepe.getMarkdown();
    return {
        async destroy() {
            await crepe.destroy();
        },
    };
}
