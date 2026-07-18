// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Catalog } from "./types.js";
import { orderedCategories } from "./categories.js";
import { escapeHtml } from "./util.js";

// ---------------------------------------------------------------------------
// Hierarchy construction
//
// The browser is a zoomable treemap over two hierarchies:
//   Agents:   Category -> Agent -> Action (leaf)
//   Commands: Group    -> Command (leaf)
// We build plain data objects here and embed them as JSON; the client renders
// and lays them out (a viewport-aware squarified treemap), so nothing here
// depends on a DOM.
// ---------------------------------------------------------------------------

interface TreeNode {
    kind: "root" | "category" | "agent" | "action" | "group" | "command";
    name: string;
    emoji?: string;
    description?: string;
    // action-only
    agent?: string;
    schema?: string;
    enabled?: boolean;
    transient?: boolean;
    parameters?: {
        name: string;
        type: string;
        optional: boolean;
        description: string;
    }[];
    phrasings?: string[];
    // command-only
    group?: boolean;
    args?: { name: string; optional: boolean; description: string }[];
    flags?: {
        name: string;
        char: string;
        default: string;
        description: string;
    }[];
    children?: TreeNode[];
}

function buildAgentsTree(catalog: Catalog): TreeNode {
    const categories = orderedCategories(catalog.agents.map((a) => a.name));
    const children: TreeNode[] = [];
    for (const category of categories) {
        const agents = catalog.agents
            .filter((a) => a.category === category.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((agent): TreeNode => {
                const actions: TreeNode[] = [];
                for (const schema of agent.schemas) {
                    for (const action of schema.actions) {
                        actions.push({
                            kind: "action",
                            name: action.actionName,
                            agent: agent.name,
                            schema: schema.schemaName,
                            enabled: schema.defaultEnabled,
                            transient: schema.transient,
                            description: action.description,
                            parameters: action.parameters,
                            phrasings: action.phrasings,
                        });
                    }
                }
                actions.sort((a, b) => a.name.localeCompare(b.name));
                return {
                    kind: "agent",
                    name: agent.name,
                    emoji: agent.emoji,
                    description: agent.description,
                    children: actions,
                };
            })
            .filter((agent) => (agent.children?.length ?? 0) > 0);
        if (agents.length > 0) {
            children.push({
                kind: "category",
                name: category.name,
                emoji: category.emoji,
                children: agents,
            });
        }
    }
    return { kind: "root", name: "Agents", children };
}

function buildCommandsTree(catalog: Catalog): TreeNode {
    const groups = new Map<string, TreeNode[]>();
    for (const command of catalog.systemCommands) {
        const first = command.path.split(" ")[0] || command.path;
        let list = groups.get(first);
        if (list === undefined) {
            list = [];
            groups.set(first, list);
        }
        list.push({
            kind: "command",
            name: command.path,
            description: command.description,
            group: command.group,
            args: command.args.map((a) => ({
                name: a.name,
                optional: a.optional,
                description: a.description,
            })),
            flags: command.flags.map((f) => ({
                name: f.name,
                char: f.char,
                default: f.default,
                description: f.description,
            })),
        });
    }
    const children: TreeNode[] = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, commands]) => ({
            kind: "group" as const,
            name,
            children: commands.sort((a, b) => a.name.localeCompare(b.name)),
        }));
    return { kind: "root", name: "System commands", children };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const STYLE = `
:root{
  --bg:#0f1420; --fg:#e8edf5; --muted:#9aa6b8; --line:#243044;
  --header:#131a29; --chip:#1c2740; --chip-fg:#cfe0ff; --accent:#5aa0ff;
  --on-bg:#123021; --on-fg:#5fd08a; --off-bg:#331a1a; --off-fg:#ff8a80;
  --panel:#141c2b;
}
*{box-sizing:border-box;}
html,body{height:100%;}
body{margin:0;height:100vh;overflow:hidden;display:flex;flex-direction:column;
  color:var(--fg);background:var(--bg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
code,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}
header{background:var(--header);border-bottom:1px solid var(--line);padding:10px 16px;flex:0 0 auto;}
.titlebar{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
h1{margin:0;font-size:17px;}
.meta{color:var(--muted);font-size:12px;}
.controls{display:flex;align-items:center;gap:12px;margin-top:9px;flex-wrap:wrap;}
.tabs{display:flex;gap:4px;background:#0c111b;border:1px solid var(--line);border-radius:9px;padding:3px;}
.tab{appearance:none;border:0;background:transparent;color:var(--muted);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:13px;}
.tab.active{background:var(--accent);color:#04122b;font-weight:600;}
.breadcrumb{display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex:1 1 260px;min-width:180px;}
.crumb{appearance:none;border:0;background:transparent;color:var(--chip-fg);cursor:pointer;font-size:13px;padding:3px 7px;border-radius:6px;}
.crumb:hover{background:var(--chip);}
.crumb-static{color:var(--muted);}
.crumb-sep{color:var(--muted);}
.search{background:#0c111b;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:7px 11px;font-size:13px;width:230px;max-width:40vw;}
.search:focus{outline:2px solid var(--accent);outline-offset:1px;}
.map{position:relative;flex:1 1 auto;overflow:hidden;margin:8px;}
.cell{position:absolute;border-radius:12px;cursor:pointer;overflow:hidden;
  transition:left .32s cubic-bezier(.4,0,.2,1),top .32s cubic-bezier(.4,0,.2,1),
    width .32s cubic-bezier(.4,0,.2,1),height .32s cubic-bezier(.4,0,.2,1),opacity .3s ease;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10),0 1px 2px rgba(0,0,0,.35);}
.cell:hover{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),0 3px 12px rgba(0,0,0,.5);}
.cell.k-action,.cell.k-command{cursor:pointer;}
.lbl{position:absolute;inset:0;padding:10px 12px;display:flex;flex-direction:column;gap:3px;
  justify-content:flex-start;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none;}
.lbl-name{font-weight:650;line-height:1.15;word-break:break-word;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.lbl-sub{opacity:.85;font-weight:500;}
.cell.sm .lbl{padding:4px 6px;gap:1px;}
.cell.tiny .lbl{display:none;}
.cell.vert .lbl{flex-direction:column;align-items:center;justify-content:center;padding:6px 2px;gap:0;}
.cell.vert .lbl-name{display:block;writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:100%;line-height:1;}
.hint{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:var(--muted);font-size:12px;pointer-events:none;}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);}
/* details drawer */
.backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:opacity .2s;z-index:40;}
.backdrop.show{opacity:1;visibility:visible;}
.panel{position:fixed;top:0;right:0;height:100%;width:min(440px,92vw);background:var(--panel);
  border-left:1px solid var(--line);z-index:45;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);
  overflow:auto;padding:44px 20px 28px;}
.panel.open{transform:translateX(0);}
.panel-close{position:absolute;top:8px;right:10px;appearance:none;border:0;background:transparent;color:var(--muted);font-size:26px;line-height:1;cursor:pointer;}
.p-kicker{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}
.p-title{margin:2px 0 8px;font-size:20px;font-family:ui-monospace,Consolas,monospace;}
.p-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
.badge{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;}
.badge.on{background:var(--on-bg);color:var(--on-fg);}
.badge.off{background:var(--off-bg);color:var(--off-fg);}
.badge.neutral{background:var(--chip);color:var(--muted);}
.p-desc{color:#cbd5e6;}
.panel h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:16px 0 6px;}
.p-params{width:100%;border-collapse:collapse;font-size:13px;}
.p-params th,.p-params td{text-align:left;padding:5px 7px;border-bottom:1px solid var(--line);vertical-align:top;}
.p-params th{color:var(--muted);font-weight:600;}
.ptype{color:var(--accent);}
.req{color:var(--off-fg);font-size:11px;}
.opt{color:var(--muted);font-size:11px;}
.p-chips{display:flex;flex-wrap:wrap;gap:6px;}
.chip{background:var(--chip);color:var(--chip-fg);padding:3px 10px;border-radius:999px;font-size:13px;}
.p-list{margin:0;padding-left:18px;}
.p-list li{margin:3px 0;}
.p-list code{background:#0c111b;padding:1px 5px;border-radius:5px;}
/* nested containers (root view: agents shown inside their category) */
.cell.container{cursor:pointer;}
.cell .lbl.hdr{position:absolute;left:0;right:0;top:0;bottom:auto;height:auto;flex-direction:row;flex-wrap:nowrap;align-items:baseline;gap:8px;padding:5px 11px;overflow:hidden;}
.cell .lbl.hdr .lbl-name{display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0;}
.cell .lbl.hdr .lbl-sub{font-size:11px;opacity:.8;display:inline;flex:0 0 auto;white-space:nowrap;}
/* actions dialog (pops over the map) */
.dlg-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;visibility:hidden;transition:opacity .2s;z-index:25;}
.dlg-backdrop.show{opacity:1;visibility:visible;}
.dlg{position:fixed;z-index:26;top:50%;left:50%;transform:translate(-50%,-46%);opacity:0;visibility:hidden;width:min(940px,94vw);max-height:86vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6);transition:opacity .2s,transform .2s;}
.dlg.open{opacity:1;visibility:visible;transform:translate(-50%,-50%);}
.dlg-head{display:flex;align-items:flex-start;gap:14px;padding:15px 18px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap;}
.dlg-head-main{flex:1 1 240px;min-width:0;}
.dlg-title{margin:0;font-size:19px;}
.dlg-desc{margin:3px 0 0;color:var(--muted);font-size:13px;}
.dlg-count{margin-top:4px;font-size:12px;color:var(--muted);}
.dlg-layouts{display:flex;gap:4px;background:#0c111b;border:1px solid var(--line);border-radius:9px;padding:3px;align-self:center;}
.dlg-lay{appearance:none;border:0;background:transparent;color:var(--muted);padding:5px 10px;border-radius:7px;cursor:pointer;font-size:12px;}
.dlg-lay.active{background:var(--accent);color:#04122b;font-weight:600;}
.dlg-close{appearance:none;border:0;background:transparent;color:var(--muted);font-size:26px;line-height:1;cursor:pointer;}
.dlg-body{overflow:auto;padding:14px 18px 20px;}
.dlg-list{list-style:none;margin:0;padding:0;}
.dlg-row{padding:9px 11px;border-radius:8px;cursor:pointer;border:1px solid transparent;}
.dlg-row:hover{background:#0c111b;border-color:var(--line);}
.dlg-name{font-family:ui-monospace,Consolas,monospace;color:var(--chip-fg);font-weight:600;}
.dlg-row-desc{color:var(--muted);font-size:13px;margin-top:2px;}
.dlg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}
.dlg-card{padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#0c111b;cursor:pointer;}
.dlg-card:hover{border-color:var(--accent);}
.dlg-card-name{font-family:ui-monospace,Consolas,monospace;font-weight:650;color:var(--chip-fg);word-break:break-word;}
.dlg-card-desc{color:var(--muted);font-size:12.5px;margin-top:4px;}
.dlg-card-meta{margin-top:7px;font-size:11px;color:var(--muted);}
.dlg-table{width:100%;border-collapse:collapse;font-size:13px;}
.dlg-table th,.dlg-table td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;}
.dlg-table th{color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--panel);}
.dlg-table tr[data-idx]{cursor:pointer;}
.dlg-table tr[data-idx]:hover td{background:#0c111b;}
.dlg-tname{font-family:ui-monospace,Consolas,monospace;color:var(--chip-fg);font-weight:600;white-space:nowrap;}
.dlg-tparams{color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:12px;}
.dlg-table th[data-sort]{cursor:pointer;user-select:none;white-space:nowrap;}
.dlg-table th[data-sort]:hover{color:var(--fg);}
.dlg-table th.sorted{color:var(--fg);}
.sort-ar{font-size:10px;opacity:.9;}
.dlg-acc-item{border:1px solid var(--line);border-radius:9px;margin-bottom:8px;overflow:hidden;}
.dlg-acc-head{width:100%;text-align:left;appearance:none;border:0;background:#0c111b;color:var(--fg);cursor:pointer;padding:10px 12px;display:flex;gap:10px;align-items:baseline;}
.dlg-acc-head .dlg-row-desc{margin:0;flex:1 1 auto;}
.dlg-acc-body{display:none;padding:2px 14px 14px;}
.dlg-acc-item.open .dlg-acc-body{display:block;}
.caret{margin-left:auto;color:var(--muted);transition:transform .15s;}
.dlg-acc-item.open .caret{transform:rotate(90deg);}
`;

