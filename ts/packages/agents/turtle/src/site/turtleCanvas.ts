// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function createTurtleCanvas() {
    const div = document.createElement("div");
    div.className = "main";

    const turtleDiv = document.createElement("div");
    div.appendChild(turtleDiv);
    turtleDiv.className = "turtle";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    turtleDiv.appendChild(svg);

    svg.setAttribute("width", "15");
    svg.setAttribute("height", "10");
    const polygon = document.createElementNS(svgNS, "polygon");
    polygon.setAttribute("points", "15,5 0,0 0,10");
    polygon.setAttribute("fill", "#CCCCCC");
    svg.appendChild(polygon);

    const canvas = document.createElement("canvas");
    div.appendChild(canvas);

    const width = 800;
    const height = 800;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Cannot get 2d context");
    }
    let penDown = false;
    let x = height / 2;
    let y = height / 2;
    let angle = 0;

    const updatePosition = () => {
        turtleDiv.style.left = `${x - 7}px`;
        turtleDiv.style.top = `${y - 9}px`;
    };

    const updateAngle = () => {
        turtleDiv.style.rotate = `${angle}deg`;
    };
    updatePosition();
    return {
        div,
        turtle: {
            forward(pixel: number) {
                const dx = Math.cos(angle * (Math.PI / 180)) * pixel;
                const dy = Math.sin(angle * (Math.PI / 180)) * pixel;
                if (penDown) {
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + dx, y + dy);
                    ctx.stroke();
                }
                x += dx;
                y += dy;
                updatePosition();
            },
            left: (degrees: number) => {
                angle -= degrees;
                updateAngle();
            },
            right: (degrees: number) => {
                angle += degrees;
                updateAngle();
            },
            penUp: () => {
                penDown = false;
                polygon.setAttribute("fill", "grey");
            },
            penDown: () => {
                penDown = true;
                polygon.setAttribute("fill", "black");
            },
        },
    };
}
