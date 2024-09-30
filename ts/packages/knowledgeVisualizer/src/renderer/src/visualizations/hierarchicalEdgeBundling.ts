// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ascending,
    hierarchy,
    cluster,
    create,
    lineRadial,
    curveBundle,
    select,
    selectAll,
} from "d3";

export class HierarchicalEdgeBundling {
    public chart: SVGElement | undefined;

    public static colorin: string = "#00f";
    public static colorout: string = "#f00";
    public static colornone: string = "#ccc";

    constructor(data: any) {
        this.update(data);
    }

    private id(node) {
        return `${node.parent ? this.id(node.parent) + "." : ""}${node.data.name}`;
    }

    private linkNodes(root) {
        const map = new Map(root.leaves().map((d) => [this.id(d), d]));
        for (const d of root.leaves())
            (d.incoming = []),
                (d.outgoing = d.data.imports.map((i) => [d, map.get(i)]));
        for (const d of root.leaves())
            for (const o of d.outgoing) o[1].incoming.push(o);
        return root;
    }

    private buildNodeHierarchy(data, delimiter = ".") {
        let root;
        const map = new Map();
        data.forEach(function find(data) {
            const { name } = data;
            if (map.has(name)) return map.get(name);
            const i = name.lastIndexOf(delimiter);
            map.set(name, data);
            if (i >= 0) {
                find({
                    name: name.substring(0, i),
                    children: [],
                }).children.push(data);
                data.name = name.substring(i + 1);
            } else {
                root = data;
            }
            return data;
        });
        return root;
    }

    private makeChart(data: any) {
        const width = 954;
        const radius = width / 2;

        const tree = cluster().size([2 * Math.PI, radius - 100]);
        const root = tree(
            this.linkNodes(
                hierarchy(data).sort(
                    (a, b) =>
                        ascending(a.height, b.height) ||
                        ascending(a.data.name, b.data.name),
                ),
            ),
        );

        const svg = create("svg")
            .attr("width", width)
            .attr("height", width)
            .attr("viewBox", [-width / 2, -width / 2, width, width])
            .attr(
                "style",
                "max-width: 100%; height: auto; font: 10px sans-serif;",
            );

        svg.append("g")
            .selectAll()
            .data(root.leaves())
            .join("g")
            .attr(
                "transform",
                (d) =>
                    `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`,
            )
            .append("text")
            .attr("dy", "0.31em")
            .attr("x", (d) => (d.x < Math.PI ? 6 : -6))
            .attr("text-anchor", (d) => (d.x < Math.PI ? "start" : "end"))
            .attr("transform", (d) => (d.x >= Math.PI ? "rotate(180)" : null))
            .text((d) => d.data.name)
            .each((d, index, group) => {
                d.text = group[index];
            })
            .on("mouseover", (event: any, d: any) => {
                link.style("mix-blend-mode", null);
                select(event.currentTarget).attr("font-weight", "bold");
                selectAll(d.incoming.map((d) => d.path))
                    .attr("stroke", HierarchicalEdgeBundling.colorin)
                    .raise();
                selectAll(d.incoming.map(([d]) => d.text))
                    .attr("fill", HierarchicalEdgeBundling.colorin)
                    .attr("font-weight", "bold");
                selectAll(d.outgoing.map((d) => d.path))
                    .attr("stroke", HierarchicalEdgeBundling.colorout)
                    .raise();
                selectAll(d.outgoing.map(([, d]) => d.text))
                    .attr("fill", HierarchicalEdgeBundling.colorout)
                    .attr("font-weight", "bold");
            })
            .on("mouseout", (event: any, d) => {
                link.style("mix-blend-mode", "multiply");
                select(event.currentTarget).attr("font-weight", null);
                selectAll(d.incoming.map((d) => d.path)).attr("stroke", null);
                selectAll(d.incoming.map(([d]) => d.text))
                    .attr("fill", null)
                    .attr("font-weight", null);
                selectAll(d.outgoing.map((d) => d.path)).attr("stroke", null);
                selectAll(d.outgoing.map(([, d]) => d.text))
                    .attr("fill", null)
                    .attr("font-weight", null);
            })
            .call((text) =>
                text.append("title").text(
                    (d) => `${this.id(d)}
  ${d.outgoing.length} outgoing
  ${d.incoming.length} incoming`,
                ),
            );

        const line = lineRadial()
            .curve(curveBundle.beta(0.85))
            .radius((d) => d.y)
            .angle((d) => d.x);

        const link = svg
            .append("g")
            .attr("stroke", HierarchicalEdgeBundling.colornone)
            .attr("fill", "none")
            .selectAll()
            .data(root.leaves().flatMap((leaf) => leaf.outgoing))
            .join("path")
            .style("mix-blend-mode", "multiply")
            .attr("d", ([i, o]) => line(i.path(o)))
            .each((d, index, group) => {
                d.path = group[index];
            });

        return svg.node();
    }

    public update(data: any): void {
        if (data.length > 0) {
            const h = this.buildNodeHierarchy(data);
            this.chart = this.makeChart(h);
        } else {
            this.chart = create("svg").node();
        }
    }
}
