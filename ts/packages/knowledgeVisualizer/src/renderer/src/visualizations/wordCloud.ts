// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { create, descending, rollups } from "d3";
import cloud from "d3-cloud";

export class WordCloud {
    public chart: SVGElement | undefined;

    constructor(data: any) {
        this.update(data);
    }

    public update(text: any, options: any = {
        size: group => group.length, // Given a grouping of words, returns the size factor for that word
        word: d => d, // Given an item of the data array, returns the word
        marginTop: 0, // top margin, in pixels
        marginRight: 0, // right margin, in pixels
        marginBottom: 0, // bottom margin, in pixels
        marginLeft: 0, // left margin, in pixels
        width: 800, // outer width, in pixels
        height: 600, // outer height, in pixels
        maxWords: 250, // maximum number of words to extract from the text
        fontFamily: "sans-serif", // font family
        fontScale: 15, // base font size
        fill: null, // text color, can be a constant or a function of the word
        padding: 0, // amount of padding between the words (in pixels)
        rotate: 0, // a constant or function to rotate the words
        invalidation: null // when this promise resolves, stop the simulation
    }): void {

        if (text.length == 0) {
            this.chart = create("svg").node();
            return;
        }

        const words = typeof text === "string" ? text.split(/\W+/g) : Array.from(text);
            
        const data = rollups(words, options.size, w => w)
            .sort(([, a], [, b]) => descending(a, b))
            .slice(0, options.maxWords)
            .map(([key, size]) => ({text: options.word(key), size}));
            
        const svg = create("svg")
            .attr("viewBox", [0, 0, options.width, options.height])
            .attr("width", options.width)
            .attr("font-family", options.fontFamily)
            .attr("text-anchor", "middle")
            .attr("style", "max-width: 100%; height: auto; height: intrinsic;");
        
        const g = svg.append("g").attr("transform", `translate(${options.marginLeft},${options.marginTop})`);
        
        const clouds = cloud()
            .size([options.width - options.marginLeft - options.marginRight, options.height - options.marginTop - options.marginBottom])
            .words(data)
            .padding(options.padding)
            .rotate(options.rotate)
            .font(options.fontFamily)
            .fontSize(d => Math.sqrt(d.size) * options.fontScale)
            .on("word", ({size, x, y, rotate, text}) => {
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