const APP = `
(function(){
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var mapEl = document.getElementById('map');
  var crumbEl = document.getElementById('breadcrumb');
  var searchEl = document.getElementById('q');
  var GAP = 6;

  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function computeValue(node){
    if(node._value!=null) return node._value;
    if(!node.children || !node.children.length){ node._value=1; return 1; }
    var s=0; for(var i=0;i<node.children.length;i++) s+=computeValue(node.children[i]);
    node._value=s; return s;
  }
  function assignHues(root){
    var kids=root.children||[]; var n=kids.length;
    for(var i=0;i<n;i++){ setHue(kids[i], Math.round(i/Math.max(1,n)*360)); }
  }
  function setHue(node,h){ node._hue=h; if(node.children) node.children.forEach(function(c){setHue(c,h);}); }

  computeValue(DATA.agents); computeValue(DATA.commands);
  assignHues(DATA.agents); assignHues(DATA.commands);

  var state = { mode:'agents', path:[DATA.agents], query:'' };

  function currentNode(){ return state.path[state.path.length-1]; }

  function colorFor(node, idx, n){
    var h = node._hue==null?210:node._hue;
    var sat = (node.kind==='action'||node.kind==='command')?40:58;
    var base = (node.kind==='category'||node.kind==='group')?42:(node.kind==='agent')?52:66;
    var jitter = n>1 ? ((idx/(n-1))-0.5)*12 : 0;
    return 'hsl('+h+','+sat+'%,'+(base+jitter)+'%)';
  }

  // Squarified treemap: items [{node,value}] -> [{node,x,y,w,h}]
  function squarify(items, X, Y, W, H){
    var out=[]; if(!items.length||W<=0||H<=0) return out;
    var sum=0; items.forEach(function(it){sum+=it.value;});
    if(sum<=0) return out;
    var scale=(W*H)/sum;
    var rem=items.map(function(it){return {node:it.node, area:it.value*scale};});
    var rect={x:X,y:Y,w:W,h:H};
    function worst(row,len){
      if(!row.length) return Infinity;
      var mx=-Infinity,mn=Infinity,s=0;
      for(var k=0;k<row.length;k++){var a=row[k].area;s+=a;if(a>mx)mx=a;if(a<mn)mn=a;}
      var s2=s*s,l2=len*len; return Math.max((l2*mx)/s2,s2/(l2*mn));
    }
    while(rem.length){
      var len=Math.min(rect.w,rect.h);
      var row=[];
      while(rem.length){
        var withNext=row.concat([rem[0]]);
        if(!row.length || worst(row,len)>=worst(withNext,len)){ row.push(rem.shift()); }
        else break;
      }
      var rowArea=0; row.forEach(function(r){rowArea+=r.area;});
      if(rect.w<=rect.h){
        var rh=rowArea/rect.w, cx=rect.x;
        for(var k=0;k<row.length;k++){ var cw=row[k].area/rh; out.push({node:row[k].node,x:cx,y:rect.y,w:cw,h:rh}); cx+=cw; }
        rect.y+=rh; rect.h-=rh;
      } else {
        var cw2=rowArea/rect.h, cy=rect.y;
        for(var k=0;k<row.length;k++){ var ch=row[k].area/cw2; out.push({node:row[k].node,x:rect.x,y:cy,w:cw2,h:ch}); cy+=ch; }
        rect.x+=cw2; rect.w-=cw2;
      }
    }
    return out;
  }

  function displayName(node){
    if(node.kind==='command') return '@'+node.name;
    if(node.kind==='action' && state.query && node.agent) return node.agent+' · '+node.name;
    return (node.emoji?node.emoji+' ':'')+node.name;
  }
  function subLabel(node){
    var c = node.children?node.children.length:0;
    if(node.kind==='category') return c+(c===1?' agent':' agents');
    if(node.kind==='agent') return c+(c===1?' action':' actions');
    if(node.kind==='group') return c+(c===1?' command':' commands');
    return '';
  }

  function placeCell(el,c){
    el.style.left=(c.x+GAP/2)+'px'; el.style.top=(c.y+GAP/2)+'px';
    el.style.width=Math.max(0,c.w-GAP)+'px'; el.style.height=Math.max(0,c.h-GAP)+'px';
  }

  function labelSizes(role, w, h){
    if(role==='container'){
      var cf=Math.max(12, Math.min(w*0.05, 18));
      return { name:cf, sub:Math.max(10, cf*0.72), showSub:w>150 };
    }
    var nf=Math.max(8, Math.min(w*0.11, h*0.32, 24));
    return { name:nf, sub:Math.max(9, Math.min(nf*0.6, 13)), showSub:(h>=46 && w>=58) };
  }

  function buildCell(c, role, idx, n){
    var node=c.node;
    var el=document.createElement('div');
    el.className='cell '+role+' k-'+node.kind;
    el._layout=c;
    if(role==='container'){
      var h=node._hue==null?210:node._hue;
      el.style.background='hsl('+h+',40%,22%)';
    } else {
      el.style.background=colorFor(node, idx, n);
    }
    var sub=subLabel(node);
    var sz=labelSizes(role, c.w, c.h);
    var vertical=false;
    if(role==='tile' && c.h>c.w*1.6 && c.w<60 && c.h>52){
      // tall, narrow tile — render the label vertically so it stays readable
      vertical=true;
      var vf=Math.max(9, Math.min(c.w*0.52, c.h*0.14, 22));
      sz={ name:vf, sub:0, showSub:false };
    }
    var lblCls = role==='container' ? 'lbl hdr' : 'lbl';
    var nameHtml='<span class="lbl-name" style="font-size:'+Math.round(sz.name)+'px">'+esc(displayName(node))+'</span>';
    var subHtml=(sub && sz.showSub)?'<span class="lbl-sub" style="font-size:'+Math.round(sz.sub)+'px">'+esc(sub)+'</span>':'';
    el.innerHTML='<div class="'+lblCls+'">'+nameHtml+subHtml+'</div>';
    var t = node.kind==='action'&&node.agent ? node.agent+' · '+node.name : displayName(node);
    el.title = t + (node.description?' — '+node.description:'');
    if(role==='tile'){
      if(vertical){ el.classList.add('vert'); }
      else {
        if(Math.min(c.w,c.h)<28) el.classList.add('sm');
        if(c.w<22||c.h<15) el.classList.add('tiny');
      }
    }
    el.addEventListener('click', function(ev){ ev.stopPropagation(); onCellClick(node, el); });
    return el;
  }

  function onCellClick(node, el){
    // Agents and command groups open a details dialog (a treemap of their
    // actions/commands would be meaningless without usage data); categories
    // zoom in; leaves (reached via search) open the side panel.
    if(node.kind==='agent' || node.kind==='group'){ openActionsDialog(node); return; }
    if(node.children && node.children.length){
      var r=el._layout;
      state.path.push(node);
      render({x:r.x,y:r.y,w:r.w,h:r.h});
      return;
    }
    openPanel(node);
  }

  function currentChildren(){
    if(state.query) return searchLeaves();
    var node=currentNode();
    return node.children || [];
  }

  function startPlace(el,c,fromRect,W,H){
    if(fromRect){
      var sx=fromRect.x + c.x/W*fromRect.w;
      var sy=fromRect.y + c.y/H*fromRect.h;
      var sw=c.w/W*fromRect.w, sh=c.h/H*fromRect.h;
      el.style.left=(sx+GAP/2)+'px'; el.style.top=(sy+GAP/2)+'px';
      el.style.width=Math.max(0,sw-GAP)+'px'; el.style.height=Math.max(0,sh-GAP)+'px';
    } else {
      placeCell(el,c);
    }
    el.style.opacity='0';
  }

  // Dampen tile sizing so lopsided action counts don't create unreadable
  // slivers (sizes aren't telemetry-based, so a gentler scale is fine).
  function sizeValue(v){ return Math.pow(v>0?v:1, 0.6); }

  function render(fromRect){
    var kids=currentChildren();
    var W=mapEl.clientWidth, H=mapEl.clientHeight;
    mapEl.innerHTML='';
    if(!kids.length){
      var e=document.createElement('div'); e.className='empty';
      e.textContent = state.query ? 'No matches for “'+state.query+'”.' : 'Nothing to show here.';
      mapEl.appendChild(e); renderBreadcrumb(); return;
    }
    // At the top level (agents mode), promote agents: draw each category as a
    // labelled container with its agent tiles nested inside (one level deep).
    var nested = !state.query && state.path.length===1 && state.mode==='agents';
    var HEADER=26, PAD=7;
    var top=squarify(kids.map(function(k){return {node:k,value:sizeValue(k._value||1)};}),0,0,W,H);
    var pending=[];
    function add(el,c){ startPlace(el,c,fromRect,W,H); pending.push({el:el,c:c}); }
    top.forEach(function(c,idx){
      var node=c.node;
      var canNest = nested && node.children && node.children.length && c.w>78 && c.h>(HEADER+36);
      if(canNest){
        var cont=buildCell(c,'container',idx,top.length);
        mapEl.appendChild(cont); add(cont,c);
        var inner=squarify(
          node.children.map(function(k){return {node:k,value:sizeValue(k._value||1)};}),
          c.x+PAD, c.y+HEADER, c.w-2*PAD, c.h-HEADER-PAD);
        inner.forEach(function(ic,j){
          var tile=buildCell(ic,'tile',j,inner.length);
          mapEl.appendChild(tile); add(tile,ic);
        });
      } else {
        var el=buildCell(c,'tile',idx,top.length);
        mapEl.appendChild(el); add(el,c);
      }
    });
    void mapEl.offsetWidth; // force reflow so start styles apply before the transition
    pending.forEach(function(p){ placeCell(p.el,p.c); p.el.style.opacity='1'; });
    renderBreadcrumb();
  }

  function renderBreadcrumb(){
    crumbEl.innerHTML='';
    state.path.forEach(function(node,i){
      var a=document.createElement('button'); a.className='crumb';
      a.textContent = i===0 ? (state.mode==='agents'?'All categories':'All commands') : (node.emoji?node.emoji+' ':'')+node.name;
      a.addEventListener('click', function(){ state.query=''; searchEl.value=''; state.path=state.path.slice(0,i+1); render(); });
      crumbEl.appendChild(a);
      if(i<state.path.length-1 || state.query){ var s=document.createElement('span'); s.className='crumb-sep'; s.textContent='›'; crumbEl.appendChild(s); }
    });
    if(state.query){ var r=document.createElement('span'); r.className='crumb crumb-static'; r.textContent='Results: “'+state.query+'”'; crumbEl.appendChild(r); }
  }

  function buildHay(node){
    var parts=[node.name, node.description||'', node.agent||''];
    if(node.parameters) node.parameters.forEach(function(p){parts.push(p.name,p.description||'');});
    if(node.phrasings) parts=parts.concat(node.phrasings);
    if(node.args) node.args.forEach(function(a){parts.push(a.name,a.description||'');});
    if(node.flags) node.flags.forEach(function(f){parts.push(f.name,f.description||'');});
    return parts.join(' ').toLowerCase();
  }
  function searchLeaves(){
    var root = state.mode==='agents'?DATA.agents:DATA.commands;
    var toks = state.query.split(/\\s+/).filter(Boolean);
    var out=[];
    (function walk(n){
      if(n.children && n.children.length) n.children.forEach(walk);
      else {
        if(n._hay==null) n._hay=buildHay(n);
        var ok=true; for(var i=0;i<toks.length;i++){ if(n._hay.indexOf(toks[i])<0){ ok=false; break; } }
        if(ok) out.push(n);
      }
    })(root);
    return out;
  }

  function closePanel(){
    document.getElementById('panel').classList.remove('open');
    document.getElementById('backdrop').classList.remove('show');
  }

  // tabs
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function(tab){
    tab.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function(t){t.classList.remove('active');});
      tab.classList.add('active');
      state.mode=tab.getAttribute('data-mode');
      state.query=''; searchEl.value='';
      state.path=[ state.mode==='agents'?DATA.agents:DATA.commands ];
      render();
    });
  });

  // search
  var searchTimer=null;
  searchEl.addEventListener('input', function(){
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){ state.query=searchEl.value.trim().toLowerCase(); render(); }, 120);
  });

  // click empty map area -> zoom out one level
  mapEl.addEventListener('click', function(){
    if(state.query) return;
    if(state.path.length>1){ state.path.pop(); render(); }
  });

  // Shared detail markup for an action or command (used by the side panel and
  // the accordion layout).
  function detailHtml(node){
    var html='';
    if(node.kind==='action'){
      html+='<div class="p-badges">'+(node.enabled?'<span class="badge on">enabled by default</span>':'<span class="badge off">disabled by default</span>')+(node.transient?'<span class="badge neutral">on-demand</span>':'')+'</div>';
      if(node.description) html+='<p class="p-desc">'+esc(node.description)+'</p>';
      if(node.parameters && node.parameters.length){
        html+='<h3>Parameters</h3><table class="p-params"><tr><th>Name</th><th>Type</th><th></th><th>Description</th></tr>';
        node.parameters.forEach(function(p){ html+='<tr><td><code>'+esc(p.name)+'</code></td><td><code class="ptype">'+esc(p.type)+'</code></td><td>'+(p.optional?'<span class="opt">optional</span>':'<span class="req">required</span>')+'</td><td>'+esc(p.description||'')+'</td></tr>'; });
        html+='</table>';
      }
      if(node.phrasings && node.phrasings.length){
        html+='<h3>Try saying</h3><div class="p-chips">';
        node.phrasings.forEach(function(p){ html+='<span class="chip">'+esc(p)+'</span>'; });
        html+='</div>';
      }
    } else if(node.kind==='command'){
      if(node.description) html+='<p class="p-desc">'+esc(node.description)+'</p>';
      if(node.args && node.args.length){
        html+='<h3>Arguments</h3><ul class="p-list">';
        node.args.forEach(function(a){ html+='<li><code>&lt;'+esc(a.name)+'&gt;</code>'+(a.optional?' (optional)':'')+' — '+esc(a.description||'')+'</li>'; });
        html+='</ul>';
      }
      if(node.flags && node.flags.length){
        html+='<h3>Flags</h3><ul class="p-list">';
        node.flags.forEach(function(f){ html+='<li><code>'+(f.char?'-'+esc(f.char)+', ':'')+'--'+esc(f.name)+'</code> — '+esc(f.description||'')+(f['default']?' (default: '+esc(f['default'])+')':'')+'</li>'; });
        html+='</ul>';
      }
    }
    return html;
  }

  function openPanel(node){
    if(node.kind!=='action' && node.kind!=='command') return;
    var kicker = node.kind==='action' ? esc(node.agent||'')+' · '+esc(node.schema||'') : 'system command';
    var title = node.kind==='command' ? '@'+esc(node.name) : esc(node.name);
    document.getElementById('panelBody').innerHTML='<div class="p-kicker">'+kicker+'</div><h2 class="p-title">'+title+'</h2>'+detailHtml(node);
    document.getElementById('panel').classList.add('open');
    document.getElementById('backdrop').classList.add('show');
  }

  // ---- actions dialog (prototype layouts) ----
  var DLG={ node:null, layout:'table' };
  function itemLabel(node){ return node.kind==='command' ? '@'+node.name : node.name; }
  function itemMeta(node){
    if(node.kind==='action'){
      var p=node.parameters?node.parameters.length:0, ph=node.phrasings?node.phrasings.length:0;
      return p+(p===1?' param':' params')+(ph?' · '+ph+' phrasing'+(ph===1?'':'s'):'');
    }
    var a=(node.args?node.args.length:0)+(node.flags?node.flags.length:0);
    return a+(a===1?' option':' options');
  }
  function itemParams(node){
    if(node.kind==='action'){ return (node.parameters||[]).map(function(p){return p.name+(p.optional?'?':'');}).join(', '); }
    return (node.args||[]).map(function(a){return '<'+a.name+'>';}).concat((node.flags||[]).map(function(f){return '--'+f.name;})).join(', ');
  }
  function openActionsDialog(node){
    DLG.node=node;
    DLG.sort={key:'name',dir:1};
    document.getElementById('dlgTitle').innerHTML=(node.emoji?esc(node.emoji)+' ':'')+esc(node.name);
    document.getElementById('dlgDesc').textContent=node.description||'';
    var c=node.children?node.children.length:0;
    document.getElementById('dlgCount').textContent=c+' '+(node.kind==='agent'?(c===1?'action':'actions'):(c===1?'command':'commands'));
    renderDialogBody();
    document.getElementById('dlgBackdrop').classList.add('show');
    document.getElementById('dlg').classList.add('open');
  }
  function closeDialog(){
    document.getElementById('dlg').classList.remove('open');
    document.getElementById('dlgBackdrop').classList.remove('show');
  }
  function renderDialogBody(){
    var items=(DLG.node&&DLG.node.children)||[];
    Array.prototype.forEach.call(document.querySelectorAll('.dlg-lay'), function(b){ b.classList.toggle('active', b.getAttribute('data-layout')===DLG.layout); });
    var L=DLG.layout, html;
    if(L==='cards') html=dlgCards(items);
    else if(L==='table') html=dlgTable(items);
    else if(L==='accordion') html=dlgAccordion(items);
    else html=dlgList(items);
    var b=document.getElementById('dlgBody'); b.innerHTML=html; b.scrollTop=0;
  }
  function dlgList(items){
    var h='<ul class="dlg-list">';
    items.forEach(function(it,i){ h+='<li class="dlg-row" data-idx="'+i+'"><div class="dlg-name">'+esc(itemLabel(it))+'</div>'+(it.description?'<div class="dlg-row-desc">'+esc(it.description)+'</div>':'')+'</li>'; });
    return h+'</ul>';
  }
  function dlgCards(items){
    var h='<div class="dlg-cards">';
    items.forEach(function(it,i){ h+='<div class="dlg-card" data-idx="'+i+'"><div class="dlg-card-name">'+esc(itemLabel(it))+'</div>'+(it.description?'<div class="dlg-card-desc">'+esc(it.description)+'</div>':'')+'<div class="dlg-card-meta">'+esc(itemMeta(it))+'</div></div>'; });
    return h+'</div>';
  }
  function paramCount(node){
    if(node.kind==='action') return node.parameters?node.parameters.length:0;
    return (node.args?node.args.length:0)+(node.flags?node.flags.length:0);
  }
  function cmpItems(a,b,key){
    if(key==='params') return paramCount(a)-paramCount(b);
    var av=key==='desc'?(a.description||''):itemLabel(a);
    var bv=key==='desc'?(b.description||''):itemLabel(b);
    return av.toLowerCase().localeCompare(bv.toLowerCase());
  }
  function dlgTable(items){
    var s=DLG.sort||{key:null,dir:1};
    var arr=items.slice();
    if(s.key){ arr.sort(function(a,b){ return cmpItems(a,b,s.key)*s.dir; }); }
    function th(key,label){ var on=s.key===key; return '<th data-sort="'+key+'" class="'+(on?'sorted':'')+'">'+esc(label)+(on?' <span class="sort-ar">'+(s.dir>0?'\u25b2':'\u25bc')+'</span>':'')+'</th>'; }
    var h='<table class="dlg-table"><thead><tr>'+th('name',DLG.node.kind==='agent'?'Action':'Command')+th('params','Parameters')+th('desc','Description')+'</tr></thead><tbody>';
    arr.forEach(function(it){ var i=items.indexOf(it); h+='<tr data-idx="'+i+'"><td class="dlg-tname">'+esc(itemLabel(it))+'</td><td class="dlg-tparams">'+esc(itemParams(it)||'\u2014')+'</td><td>'+esc(it.description||'')+'</td></tr>'; });
    return h+'</tbody></table>';
  }
  function dlgAccordion(items){
    var h='<div class="dlg-acc">';
    items.forEach(function(it,i){ h+='<div class="dlg-acc-item" data-idx="'+i+'"><button class="dlg-acc-head"><span class="dlg-name">'+esc(itemLabel(it))+'</span>'+(it.description?'<span class="dlg-row-desc">'+esc(it.description)+'</span>':'')+'<span class="caret">›</span></button><div class="dlg-acc-body">'+detailHtml(it)+'</div></div>'; });
    return h+'</div>';
  }

  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('backdrop').addEventListener('click', closePanel);

  // actions dialog wiring
  document.getElementById('dlgClose').addEventListener('click', closeDialog);
  document.getElementById('dlgBackdrop').addEventListener('click', closeDialog);
  Array.prototype.forEach.call(document.querySelectorAll('.dlg-lay'), function(b){
    b.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.dlg-lay'), function(x){x.classList.remove('active');});
      b.classList.add('active'); DLG.layout=b.getAttribute('data-layout'); renderDialogBody();
    });
  });
  document.getElementById('dlgBody').addEventListener('click', function(ev){
    var t=ev.target;
    if(DLG.layout==='accordion'){
      var head=t.closest?t.closest('.dlg-acc-head'):null;
      if(head) head.parentNode.classList.toggle('open');
      return;
    }
    if(DLG.layout==='table'){
      var th=t.closest?t.closest('th[data-sort]'):null;
      if(th){ var k=th.getAttribute('data-sort'); if(DLG.sort&&DLG.sort.key===k) DLG.sort.dir=-DLG.sort.dir; else DLG.sort={key:k,dir:1}; renderDialogBody(); return; }
    }
    var row=t.closest?t.closest('[data-idx]'):null;
    if(row){ var i=+row.getAttribute('data-idx'); var it=((DLG.node&&DLG.node.children)||[])[i]; if(it) openPanel(it); }
  });

  document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){
      if(document.getElementById('panel').classList.contains('open')) closePanel();
      else if(document.getElementById('dlg').classList.contains('open')) closeDialog();
      else if(state.query){ state.query=''; searchEl.value=''; render(); }
      else if(state.path.length>1){ state.path.pop(); render(); }
    }
  });

  var rzTimer=null;
  window.addEventListener('resize', function(){ if(rzTimer) cancelAnimationFrame(rzTimer); rzTimer=requestAnimationFrame(function(){ render(); }); });

  render();
})();
`;

