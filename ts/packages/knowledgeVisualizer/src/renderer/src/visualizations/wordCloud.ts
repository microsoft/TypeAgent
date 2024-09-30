// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { create, descending, rollups } from "d3";
import cloud from "d3-cloud";

export class WordCloud {
    public chart: SVGElement | undefined;

    constructor(data: any) {
        this.update(data);
    }

    public update(
        text: any,
        options: any = {
            size: (group) => group.length, // Group size
            word: (d) => d, // get the current word
            marginTop: 0, // top margin
            marginRight: 0, // right margin
            marginBottom: 0, // bottom margin
            marginLeft: 0, // left margin
            width: 800, // width
            height: 600, // height
            maxWords: 500, // max word count
            fontFamily: "sans-serif", // font
            fontScale: 15, // smallest font size
            fill: null, // text color
            padding: 0, // padding between words
            rotate: 0, // a constant or function to rotate the words
            invalidation: null, // when this promise resolves, stop the simulation
            ignoredWords: new Set(["none"]), // ignore word list
        },
    ): void {
        if (text.length == 0) {
            this.chart = create("svg").node();
            return;
        }

        let words =
            typeof text === "string" ? text.split(/\W+/g) : Array.from(text);
        words = words.filter((w) => w && !options.ignoredWords.has(w));

        const data = rollups(words, options.size, (w) => w)
            .sort(([, a], [, b]) => descending(a, b))
            .slice(0, options.maxWords)
            .map(([key, size]) => ({ text: options.word(key), size }));

        const svg = create("svg")
            .attr("viewBox", [0, 0, options.width, options.height])
            .attr("width", options.width)
            .attr("font-family", options.fontFamily)
            .attr("text-anchor", "middle")
            .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

        const g = svg
            .append("g")
            .attr(
                "transform",
                `translate(${options.marginLeft},${options.marginTop})`,
            );

        const clouds = cloud()
            .size([
                options.width - options.marginLeft - options.marginRight,
                options.height - options.marginTop - options.marginBottom,
            ])
            .words(data)
            .padding(options.padding)
            .rotate(options.rotate)
            .font(options.fontFamily)
            .fontSize((d) => Math.sqrt(d.size) * options.fontScale)
            .on("word", ({ size, x, y, rotate, text }) => {
                g.append("text")
                    .datum(text)
                    .attr("style", `font-size: ${size}`)
                    .attr("fill", options.fill)
                    .attr("transform", `translate(${x},${y}) rotate(${rotate})`)
                    .text(text);
            });

        clouds.start();
        options.invalidation && options.invalidation.then(() => clouds.stop());

        this.chart = svg.node();
    }
}
