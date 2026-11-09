// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import * as bootstrap from "bootstrap";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-json";
import "prismjs/themes/prism.css";

cytoscape.use(dagre as unknown as Parameters<typeof cytoscape.use>[0]);
Object.assign(window, { bootstrap, cytoscape, Prism });