function embedJson(data: unknown): string {
    // Escape "<" so the JSON payload can never terminate the <script> element.
    return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Render the full self-contained, zoomable Action Browser HTML document. */
export function renderHtml(catalog: Catalog): string {
    const data = {
        generatedAt: catalog.generatedAt,
        counts: catalog.counts,
        agents: buildAgentsTree(catalog),
        commands: buildCommandsTree(catalog),
    };
    const counts = catalog.counts;
    const generated = escapeHtml(formatDate(catalog.generatedAt));

    return [
        "<!doctype html>",
        // The repo policy check requires a copyright header on every .html
        // file (tools/scripts/policyChecks/copyrightHeaders.mjs). Emit it right
        // after the doctype so the committed docs/overview/action-browser.html
        // and the deployed site copy both satisfy the gate.
        "<!-- Copyright (c) Microsoft Corporation.\n Licensed under the MIT License. -->",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        "<title>TypeAgent Action Browser</title>",
        `<style>${STYLE}</style>`,
        "</head>",
        "<body>",
        "<header>",
        '<div class="titlebar">',
        "<h1>🧭 TypeAgent Action Browser</h1>",
        `<span class="meta">${counts.agents} agents · ${counts.actions} actions · ${counts.commands} system commands · generated ${generated}</span>`,
        "</div>",
        '<div class="controls">',
        '<div class="tabs">',
        '<button class="tab active" data-mode="agents">Agents</button>',
        '<button class="tab" data-mode="commands">System commands</button>',
        "</div>",
        '<nav id="breadcrumb" class="breadcrumb"></nav>',
        '<input id="q" class="search" type="search" autocomplete="off" placeholder="Search actions, parameters, phrasings…" />',
        "</div>",
        "</header>",
        '<div id="map" class="map"></div>',
        '<div id="backdrop" class="backdrop"></div>',
        '<aside id="panel" class="panel"><button id="panelClose" class="panel-close" aria-label="Close">×</button><div id="panelBody"></div></aside>',
        '<div id="dlgBackdrop" class="dlg-backdrop"></div>',
        '<div id="dlg" class="dlg" role="dialog" aria-modal="true">',
        '<div class="dlg-head">',
        '<div class="dlg-head-main"><h2 id="dlgTitle" class="dlg-title"></h2><p id="dlgDesc" class="dlg-desc"></p><div id="dlgCount" class="dlg-count"></div></div>',
        '<div class="dlg-layouts"><button class="dlg-lay" data-layout="list">List</button><button class="dlg-lay" data-layout="cards">Cards</button><button class="dlg-lay active" data-layout="table">Table</button><button class="dlg-lay" data-layout="accordion">Accordion</button></div>',
        '<button id="dlgClose" class="dlg-close" aria-label="Close">×</button>',
        "</div>",
        '<div id="dlgBody" class="dlg-body"></div>',
        "</div>",
        `<script id="data" type="application/json">${embedJson(data)}</script>`,
        `<script>${APP}</script>`,
        "</body>",
        "</html>",
    ].join("\n");
}

function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    return date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, " UTC");
}
