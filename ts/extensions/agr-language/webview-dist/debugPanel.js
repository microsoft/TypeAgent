/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const re=globalThis,he=re.ShadowRoot&&(re.ShadyCSS===void 0||re.ShadyCSS.nativeShadow)&&"adoptedStyleSheets"in Document.prototype&&"replace"in CSSStyleSheet.prototype,ue=Symbol(),ve=new WeakMap;let Ie=class{constructor(e,r,s){if(this._$cssResult$=!0,s!==ue)throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");this.cssText=e,this.t=r}get styleSheet(){let e=this.o;const r=this.t;if(he&&e===void 0){const s=r!==void 0&&r.length===1;s&&(e=ve.get(r)),e===void 0&&((this.o=e=new CSSStyleSheet).replaceSync(this.cssText),s&&ve.set(r,e))}return e}toString(){return this.cssText}};const ze=t=>new Ie(typeof t=="string"?t:t+"",void 0,ue),O=(t,...e)=>{const r=t.length===1?t[0]:e.reduce((s,i,o)=>s+(a=>{if(a._$cssResult$===!0)return a.cssText;if(typeof a=="number")return a;throw Error("Value passed to 'css' function must be a 'css' function result: "+a+". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.")})(i)+t[o+1],t[0]);return new Ie(r,t,ue)},Be=(t,e)=>{if(he)t.adoptedStyleSheets=e.map(r=>r instanceof CSSStyleSheet?r:r.styleSheet);else for(const r of e){const s=document.createElement("style"),i=re.litNonce;i!==void 0&&s.setAttribute("nonce",i),s.textContent=r.cssText,t.appendChild(s)}},me=he?t=>t:t=>t instanceof CSSStyleSheet?(e=>{let r="";for(const s of e.cssRules)r+=s.cssText;return ze(r)})(t):t;/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const{is:De,defineProperty:Fe,getOwnPropertyDescriptor:He,getOwnPropertyNames:Ue,getOwnPropertySymbols:Ne,getPrototypeOf:je}=Object,I=globalThis,_e=I.trustedTypes,Ge=_e?_e.emptyScript:"",ne=I.reactiveElementPolyfillSupport,V=(t,e)=>t,se={toAttribute(t,e){switch(e){case Boolean:t=t?Ge:null;break;case Object:case Array:t=t==null?t:JSON.stringify(t)}return t},fromAttribute(t,e){let r=t;switch(e){case Boolean:r=t!==null;break;case Number:r=t===null?null:Number(t);break;case Object:case Array:try{r=JSON.parse(t)}catch{r=null}}return r}},fe=(t,e)=>!De(t,e),be={attribute:!0,type:String,converter:se,reflect:!1,useDefault:!1,hasChanged:fe};Symbol.metadata??(Symbol.metadata=Symbol("metadata")),I.litPropertyMetadata??(I.litPropertyMetadata=new WeakMap);let N=class extends HTMLElement{static addInitializer(e){this._$Ei(),(this.l??(this.l=[])).push(e)}static get observedAttributes(){return this.finalize(),this._$Eh&&[...this._$Eh.keys()]}static createProperty(e,r=be){if(r.state&&(r.attribute=!1),this._$Ei(),this.prototype.hasOwnProperty(e)&&((r=Object.create(r)).wrapped=!0),this.elementProperties.set(e,r),!r.noAccessor){const s=Symbol(),i=this.getPropertyDescriptor(e,s,r);i!==void 0&&Fe(this.prototype,e,i)}}static getPropertyDescriptor(e,r,s){const{get:i,set:o}=He(this.prototype,e)??{get(){return this[r]},set(a){this[r]=a}};return{get:i,set(a){const l=i==null?void 0:i.call(this);o==null||o.call(this,a),this.requestUpdate(e,l,s)},configurable:!0,enumerable:!0}}static getPropertyOptions(e){return this.elementProperties.get(e)??be}static _$Ei(){if(this.hasOwnProperty(V("elementProperties")))return;const e=je(this);e.finalize(),e.l!==void 0&&(this.l=[...e.l]),this.elementProperties=new Map(e.elementProperties)}static finalize(){if(this.hasOwnProperty(V("finalized")))return;if(this.finalized=!0,this._$Ei(),this.hasOwnProperty(V("properties"))){const r=this.properties,s=[...Ue(r),...Ne(r)];for(const i of s)this.createProperty(i,r[i])}const e=this[Symbol.metadata];if(e!==null){const r=litPropertyMetadata.get(e);if(r!==void 0)for(const[s,i]of r)this.elementProperties.set(s,i)}this._$Eh=new Map;for(const[r,s]of this.elementProperties){const i=this._$Eu(r,s);i!==void 0&&this._$Eh.set(i,r)}this.elementStyles=this.finalizeStyles(this.styles)}static finalizeStyles(e){const r=[];if(Array.isArray(e)){const s=new Set(e.flat(1/0).reverse());for(const i of s)r.unshift(me(i))}else e!==void 0&&r.push(me(e));return r}static _$Eu(e,r){const s=r.attribute;return s===!1?void 0:typeof s=="string"?s:typeof e=="string"?e.toLowerCase():void 0}constructor(){super(),this._$Ep=void 0,this.isUpdatePending=!1,this.hasUpdated=!1,this._$Em=null,this._$Ev()}_$Ev(){var e;this._$ES=new Promise(r=>this.enableUpdating=r),this._$AL=new Map,this._$E_(),this.requestUpdate(),(e=this.constructor.l)==null||e.forEach(r=>r(this))}addController(e){var r;(this._$EO??(this._$EO=new Set)).add(e),this.renderRoot!==void 0&&this.isConnected&&((r=e.hostConnected)==null||r.call(e))}removeController(e){var r;(r=this._$EO)==null||r.delete(e)}_$E_(){const e=new Map,r=this.constructor.elementProperties;for(const s of r.keys())this.hasOwnProperty(s)&&(e.set(s,this[s]),delete this[s]);e.size>0&&(this._$Ep=e)}createRenderRoot(){const e=this.shadowRoot??this.attachShadow(this.constructor.shadowRootOptions);return Be(e,this.constructor.elementStyles),e}connectedCallback(){var e;this.renderRoot??(this.renderRoot=this.createRenderRoot()),this.enableUpdating(!0),(e=this._$EO)==null||e.forEach(r=>{var s;return(s=r.hostConnected)==null?void 0:s.call(r)})}enableUpdating(e){}disconnectedCallback(){var e;(e=this._$EO)==null||e.forEach(r=>{var s;return(s=r.hostDisconnected)==null?void 0:s.call(r)})}attributeChangedCallback(e,r,s){this._$AK(e,s)}_$ET(e,r){var o;const s=this.constructor.elementProperties.get(e),i=this.constructor._$Eu(e,s);if(i!==void 0&&s.reflect===!0){const a=(((o=s.converter)==null?void 0:o.toAttribute)!==void 0?s.converter:se).toAttribute(r,s.type);this._$Em=e,a==null?this.removeAttribute(i):this.setAttribute(i,a),this._$Em=null}}_$AK(e,r){var o,a;const s=this.constructor,i=s._$Eh.get(e);if(i!==void 0&&this._$Em!==i){const l=s.getPropertyOptions(i),c=typeof l.converter=="function"?{fromAttribute:l.converter}:((o=l.converter)==null?void 0:o.fromAttribute)!==void 0?l.converter:se;this._$Em=i;const f=c.fromAttribute(r,l.type);this[i]=f??((a=this._$Ej)==null?void 0:a.get(i))??f,this._$Em=null}}requestUpdate(e,r,s,i=!1,o){var a;if(e!==void 0){const l=this.constructor;if(i===!1&&(o=this[e]),s??(s=l.getPropertyOptions(e)),!((s.hasChanged??fe)(o,r)||s.useDefault&&s.reflect&&o===((a=this._$Ej)==null?void 0:a.get(e))&&!this.hasAttribute(l._$Eu(e,s))))return;this.C(e,r,s)}this.isUpdatePending===!1&&(this._$ES=this._$EP())}C(e,r,{useDefault:s,reflect:i,wrapped:o},a){s&&!(this._$Ej??(this._$Ej=new Map)).has(e)&&(this._$Ej.set(e,a??r??this[e]),o!==!0||a!==void 0)||(this._$AL.has(e)||(this.hasUpdated||s||(r=void 0),this._$AL.set(e,r)),i===!0&&this._$Em!==e&&(this._$Eq??(this._$Eq=new Set)).add(e))}async _$EP(){this.isUpdatePending=!0;try{await this._$ES}catch(r){Promise.reject(r)}const e=this.scheduleUpdate();return e!=null&&await e,!this.isUpdatePending}scheduleUpdate(){return this.performUpdate()}performUpdate(){var s;if(!this.isUpdatePending)return;if(!this.hasUpdated){if(this.renderRoot??(this.renderRoot=this.createRenderRoot()),this._$Ep){for(const[o,a]of this._$Ep)this[o]=a;this._$Ep=void 0}const i=this.constructor.elementProperties;if(i.size>0)for(const[o,a]of i){const{wrapped:l}=a,c=this[o];l!==!0||this._$AL.has(o)||c===void 0||this.C(o,void 0,a,c)}}let e=!1;const r=this._$AL;try{e=this.shouldUpdate(r),e?(this.willUpdate(r),(s=this._$EO)==null||s.forEach(i=>{var o;return(o=i.hostUpdate)==null?void 0:o.call(i)}),this.update(r)):this._$EM()}catch(i){throw e=!1,this._$EM(),i}e&&this._$AE(r)}willUpdate(e){}_$AE(e){var r;(r=this._$EO)==null||r.forEach(s=>{var i;return(i=s.hostUpdated)==null?void 0:i.call(s)}),this.hasUpdated||(this.hasUpdated=!0,this.firstUpdated(e)),this.updated(e)}_$EM(){this._$AL=new Map,this.isUpdatePending=!1}get updateComplete(){return this.getUpdateComplete()}getUpdateComplete(){return this._$ES}shouldUpdate(e){return!0}update(e){this._$Eq&&(this._$Eq=this._$Eq.forEach(r=>this._$ET(r,this[r]))),this._$EM()}updated(e){}firstUpdated(e){}};N.elementStyles=[],N.shadowRootOptions={mode:"open"},N[V("elementProperties")]=new Map,N[V("finalized")]=new Map,ne==null||ne({ReactiveElement:N}),(I.reactiveElementVersions??(I.reactiveElementVersions=[])).push("2.1.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const J=globalThis,$e=t=>t,ie=J.trustedTypes,ye=ie?ie.createPolicy("lit-html",{createHTML:t=>t}):void 0,Te="$lit$",R=`lit$${Math.random().toFixed(9).slice(2)}$`,Oe="?"+R,Ke=`<${Oe}>`,B=document,Q=()=>B.createComment(""),Z=t=>t===null||typeof t!="object"&&typeof t!="function",ge=Array.isArray,We=t=>ge(t)||typeof(t==null?void 0:t[Symbol.iterator])=="function",de=`[ 	
\f\r]`,q=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,xe=/-->/g,we=/>/g,M=RegExp(`>|${de}(?:([^\\s"'>=/]+)(${de}*=${de}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),Ae=/'/g,ke=/"/g,Me=/^(?:script|style|textarea|title)$/i,qe=t=>(e,...r)=>({_$litType$:t,strings:e,values:r}),n=qe(1),j=Symbol.for("lit-noChange"),d=Symbol.for("lit-nothing"),Se=new WeakMap,L=B.createTreeWalker(B,129);function Le(t,e){if(!ge(t)||!t.hasOwnProperty("raw"))throw Error("invalid template strings array");return ye!==void 0?ye.createHTML(e):e}const Ve=(t,e)=>{const r=t.length-1,s=[];let i,o=e===2?"<svg>":e===3?"<math>":"",a=q;for(let l=0;l<r;l++){const c=t[l];let f,g,u=-1,S=0;for(;S<c.length&&(a.lastIndex=S,g=a.exec(c),g!==null);)S=a.lastIndex,a===q?g[1]==="!--"?a=xe:g[1]!==void 0?a=we:g[2]!==void 0?(Me.test(g[2])&&(i=RegExp("</"+g[2],"g")),a=M):g[3]!==void 0&&(a=M):a===M?g[0]===">"?(a=i??q,u=-1):g[1]===void 0?u=-2:(u=a.lastIndex-g[2].length,f=g[1],a=g[3]===void 0?M:g[3]==='"'?ke:Ae):a===ke||a===Ae?a=M:a===xe||a===we?a=q:(a=M,i=void 0);const P=a===M&&t[l+1].startsWith("/>")?" ":"";o+=a===q?c+Ke:u>=0?(s.push(f),c.slice(0,u)+Te+c.slice(u)+R+P):c+R+(u===-2?l:P)}return[Le(t,o+(t[r]||"<?>")+(e===2?"</svg>":e===3?"</math>":"")),s]};class X{constructor({strings:e,_$litType$:r},s){let i;this.parts=[];let o=0,a=0;const l=e.length-1,c=this.parts,[f,g]=Ve(e,r);if(this.el=X.createElement(f,s),L.currentNode=this.el.content,r===2||r===3){const u=this.el.content.firstChild;u.replaceWith(...u.childNodes)}for(;(i=L.nextNode())!==null&&c.length<l;){if(i.nodeType===1){if(i.hasAttributes())for(const u of i.getAttributeNames())if(u.endsWith(Te)){const S=g[a++],P=i.getAttribute(u).split(R),ee=/([.?@])?(.*)/.exec(S);c.push({type:1,index:o,name:ee[2],strings:P,ctor:ee[1]==="."?Qe:ee[1]==="?"?Ze:ee[1]==="@"?Xe:oe}),i.removeAttribute(u)}else u.startsWith(R)&&(c.push({type:6,index:o}),i.removeAttribute(u));if(Me.test(i.tagName)){const u=i.textContent.split(R),S=u.length-1;if(S>0){i.textContent=ie?ie.emptyScript:"";for(let P=0;P<S;P++)i.append(u[P],Q()),L.nextNode(),c.push({type:2,index:++o});i.append(u[S],Q())}}}else if(i.nodeType===8)if(i.data===Oe)c.push({type:2,index:o});else{let u=-1;for(;(u=i.data.indexOf(R,u+1))!==-1;)c.push({type:7,index:o}),u+=R.length-1}o++}}static createElement(e,r){const s=B.createElement("template");return s.innerHTML=e,s}}function G(t,e,r=t,s){var a,l;if(e===j)return e;let i=s!==void 0?(a=r._$Co)==null?void 0:a[s]:r._$Cl;const o=Z(e)?void 0:e._$litDirective$;return(i==null?void 0:i.constructor)!==o&&((l=i==null?void 0:i._$AO)==null||l.call(i,!1),o===void 0?i=void 0:(i=new o(t),i._$AT(t,r,s)),s!==void 0?(r._$Co??(r._$Co=[]))[s]=i:r._$Cl=i),i!==void 0&&(e=G(t,i._$AS(t,e.values),i,s)),e}class Je{constructor(e,r){this._$AV=[],this._$AN=void 0,this._$AD=e,this._$AM=r}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(e){const{el:{content:r},parts:s}=this._$AD,i=((e==null?void 0:e.creationScope)??B).importNode(r,!0);L.currentNode=i;let o=L.nextNode(),a=0,l=0,c=s[0];for(;c!==void 0;){if(a===c.index){let f;c.type===2?f=new Y(o,o.nextSibling,this,e):c.type===1?f=new c.ctor(o,c.name,c.strings,this,e):c.type===6&&(f=new Ye(o,this,e)),this._$AV.push(f),c=s[++l]}a!==(c==null?void 0:c.index)&&(o=L.nextNode(),a++)}return L.currentNode=B,i}p(e){let r=0;for(const s of this._$AV)s!==void 0&&(s.strings!==void 0?(s._$AI(e,s,r),r+=s.strings.length-2):s._$AI(e[r])),r++}}class Y{get _$AU(){var e;return((e=this._$AM)==null?void 0:e._$AU)??this._$Cv}constructor(e,r,s,i){this.type=2,this._$AH=d,this._$AN=void 0,this._$AA=e,this._$AB=r,this._$AM=s,this.options=i,this._$Cv=(i==null?void 0:i.isConnected)??!0}get parentNode(){let e=this._$AA.parentNode;const r=this._$AM;return r!==void 0&&(e==null?void 0:e.nodeType)===11&&(e=r.parentNode),e}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(e,r=this){e=G(this,e,r),Z(e)?e===d||e==null||e===""?(this._$AH!==d&&this._$AR(),this._$AH=d):e!==this._$AH&&e!==j&&this._(e):e._$litType$!==void 0?this.$(e):e.nodeType!==void 0?this.T(e):We(e)?this.k(e):this._(e)}O(e){return this._$AA.parentNode.insertBefore(e,this._$AB)}T(e){this._$AH!==e&&(this._$AR(),this._$AH=this.O(e))}_(e){this._$AH!==d&&Z(this._$AH)?this._$AA.nextSibling.data=e:this.T(B.createTextNode(e)),this._$AH=e}$(e){var o;const{values:r,_$litType$:s}=e,i=typeof s=="number"?this._$AC(e):(s.el===void 0&&(s.el=X.createElement(Le(s.h,s.h[0]),this.options)),s);if(((o=this._$AH)==null?void 0:o._$AD)===i)this._$AH.p(r);else{const a=new Je(i,this),l=a.u(this.options);a.p(r),this.T(l),this._$AH=a}}_$AC(e){let r=Se.get(e.strings);return r===void 0&&Se.set(e.strings,r=new X(e)),r}k(e){ge(this._$AH)||(this._$AH=[],this._$AR());const r=this._$AH;let s,i=0;for(const o of e)i===r.length?r.push(s=new Y(this.O(Q()),this.O(Q()),this,this.options)):s=r[i],s._$AI(o),i++;i<r.length&&(this._$AR(s&&s._$AB.nextSibling,i),r.length=i)}_$AR(e=this._$AA.nextSibling,r){var s;for((s=this._$AP)==null?void 0:s.call(this,!1,!0,r);e!==this._$AB;){const i=$e(e).nextSibling;$e(e).remove(),e=i}}setConnected(e){var r;this._$AM===void 0&&(this._$Cv=e,(r=this._$AP)==null||r.call(this,e))}}class oe{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(e,r,s,i,o){this.type=1,this._$AH=d,this._$AN=void 0,this.element=e,this.name=r,this._$AM=i,this.options=o,s.length>2||s[0]!==""||s[1]!==""?(this._$AH=Array(s.length-1).fill(new String),this.strings=s):this._$AH=d}_$AI(e,r=this,s,i){const o=this.strings;let a=!1;if(o===void 0)e=G(this,e,r,0),a=!Z(e)||e!==this._$AH&&e!==j,a&&(this._$AH=e);else{const l=e;let c,f;for(e=o[0],c=0;c<o.length-1;c++)f=G(this,l[s+c],r,c),f===j&&(f=this._$AH[c]),a||(a=!Z(f)||f!==this._$AH[c]),f===d?e=d:e!==d&&(e+=(f??"")+o[c+1]),this._$AH[c]=f}a&&!i&&this.j(e)}j(e){e===d?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,e??"")}}class Qe extends oe{constructor(){super(...arguments),this.type=3}j(e){this.element[this.name]=e===d?void 0:e}}class Ze extends oe{constructor(){super(...arguments),this.type=4}j(e){this.element.toggleAttribute(this.name,!!e&&e!==d)}}class Xe extends oe{constructor(e,r,s,i,o){super(e,r,s,i,o),this.type=5}_$AI(e,r=this){if((e=G(this,e,r,0)??d)===j)return;const s=this._$AH,i=e===d&&s!==d||e.capture!==s.capture||e.once!==s.once||e.passive!==s.passive,o=e!==d&&(s===d||i);i&&this.element.removeEventListener(this.name,this,s),o&&this.element.addEventListener(this.name,this,e),this._$AH=e}handleEvent(e){var r;typeof this._$AH=="function"?this._$AH.call(((r=this.options)==null?void 0:r.host)??this.element,e):this._$AH.handleEvent(e)}}class Ye{constructor(e,r,s){this.element=e,this.type=6,this._$AN=void 0,this._$AM=r,this.options=s}get _$AU(){return this._$AM._$AU}_$AI(e){G(this,e)}}const le=J.litHtmlPolyfillSupport;le==null||le(X,Y),(J.litHtmlVersions??(J.litHtmlVersions=[])).push("3.3.2");const et=(t,e,r)=>{const s=(r==null?void 0:r.renderBefore)??e;let i=s._$litPart$;if(i===void 0){const o=(r==null?void 0:r.renderBefore)??null;s._$litPart$=i=new Y(e.insertBefore(Q(),o),o,void 0,r??{})}return i._$AI(t),i};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const z=globalThis;class w extends N{constructor(){super(...arguments),this.renderOptions={host:this},this._$Do=void 0}createRenderRoot(){var r;const e=super.createRenderRoot();return(r=this.renderOptions).renderBefore??(r.renderBefore=e.firstChild),e}update(e){const r=this.render();this.hasUpdated||(this.renderOptions.isConnected=this.isConnected),super.update(e),this._$Do=et(r,this.renderRoot,this.renderOptions)}connectedCallback(){var e;super.connectedCallback(),(e=this._$Do)==null||e.setConnected(!0)}disconnectedCallback(){var e;super.disconnectedCallback(),(e=this._$Do)==null||e.setConnected(!1)}render(){return j}}var Re;w._$litElement$=!0,w.finalized=!0,(Re=z.litElementHydrateSupport)==null||Re.call(z,{LitElement:w});const ce=z.litElementPolyfillSupport;ce==null||ce({LitElement:w});(z.litElementVersions??(z.litElementVersions=[])).push("4.2.2");/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const D=t=>(e,r)=>{r!==void 0?r.addInitializer(()=>{customElements.define(t,e)}):customElements.define(t,e)};/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */const tt={attribute:!0,type:String,converter:se,reflect:!1,hasChanged:fe},rt=(t=tt,e,r)=>{const{kind:s,metadata:i}=r;let o=globalThis.litPropertyMetadata.get(i);if(o===void 0&&globalThis.litPropertyMetadata.set(i,o=new Map),s==="setter"&&((t=Object.create(t)).wrapped=!0),o.set(r.name,t),s==="accessor"){const{name:a}=r;return{set(l){const c=e.get.call(this);e.set.call(this,l),this.requestUpdate(a,c,t,!0,l)},init(l){return l!==void 0&&this.C(a,void 0,t,l),l}}}if(s==="setter"){const{name:a}=r;return function(l){const c=this[a];e.call(this,l),this.requestUpdate(a,c,t,!0,l)}}throw Error("Unsupported decorator location: "+s)};function h(t){return(e,r)=>typeof r=="object"?rt(t,e,r):((s,i,o)=>{const a=i.hasOwnProperty(o);return i.constructor.createProperty(o,s),a?Object.getOwnPropertyDescriptor(i,o):void 0})(t,e,r)}/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */function p(t){return h({...t,state:!0,attribute:!1})}const F=O`
    :host {
        display: block;
        font-family: var(
            --gt-font-family,
            var(--vscode-font-family, sans-serif)
        );
        font-size: var(--gt-font-size, var(--vscode-font-size, 13px));
        color: var(--gt-foreground, var(--vscode-foreground, #cccccc));
        background: var(
            --gt-background,
            var(--vscode-editor-background, #1e1e1e)
        );
    }

    .mono {
        font-family: var(
            --gt-mono-font-family,
            var(
                --vscode-editor-font-family,
                "Cascadia Code",
                Consolas,
                monospace
            )
        );
    }

    input[type="text"],
    textarea {
        background: var(--vscode-input-background, #3c3c3c);
        color: var(--vscode-input-foreground, #cccccc);
        border: 1px solid var(--vscode-input-border, #3c3c3c);
        padding: 4px 8px;
        font-size: inherit;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
    }

    input[type="text"]:focus,
    textarea:focus {
        border-color: var(--vscode-focusBorder, #007fd4);
    }

    button {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        padding: 4px 12px;
        cursor: pointer;
        font-size: inherit;
        font-family: inherit;
    }

    button:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    button.secondary {
        background: var(--vscode-button-secondaryBackground, #3a3d41);
        color: var(--vscode-button-secondaryForeground, #cccccc);
    }

    .error-text {
        color: var(--vscode-errorForeground, #f48771);
    }

    .warning-text {
        color: var(--vscode-editorWarning-foreground, #cca700);
    }

    .info-text {
        color: var(--vscode-editorInfo-foreground, #3794ff);
    }

    .muted {
        color: var(--vscode-descriptionForeground, #9d9d9d);
    }

    a {
        color: var(--vscode-textLink-foreground, #3794ff);
        text-decoration: none;
    }

    a:hover {
        text-decoration: underline;
    }

    .empty-state {
        padding: 24px 16px;
        text-align: center;
        color: var(--vscode-descriptionForeground, #9d9d9d);
    }
`;var st=Object.defineProperty,it=Object.getOwnPropertyDescriptor,ae=(t,e,r,s)=>{for(var i=s>1?void 0:s?it(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&st(e,r,i),i};let K=class extends w{constructor(){super(...arguments),this._selectedRule=""}render(){const t=this.grammar;if(!t)return n`<div class="empty-state">No grammar loaded</div>`;const e=t.identifiers.ruleIds;return e.length===0?n`<div class="empty-state">No rules found</div>`:n`
            ${e.map(r=>{var i;const s=(i=t.debugInfo)==null?void 0:i.rules.get(r);return n`
                    <div
                        class="rule-item ${this._selectedRule===r?"selected":""}"
                        @click=${()=>{var o;this._selectedRule=r,(o=this.onRuleClick)==null||o.call(this,r,s)}}
                    >
                        <span class="rule-name">&lt;${r}&gt;</span>
                        ${s?n`<span class="rule-location"
                                  >${s.displayPath}:${s.range.start.line+1}</span
                              >`:d}
                    </div>
                `})}
        `}};K.styles=[F,O`
            .rule-item {
                padding: 4px 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .rule-item:hover {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .rule-item.selected {
                background: var(
                    --vscode-list-activeSelectionBackground,
                    #094771
                );
                color: var(--vscode-list-activeSelectionForeground, #ffffff);
            }
            .rule-name {
                flex: 1;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
            }
            .rule-location {
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
        `];ae([h({attribute:!1})],K.prototype,"grammar",2);ae([h({attribute:!1})],K.prototype,"onRuleClick",2);ae([p()],K.prototype,"_selectedRule",2);K=ae([D("gt-rule-list")],K);var ot=Object.defineProperty,at=Object.getOwnPropertyDescriptor,x=(t,e,r,s)=>{for(var i=s>1?void 0:s?at(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&ot(e,r,i),i};let _=class extends w{constructor(){super(...arguments),this.agents=[],this.liveAvailable=!1,this._mode="file",this._filePath="",this._selectedAgent="",this._loading=!1,this._error="",this._status=""}_setMode(t){this._mode=t,this._error="",this._status=""}async _load(){var t,e;if(this.backend){this._loading=!0,this._error="",this._status="";try{let r;switch(this._mode){case"file":if(!this._filePath){this._error="Enter a file path";return}r=await this.backend.loadGrammarFromFile(this._filePath);break;case"agent":if(!this._selectedAgent){this._error="Select an agent";return}r=await this.backend.loadGrammarFromAgent(this._selectedAgent);break;case"live":r=await this.backend.loadGrammarFromSnapshot({grammar:{}});break}r.ok?this._status="Loaded successfully":this._status=`${r.diagnostics.length} error(s)`,(t=this.onLoad)==null||t.call(this,r)}catch(r){const s=r instanceof Error?r:new Error(String(r));this._error=s.message,(e=this.onError)==null||e.call(this,s)}finally{this._loading=!1}}}_onBrowse(){this.dispatchEvent(new CustomEvent("browse",{bubbles:!0,composed:!0}))}render(){return n`
            <div class="mode-row">
                <span>Source:</span>
                ${this._radioButton("file","File")}
                ${this._radioButton("agent","Agent")}
                ${this.liveAvailable?this._radioButton("live","Live"):d}
            </div>

            ${this._mode==="file"?this._renderFilePanel():d}
            ${this._mode==="agent"?this._renderAgentPanel():d}
            ${this._mode==="live"?this._renderLivePanel():d}
            ${this._error?n`<div class="status error-text">${this._error}</div>`:d}
            ${this._status?n`<div class="status info-text">${this._status}</div>`:d}
        `}_radioButton(t,e){return n`
            <label>
                <input
                    type="radio"
                    name="source-mode"
                    .checked=${this._mode===t}
                    @change=${()=>this._setMode(t)}
                />
                ${e}
            </label>
        `}_renderFilePanel(){return n`
            <div class="panel">
                <div class="panel-row">
                    <input
                        type="text"
                        placeholder="/path/to/grammar.agr"
                        .value=${this._filePath}
                        @input=${t=>{this._filePath=t.target.value}}
                        @keydown=${t=>{t.key==="Enter"&&this._load()}}
                    />
                    <button class="secondary" @click=${this._onBrowse}>
                        📂
                    </button>
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `}_renderAgentPanel(){return n`
            <div class="panel">
                <div class="panel-row">
                    <select
                        @change=${t=>{this._selectedAgent=t.target.value}}
                    >
                        <option value="">Select agent...</option>
                        ${this.agents.map(t=>n`<option
                                    value=${t}
                                    ?selected=${this._selectedAgent===t}
                                >
                                    ${t}
                                </option>`)}
                    </select>
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `}_renderLivePanel(){return n`
            <div class="panel">
                <div class="panel-row">
                    <span class="muted"
                        >Session: current (requires running dispatcher)</span
                    >
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `}};_.styles=[F,O`
            .mode-row {
                display: flex;
                gap: 16px;
                padding: 8px 0;
                align-items: center;
            }
            .mode-row label {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
            }
            .panel {
                padding: 8px 0;
            }
            .panel-row {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .panel-row input[type="text"] {
                flex: 1;
            }
            select {
                background: var(--vscode-input-background, #3c3c3c);
                color: var(--vscode-input-foreground, #cccccc);
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                padding: 4px 8px;
                font-size: inherit;
                font-family: inherit;
                min-width: 160px;
            }
            select:focus {
                border-color: var(--vscode-focusBorder, #007fd4);
            }
            .status {
                padding: 4px 0;
                font-size: 0.9em;
            }
        `];x([h({attribute:!1})],_.prototype,"backend",2);x([h({type:Array})],_.prototype,"agents",2);x([h({type:Boolean,attribute:"live-available"})],_.prototype,"liveAvailable",2);x([h({attribute:!1})],_.prototype,"onLoad",2);x([h({attribute:!1})],_.prototype,"onError",2);x([p()],_.prototype,"_mode",2);x([p()],_.prototype,"_filePath",2);x([p()],_.prototype,"_selectedAgent",2);x([p()],_.prototype,"_loading",2);x([p()],_.prototype,"_error",2);x([p()],_.prototype,"_status",2);_=x([D("gt-source-view")],_);var nt=Object.defineProperty,dt=Object.getOwnPropertyDescriptor,k=(t,e,r,s)=>{for(var i=s>1?void 0:s?dt(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&nt(e,r,i),i};let y=class extends w{constructor(){super(...arguments),this.initialInput="",this.debounceMs=150,this._input="",this._error="",this._loading=!1,this._selectedIndex=-1,this._initialized=!1}connectedCallback(){super.connectedCallback(),!this._initialized&&this.initialInput&&(this._input=this.initialInput,this._initialized=!0,this._queryCompletion())}_onInput(t){const e=t.target;this._input=e.value,this._selectedIndex=-1,this._debounceTimer!==void 0&&clearTimeout(this._debounceTimer),this._debounceTimer=setTimeout(()=>this._queryCompletion(),this.debounceMs)}_onKeydown(t){const e=this._allCompletions();e.length!==0&&(t.key==="ArrowDown"?(t.preventDefault(),this._selectedIndex=Math.min(this._selectedIndex+1,e.length-1)):t.key==="ArrowUp"?(t.preventDefault(),this._selectedIndex=Math.max(this._selectedIndex-1,-1)):t.key==="Enter"&&this._selectedIndex>=0?(t.preventDefault(),this._appendCompletion(e[this._selectedIndex])):t.key==="Escape"&&(this._selectedIndex=-1))}_allCompletions(){return this._preview?this._preview.groups.flatMap(t=>t.completions):[]}_appendCompletion(t){this._input=this._input+" "+t,this._selectedIndex=-1,this._queryCompletion();const e=this.renderRoot.querySelector("input");e==null||e.focus()}async _queryCompletion(){if(!(!this.backend||!this.grammar)){this._loading=!0,this._error="";try{this._preview=await this.backend.previewCompletion(this.grammar,this._input)}catch(t){this._error=t instanceof Error?t.message:String(t),this._preview=void 0}finally{this._loading=!1}}}render(){const t=this._preview,e=(t==null?void 0:t.matchedPrefixLength)??0,r=this._input.slice(0,e),s=this._input.slice(e);let i=0;return n`
            <div class="input-row">
                <input
                    type="text"
                    placeholder="Type to see completions..."
                    .value=${this._input}
                    @input=${this._onInput}
                    @keydown=${this._onKeydown}
                />
            </div>

            ${t?n`
                      <div class="status-bar">
                          <span
                              >Matched:
                              <span class="matched-highlight">${e}</span>
                              chars</span
                          >
                          <span
                              >Wildcard:
                              ${t.afterWildcard}${t.afterWildcard!=="none"?n` <span class="warning">&#9888;</span>`:d}</span
                          >
                          ${t.directionSensitive?n`<span class="info-text"
                                    >direction-sensitive</span
                                >`:d}
                      </div>
                  `:d}
            ${this._error?n`<div class="error-text" style="padding: 8px">
                      ${this._error}
                  </div>`:d}
            ${this._loading?n`<div class="muted" style="padding: 8px">Loading...</div>`:d}
            ${t&&t.groups.length>0?n`
                      <div class="groups">
                          ${t.groups.map(o=>{const a=i;return i+=o.completions.length,n`
                                  <div class="group-header">
                                      ${o.separatorMode}
                                  </div>
                                  ${o.completions.map((l,c)=>{const f=a+c;return n`<div
                                          class="completion-item ${f===this._selectedIndex?"selected":""}"
                                          @click=${()=>this._appendCompletion(l)}
                                      >
                                          ${l}
                                      </div>`})}
                              `})}
                      </div>
                  `:t&&t.groups.length===0&&this._input.length>0?n`<div class="empty-state">No completions</div>`:!t&&!this._error&&!this._loading?n`<div class="empty-state">
                          Type to see completions
                      </div>`:d}
            ${t!=null&&t.properties&&t.properties.length>0?n`
                      <div class="property-bar">
                          Properties:
                          ${t.properties.flatMap(o=>o.propertyNames).join(", ")}
                      </div>
                  `:d}

            <div style="display:none">
                <span class="matched-highlight">${r}</span
                >${s}
            </div>
        `}};y.styles=[F,O`
            .input-row {
                display: flex;
                gap: 8px;
                margin-bottom: 8px;
            }
            .input-row input {
                flex: 1;
            }
            .status-bar {
                display: flex;
                gap: 12px;
                padding: 4px 8px;
                font-size: 0.9em;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .status-bar .warning {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }
            .groups {
                padding: 8px 0;
            }
            .group-header {
                padding: 4px 8px;
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .completion-item {
                padding: 2px 8px 2px 20px;
                cursor: pointer;
                font-family: var(
                    --gt-mono-font-family,
                    var(
                        --vscode-editor-font-family,
                        "Cascadia Code",
                        Consolas,
                        monospace
                    )
                );
            }
            .completion-item:hover,
            .completion-item.selected {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .completion-item::before {
                content: "\\25B8 ";
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .property-bar {
                padding: 6px 8px;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .matched-highlight {
                color: var(--vscode-editorInfo-foreground, #3794ff);
                text-decoration: underline;
            }
        `];k([h({attribute:!1})],y.prototype,"backend",2);k([h({attribute:!1})],y.prototype,"grammar",2);k([h({type:String,attribute:"initial-input"})],y.prototype,"initialInput",2);k([h({type:Number,attribute:"debounce-ms"})],y.prototype,"debounceMs",2);k([p()],y.prototype,"_input",2);k([p()],y.prototype,"_preview",2);k([p()],y.prototype,"_error",2);k([p()],y.prototype,"_loading",2);k([p()],y.prototype,"_selectedIndex",2);y=k([D("gt-completion-panel")],y);var lt=Object.defineProperty,ct=Object.getOwnPropertyDescriptor,$=(t,e,r,s)=>{for(var i=s>1?void 0:s?ct(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&lt(e,r,i),i};const Ee={ruleEntered:"▶",ruleExited:"◀",partAttempted:"◆",partMatched:"✓",partFailed:"✗",backtrack:"↩"},Pe={ruleEntered:"var(--vscode-editorInfo-foreground, #3794ff)",ruleExited:"var(--vscode-editorInfo-foreground, #3794ff)",partAttempted:"var(--vscode-descriptionForeground, #9d9d9d)",partMatched:"#4ec9b0",partFailed:"var(--vscode-errorForeground, #f48771)",backtrack:"var(--vscode-editorWarning-foreground, #cca700)"};let m=class extends w{constructor(){super(...arguments),this.initialInput="",this._input="",this._error="",this._loading=!1,this._selectedRow=-1,this._hoveredRow=-1,this._expandedRows=new Set,this._hiddenKinds=new Set,this._initialized=!1}connectedCallback(){super.connectedCallback(),!this._initialized&&this.initialInput&&(this._input=this.initialInput,this._initialized=!0)}async _runTrace(){if(!(!this.backend||!this.grammar||!this._input)){this._loading=!0,this._error="";try{this._trace=await this.backend.traceMatch(this.grammar,this._input)}catch(t){this._error=t instanceof Error?t.message:String(t),this._trace=void 0}finally{this._loading=!1}}}_onInputKeydown(t){t.key==="Enter"&&(t.preventDefault(),this._runTrace())}_toggleKind(t){const e=new Set(this._hiddenKinds);e.has(t)?e.delete(t):e.add(t),this._hiddenKinds=e}_toggleExpand(t){const e=new Set(this._expandedRows);e.has(t)?e.delete(t):e.add(t),this._expandedRows=e}_visibleEvents(){return this._trace?this._trace.events.map((t,e)=>({event:t,index:e})).filter(({event:t})=>!this._hiddenKinds.has(t.kind)):[]}_highlightRange(){if(!this._trace||this._hoveredRow<0)return;const t=this._trace.events[this._hoveredRow];if(!t)return;const e=t.inputPos??0,r=t.endPos??e;return{start:e,end:r}}_renderInputDisplay(){var o;const t=((o=this._trace)==null?void 0:o.input)??this._input,e=this._highlightRange();if(!e||e.start===e.end)return n`<div class="input-display">${t}</div>`;const r=t.slice(0,e.start),s=t.slice(e.start,e.end),i=t.slice(e.end);return n`<div class="input-display">
            ${r}<span class="highlight">${s}</span>${i}
        </div>`}_eventDetail(t){switch(t.kind){case"ruleEntered":return`depth ${t.depth}`;case"ruleExited":return`result: ${t.result}`;case"partMatched":return`-> pos ${t.endPos}`;case"partAttempted":return t.partKind;default:return""}}render(){const t=this._visibleEvents(),e=["ruleEntered","ruleExited","partAttempted","partMatched","partFailed","backtrack"];return n`
            <div class="input-row">
                <input
                    type="text"
                    placeholder="Enter input to trace..."
                    .value=${this._input}
                    @input=${r=>{this._input=r.target.value}}
                    @keydown=${this._onInputKeydown}
                />
                <button
                    @click=${this._runTrace}
                    ?disabled=${this._loading||!this._input}
                >
                    Trace
                </button>
            </div>

            ${this._trace?this._renderInputDisplay():d}
            ${this._error?n`<div class="error-text" style="padding: 8px">
                      ${this._error}
                  </div>`:d}
            ${this._loading?n`<div class="muted" style="padding: 8px">Tracing...</div>`:d}
            ${this._trace?n`
                      <div class="filter-bar">
                          ${e.map(r=>n`
                                  <button
                                      class="filter-btn ${this._hiddenKinds.has(r)?"":"active"}"
                                      @click=${()=>this._toggleKind(r)}
                                  >
                                      <span style="color: ${Pe[r]}"
                                          >${Ee[r]}</span
                                      >
                                      ${r}
                                  </button>
                              `)}
                      </div>

                      <table>
                          <thead>
                              <tr>
                                  <th>#</th>
                                  <th>Event</th>
                                  <th>Rule</th>
                                  <th>Pos</th>
                                  <th>Detail</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${t.map(({event:r,index:s})=>{const i=r.kind==="ruleEntered"?r.depth:0,o=r.kind!=="backtrack"?r.rule:void 0,a=r.kind==="partMatched"&&"slots"in r;return n`
                                      <tr
                                          class="${this._selectedRow===s?"selected":""}"
                                          @mouseenter=${()=>{this._hoveredRow=s}}
                                          @mouseleave=${()=>{this._hoveredRow=-1}}
                                          @click=${()=>{this._selectedRow=s,a&&this._toggleExpand(s)}}
                                      >
                                          <td>${s+1}</td>
                                          <td>
                                              <span
                                                  class="event-icon"
                                                  style="color: ${Pe[r.kind]}"
                                                  >${Ee[r.kind]}</span
                                              >
                                              ${r.kind}
                                          </td>
                                          <td>
                                              <span
                                                  class="depth-indent"
                                                  style="width: ${i*12}px"
                                              ></span>
                                              ${this._renderRuleLink(o??"")}
                                          </td>
                                          <td>${r.inputPos}</td>
                                          <td>${this._eventDetail(r)}</td>
                                      </tr>
                                      ${a&&this._expandedRows.has(s)?n`<tr>
                                                <td colspan="5">
                                                    <div class="slots">
                                                        slots:
                                                        ${JSON.stringify(r.slots)}
                                                    </div>
                                                </td>
                                            </tr>`:d}
                                  `})}
                          </tbody>
                      </table>

                      <div class="summary-bar">
                          ${this._trace.events.length} events,
                          ${this._trace.events.filter(r=>r.kind==="ruleEntered").length}
                          rules entered,
                          ${this._trace.events.filter(r=>r.kind==="backtrack").length}
                          backtracks, result:
                          <strong>${this._trace.result}</strong>
                      </div>
                  `:!this._loading&&!this._error?n`<div class="empty-state">
                        Enter input and click Trace
                    </div>`:d}
        `}_renderRuleLink(t){var r;if(!this.onSourceClick||!((r=this.grammar)!=null&&r.debugInfo))return n`<span>${t}</span>`;const e=this.grammar.debugInfo.rules.get(t);return e?n`<span
            class="rule-link"
            @click=${s=>{s.stopPropagation(),this.onSourceClick(e)}}
            >${t}</span
        >`:n`<span>${t}</span>`}};m.styles=[F,O`
            .input-row {
                display: flex;
                gap: 8px;
                margin-bottom: 8px;
            }
            .input-row input {
                flex: 1;
            }
            .filter-bar {
                display: flex;
                gap: 4px;
                padding: 4px 0;
                flex-wrap: wrap;
            }
            .filter-btn {
                font-size: 0.8em;
                padding: 2px 8px;
                border-radius: 3px;
                cursor: pointer;
                border: 1px solid var(--vscode-panel-border, #80808059);
                background: transparent;
                color: inherit;
            }
            .filter-btn.active {
                background: var(--vscode-badge-background, #4d4d4d);
                color: var(--vscode-badge-foreground, #ffffff);
            }

            .input-display {
                padding: 6px 8px;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
                background: var(--vscode-input-background, #3c3c3c);
                margin-bottom: 4px;
                white-space: pre;
                position: relative;
                min-height: 1.4em;
            }
            .input-display .highlight {
                background: rgba(55, 148, 255, 0.3);
            }

            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.9em;
            }
            th {
                text-align: left;
                padding: 4px 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-weight: normal;
                font-size: 0.85em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            td {
                padding: 2px 8px;
                vertical-align: top;
                border-bottom: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
            }
            tr:hover td {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            tr.selected td {
                background: var(
                    --vscode-list-activeSelectionBackground,
                    #094771
                );
            }
            .event-icon {
                font-weight: bold;
                width: 2em;
                text-align: center;
            }
            .rule-link {
                cursor: pointer;
                color: var(--vscode-textLink-foreground, #3794ff);
            }
            .rule-link:hover {
                text-decoration: underline;
            }
            .depth-indent {
                display: inline-block;
            }
            .slots {
                padding: 2px 8px 2px 40px;
                font-family: var(--gt-mono-font-family, monospace);
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .summary-bar {
                padding: 6px 8px;
                font-size: 0.9em;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
        `];$([h({attribute:!1})],m.prototype,"backend",2);$([h({attribute:!1})],m.prototype,"grammar",2);$([h({type:String,attribute:"initial-input"})],m.prototype,"initialInput",2);$([h({attribute:!1})],m.prototype,"onSourceClick",2);$([p()],m.prototype,"_input",2);$([p()],m.prototype,"_trace",2);$([p()],m.prototype,"_error",2);$([p()],m.prototype,"_loading",2);$([p()],m.prototype,"_selectedRow",2);$([p()],m.prototype,"_hoveredRow",2);$([p()],m.prototype,"_expandedRows",2);$([p()],m.prototype,"_hiddenKinds",2);m=$([D("gt-trace-timeline")],m);var pt=Object.defineProperty,ht=Object.getOwnPropertyDescriptor,W=(t,e,r,s)=>{for(var i=s>1?void 0:s?ht(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&pt(e,r,i),i};let T=class extends w{constructor(){super(...arguments),this.sortBy="hits",this._expandedRules=new Set,this._sortKey="hits"}connectedCallback(){super.connectedCallback(),this._sortKey=this.sortBy}_toggleExpand(t){const e=new Set(this._expandedRules);e.has(t)?e.delete(t):e.add(t),this._expandedRules=e}_sortedRules(){if(!this.report)return[];const t=[...this.report.perRule];switch(this._sortKey){case"hits":t.sort((e,r)=>r.hits-e.hits);break;case"name":t.sort((e,r)=>e.id.localeCompare(r.id));break;case"location":t.sort((e,r)=>{var s,i;return(((s=e.location)==null?void 0:s.range.start.line)??0)-(((i=r.location)==null?void 0:i.range.start.line)??0)});break}return t}_maxHits(){return this.report?Math.max(1,...this.report.perRule.map(t=>t.hits)):1}_heatClass(t){return t===0?"heat-zero":t>=this._maxHits()*.5?"heat-high":"heat-mid"}_pct(t,e){return e===0?"0%":Math.round(t/e*100)+"%"}render(){const t=this.report;if(!t)return n`<div class="empty-state">
                No coverage report loaded
            </div>`;const e=this._sortedRules(),r=this._maxHits();return n`
            <div class="summary-bar">
                <span>
                    Coverage:
                    <span class="stat"
                        >${t.totals.ruleHits}/${t.totals.rules} rules</span
                    >
                    (${this._pct(t.totals.ruleHits,t.totals.rules)})
                </span>
                <span>
                    <span class="stat"
                        >${t.totals.partHits}/${t.totals.parts} parts</span
                    >
                    (${this._pct(t.totals.partHits,t.totals.parts)})
                </span>
                <span>
                    Corpus:
                    ${t.unmatchedInputs.length>0?n`<span class="error-text"
                              >${t.unmatchedInputs.length} unmatched</span
                          >`:n`<span class="info-text">all matched</span>`}
                </span>
            </div>

            <table>
                <thead>
                    <tr>
                        <th
                            class="${this._sortKey==="hits"?"sorted":""}"
                            @click=${()=>{this._sortKey="hits"}}
                        >
                            Hits
                        </th>
                        <th
                            class="${this._sortKey==="name"?"sorted":""}"
                            @click=${()=>{this._sortKey="name"}}
                        >
                            Rule
                        </th>
                        <th>Parts</th>
                        <th
                            class="${this._sortKey==="location"?"sorted":""}"
                            @click=${()=>{this._sortKey="location"}}
                        >
                            Location
                        </th>
                    </tr>
                </thead>
                <tbody>
                    ${e.flatMap(s=>{const i=Math.max(2,Math.round(s.hits/r*40)),o=s.parts.filter(l=>l.hits>0).length,a=[n`<tr
                                class="rule-row ${s.hits===0?"zero-hits":""}"
                                @click=${()=>this._toggleExpand(s.id)}
                            >
                                <td>
                                    <span
                                        class="heat-bar ${this._heatClass(s.hits)}"
                                        style="width: ${i}px"
                                    ></span>
                                    ${s.hits}
                                </td>
                                <td>${s.id}</td>
                                <td>${o}/${s.parts.length}</td>
                                <td>${this._renderLocation(s.location)}</td>
                            </tr>`];if(this._expandedRules.has(s.id))for(const l of s.parts)a.push(n`<tr class="part-row">
                                        <td>${l.hits}</td>
                                        <td>${l.id}</td>
                                        <td></td>
                                        <td>
                                            ${this._renderLocation(l.location)}
                                        </td>
                                    </tr>`);return a})}
                </tbody>
            </table>

            ${t.unmatchedInputs.length>0?n`
                      <div class="unmatched-section">
                          <h3>Unmatched inputs:</h3>
                          ${t.unmatchedInputs.map(s=>n`
                                  <div class="unmatched-item">
                                      "${s.input}"
                                      ${s.reason?n`<span class="reason"
                                                >${s.reason}</span
                                            >`:d}
                                  </div>
                              `)}
                      </div>
                  `:d}
        `}_renderLocation(t){if(!t)return d;const e=`${t.displayPath}:${t.range.start.line+1}`;return this.onSourceClick?n`<span
            class="location-link"
            @click=${r=>{r.stopPropagation(),this.onSourceClick(t)}}
            >${e}</span
        >`:n`<span>${e}</span>`}};T.styles=[F,O`
            .summary-bar {
                display: flex;
                gap: 16px;
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                flex-wrap: wrap;
            }
            .summary-bar .stat {
                font-weight: bold;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.9em;
            }
            th {
                text-align: left;
                padding: 4px 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-weight: normal;
                font-size: 0.85em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                cursor: pointer;
                user-select: none;
            }
            th:hover {
                color: var(--vscode-foreground, #cccccc);
            }
            th.sorted::after {
                content: " \\25BC";
            }
            td {
                padding: 3px 8px;
                vertical-align: top;
                border-bottom: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
            }
            tr.rule-row {
                cursor: pointer;
            }
            tr.rule-row:hover td {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            tr.zero-hits td {
                opacity: 0.5;
            }

            .heat-bar {
                display: inline-block;
                height: 10px;
                min-width: 2px;
                border-radius: 2px;
                vertical-align: middle;
                margin-right: 6px;
            }
            .heat-high {
                background: #4ec9b0;
            }
            .heat-mid {
                background: var(--vscode-editorWarning-foreground, #cca700);
            }
            .heat-zero {
                background: var(--vscode-errorForeground, #f48771);
                opacity: 0.6;
            }

            .part-row td {
                padding-left: 32px;
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }

            .location-link {
                cursor: pointer;
                color: var(--vscode-textLink-foreground, #3794ff);
            }
            .location-link:hover {
                text-decoration: underline;
            }

            .unmatched-section {
                margin-top: 12px;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                padding: 8px;
            }
            .unmatched-section h3 {
                font-size: 0.9em;
                margin: 0 0 8px;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .unmatched-item {
                padding: 2px 0;
                font-family: var(--gt-mono-font-family, monospace);
                font-size: 0.85em;
            }
            .unmatched-item .reason {
                color: var(--vscode-descriptionForeground, #9d9d9d);
                margin-left: 12px;
            }
        `];W([h({attribute:!1})],T.prototype,"report",2);W([h({attribute:!1})],T.prototype,"onSourceClick",2);W([h({type:String,attribute:"sort-by"})],T.prototype,"sortBy",2);W([p()],T.prototype,"_expandedRules",2);W([p()],T.prototype,"_sortKey",2);T=W([D("gt-coverage-heatmap")],T);var ut=Object.defineProperty,ft=Object.getOwnPropertyDescriptor,H=(t,e,r,s)=>{for(var i=s>1?void 0:s?ft(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&ut(e,r,i),i};let E=class extends w{constructor(){super(...arguments),this.labelA="before",this.labelB="after",this.expandAll=!1,this._expandedRules=new Set}connectedCallback(){super.connectedCallback(),this.expandAll&&this.diff&&(this._expandedRules=new Set(this.diff.changed.map(t=>t.rule)))}_toggleExpand(t){const e=new Set(this._expandedRules);e.has(t)?e.delete(t):e.add(t),this._expandedRules=e}render(){const t=this.diff;return t?t.added.length>0||t.removed.length>0||t.changed.length>0?n`
            <div class="summary-bar">
                <span> Diff: ${this.labelA} vs ${this.labelB} </span>
                ${t.added.length>0?n`<span class="added">+${t.added.length} added</span>`:d}
                ${t.removed.length>0?n`<span class="removed"
                          >-${t.removed.length} removed</span
                      >`:d}
                ${t.changed.length>0?n`<span class="changed"
                          >~${t.changed.length} changed</span
                      >`:d}
            </div>

            ${t.added.length>0?n`
                      <div class="diff-header">Added</div>
                      ${t.added.map(r=>n`
                              <div class="rule-entry added-entry">
                                  <span class="badge">+</span>
                                  <span class="label">${r}</span>
                                  <span class="tag">(new rule)</span>
                              </div>
                          `)}
                  `:d}
            ${t.removed.length>0?n`
                      <div class="section-divider"></div>
                      <div class="diff-header">Removed</div>
                      ${t.removed.map(r=>n`
                              <div class="rule-entry removed-entry">
                                  <span class="badge">&minus;</span>
                                  <span class="label">${r}</span>
                                  <span class="tag">(removed)</span>
                              </div>
                          `)}
                  `:d}
            ${t.changed.length>0?n`
                      <div class="section-divider"></div>
                      <div class="diff-header">Changed</div>
                      ${t.changed.map(r=>n`
                              <div
                                  class="rule-entry changed-entry"
                                  @click=${()=>this._toggleExpand(r.rule)}
                              >
                                  <span class="badge">~</span>
                                  <span class="label">${r.rule}</span>
                                  <span class="tag">(${r.reason})</span>
                              </div>
                              ${this._expandedRules.has(r.rule)?n`
                                        <div class="side-by-side">
                                            <div class="pane-header">
                                                ${this.labelA}
                                            </div>
                                            <div class="pane-header">
                                                ${this.labelB}
                                            </div>
                                            <div class="side-pane before-pane">
                                                ${r.before}
                                            </div>
                                            <div class="side-pane">
                                                ${r.after}
                                            </div>
                                        </div>
                                    `:d}
                          `)}
                  `:d}
        `:n`<div class="empty-state">No differences found</div>`:n`<div class="empty-state">No diff loaded</div>`}};E.styles=[F,O`
            .summary-bar {
                display: flex;
                gap: 16px;
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .summary-bar .added {
                color: #4ec9b0;
            }
            .summary-bar .removed {
                color: var(--vscode-errorForeground, #f48771);
            }
            .summary-bar .changed {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }

            .diff-header {
                padding: 6px 8px;
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .rule-entry {
                padding: 4px 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .rule-entry:hover {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .rule-entry .badge {
                font-weight: bold;
                width: 1.5em;
                text-align: center;
            }
            .rule-entry.added-entry .badge {
                color: #4ec9b0;
            }
            .rule-entry.removed-entry .badge {
                color: var(--vscode-errorForeground, #f48771);
            }
            .rule-entry.changed-entry .badge {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }
            .rule-entry .label {
                flex: 1;
            }
            .rule-entry .tag {
                font-size: 0.8em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }

            .side-by-side {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1px;
                margin: 4px 8px 8px 24px;
                border: 1px solid var(--vscode-panel-border, #80808059);
            }
            .side-pane {
                padding: 8px;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
                font-size: 0.85em;
                white-space: pre-wrap;
                word-break: break-word;
                background: var(--vscode-editor-background, #1e1e1e);
            }
            .side-pane.before-pane {
                border-right: 1px solid var(--vscode-panel-border, #80808059);
            }
            .pane-header {
                font-size: 0.8em;
                padding: 4px 8px;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                background: var(--vscode-editorWidget-background, #252526);
            }

            .section-divider {
                border-top: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
                margin-top: 4px;
            }
        `];H([h({attribute:!1})],E.prototype,"diff",2);H([h({type:String,attribute:"label-a"})],E.prototype,"labelA",2);H([h({type:String,attribute:"label-b"})],E.prototype,"labelB",2);H([h({attribute:!1})],E.prototype,"onSourceClick",2);H([h({type:Boolean,attribute:"expand-all"})],E.prototype,"expandAll",2);H([p()],E.prototype,"_expandedRules",2);E=H([D("gt-diff-view")],E);var gt=Object.defineProperty,vt=Object.getOwnPropertyDescriptor,b=(t,e,r,s)=>{for(var i=s>1?void 0:s?vt(e,r):e,o=t.length-1,a;o>=0;o--)(a=t[o])&&(i=(s?a(e,r,i):a(i))||i);return s&&i&&gt(e,r,i),i};let v=class extends w{constructor(){super(...arguments),this.agents=[],this.liveAvailable=!1,this.enabledTabs=["completions","trace","coverage","diff"],this._activeTab="completions",this._corpusText="",this._coverageLoading=!1,this._diffBeforePath="",this._diffLoading=!1}_onGrammarLoaded(t){t.ok&&(this._grammar=t.grammar,this._coverageReport=void 0,this._diffResult=void 0)}async _runCoverage(){if(!this.backend||!this._grammar||!this._corpusText)return;const t=this._corpusText.split(`
`).map(e=>e.trim()).filter(e=>e.length>0);if(t.length!==0){this._coverageLoading=!0;try{this._coverageReport=await this.backend.computeCoverage(this._grammar,t)}catch{this._coverageReport=void 0}finally{this._coverageLoading=!1}}}async _runDiff(){if(!(!this.backend||!this._grammar||!this._diffBeforePath)){this._diffLoading=!0;try{const t=await this.backend.loadGrammarFromFile(this._diffBeforePath);t.ok&&(this._diffResult=await this.backend.diffGrammars(t.grammar,this._grammar))}catch{this._diffResult=void 0}finally{this._diffLoading=!1}}}render(){const t=this.enabledTabs;return!t.includes(this._activeTab)&&t.length>0&&(this._activeTab=t[0]),n`
            <div class="panel">
                <div class="picker-section">
                    <gt-source-view
                        .backend=${this.backend}
                        .agents=${this.agents}
                        ?live-available=${this.liveAvailable}
                        .onLoad=${e=>this._onGrammarLoaded(e)}
                    ></gt-source-view>
                </div>

                <div class="tab-bar">
                    ${t.map(e=>n`
                            <button
                                class="tab ${this._activeTab===e?"active":""}"
                                @click=${()=>{this._activeTab=e}}
                            >
                                ${this._tabLabel(e)}
                            </button>
                        `)}
                </div>

                <div class="tab-content">${this._renderActiveTab()}</div>
            </div>
        `}_tabLabel(t){switch(t){case"completions":return"Completions";case"trace":return"Trace";case"coverage":return"Coverage";case"diff":return"Diff"}}_renderActiveTab(){if(!this._grammar)return n`<div class="notice">
                Load a grammar to get started
            </div>`;switch(this._activeTab){case"completions":return n`<gt-completion-panel
                    .backend=${this.backend}
                    .grammar=${this._grammar}
                ></gt-completion-panel>`;case"trace":return this._grammar.debugInfo?n`<gt-trace-timeline
                    .backend=${this.backend}
                    .grammar=${this._grammar}
                    .onSourceClick=${this.onSourceClick}
                ></gt-trace-timeline>`:n`<div class="notice">
                        Debug info not available for this grammar source. Load
                        from file or agent for full trace.
                    </div>`;case"coverage":return n`
                    <div class="corpus-input">
                        <textarea
                            placeholder="Paste corpus inputs, one per line..."
                            .value=${this._corpusText}
                            @input=${t=>{this._corpusText=t.target.value}}
                        ></textarea>
                        <div class="corpus-actions">
                            <button
                                @click=${this._runCoverage}
                                ?disabled=${this._coverageLoading||!this._corpusText}
                            >
                                Run Coverage
                            </button>
                            ${this._coverageLoading?n`<span class="muted">Computing...</span>`:d}
                        </div>
                    </div>
                    <gt-coverage-heatmap
                        .report=${this._coverageReport}
                        .onSourceClick=${this.onSourceClick}
                    ></gt-coverage-heatmap>
                `;case"diff":return n`
                    <div class="diff-pickers">
                        <span class="muted">Before:</span>
                        <input
                            type="text"
                            placeholder="Path to earlier grammar..."
                            .value=${this._diffBeforePath}
                            @input=${t=>{this._diffBeforePath=t.target.value}}
                        />
                        <span class="muted">After: current</span>
                        <button
                            @click=${this._runDiff}
                            ?disabled=${this._diffLoading||!this._diffBeforePath}
                        >
                            Diff
                        </button>
                        ${this._diffLoading?n`<span class="muted">Computing...</span>`:d}
                    </div>
                    <gt-diff-view
                        .diff=${this._diffResult}
                        .onSourceClick=${this.onSourceClick}
                    ></gt-diff-view>
                `}}};v.styles=[F,O`
            .panel {
                display: flex;
                flex-direction: column;
                height: 100%;
            }

            .picker-section {
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }

            .tab-bar {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .tab {
                padding: 8px 16px;
                cursor: pointer;
                border: none;
                background: transparent;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-size: inherit;
                font-family: inherit;
                border-bottom: 2px solid transparent;
            }
            .tab:hover {
                color: var(--vscode-foreground, #cccccc);
            }
            .tab.active {
                color: var(--vscode-foreground, #cccccc);
                border-bottom-color: var(--vscode-focusBorder, #007fd4);
            }

            .tab-content {
                flex: 1;
                overflow: auto;
                padding: 8px;
            }

            .corpus-input {
                margin-bottom: 8px;
            }
            .corpus-input textarea {
                width: 100%;
                min-height: 60px;
                resize: vertical;
            }
            .corpus-actions {
                display: flex;
                gap: 8px;
                margin-top: 4px;
            }

            .diff-pickers {
                display: flex;
                gap: 8px;
                align-items: center;
                margin-bottom: 8px;
                flex-wrap: wrap;
            }
            .diff-pickers input {
                flex: 1;
                min-width: 150px;
            }

            .notice {
                padding: 12px;
                text-align: center;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-style: italic;
            }
        `];b([h({attribute:!1})],v.prototype,"backend",2);b([h({type:Array})],v.prototype,"agents",2);b([h({type:Boolean,attribute:"live-available"})],v.prototype,"liveAvailable",2);b([h({type:Array,attribute:"enabled-tabs"})],v.prototype,"enabledTabs",2);b([h({attribute:!1})],v.prototype,"onSourceClick",2);b([p()],v.prototype,"_grammar",2);b([p()],v.prototype,"_activeTab",2);b([p()],v.prototype,"_corpusText",2);b([p()],v.prototype,"_coverageReport",2);b([p()],v.prototype,"_coverageLoading",2);b([p()],v.prototype,"_diffBeforePath",2);b([p()],v.prototype,"_diffResult",2);b([p()],v.prototype,"_diffLoading",2);v=b([D("gt-debug-panel")],v);const C={debugInfo:{rules:new Map([["Start",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:0,character:0,offset:0},end:{line:0,character:40,offset:40}}}],["PlayAction",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:3,character:0,offset:60},end:{line:5,character:30,offset:150}}}],["ArtistRef",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:11,character:0,offset:200},end:{line:13,character:20,offset:260}}}],["AlbumRef",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:17,character:0,offset:300},end:{line:19,character:25,offset:370}}}],["ShuffleAction",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:24,character:0,offset:400},end:{line:25,character:20,offset:440}}}],["QueueAction",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:29,character:0,offset:500},end:{line:32,character:25,offset:590}}}],["SkipAction",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:37,character:0,offset:650},end:{line:37,character:30,offset:680}}}],["PauseAction",{fileId:"player.agr",displayPath:"player.agr",range:{start:{line:40,character:0,offset:720},end:{line:40,character:30,offset:750}}}]])}};C.debugInfo.rules.get("Start"),C.debugInfo.rules.get("PlayAction"),C.debugInfo.rules.get("ArtistRef"),C.debugInfo.rules.get("AlbumRef"),C.debugInfo.rules.get("ShuffleAction"),C.debugInfo.rules.get("QueueAction"),C.debugInfo.rules.get("SkipAction"),C.debugInfo.rules.get("PauseAction");const mt=acquireVsCodeApi();let _t=1;const pe=new Map;window.addEventListener("message",t=>{const e=t.data;if(e.id==null)return;const r=pe.get(e.id);r&&(pe.delete(e.id),e.error?r.reject(new Error(e.error)):r.resolve(e.result))});function A(t,...e){return new Promise((r,s)=>{const i=_t++;pe.set(i,{resolve:r,reject:s});const o={id:i,method:t,params:e};mt.postMessage(o)})}function te(t){const e=t.debugInfo?{grammarHash:t.debugInfo.grammarHash,rules:new Map(t.debugInfo.rules),parts:new Map(t.debugInfo.parts)}:void 0,r={...t.identifiers,ruleIndex:new Map(t.identifiers.ruleIds.map((i,o)=>[i,o]))},s={source:t.source,grammar:{__handle:t.handle},debugInfo:e,files:t.files,identifiers:r};return s.__handle=t.handle,{ok:!0,grammar:s,diagnostics:t.diagnostics}}function U(t){const e=t.__handle;if(!e)throw new Error("Grammar has no RPC handle");return e}class bt{async loadGrammarFromFile(e){const r=await A("loadGrammarFromFile",e);return r.ok?te(r):r}async loadGrammarFromBuffer(e,r){const s=await A("loadGrammarFromBuffer",e,r);return s.ok?te(s):s}async loadGrammarFromAgent(e){const r=await A("loadGrammarFromAgent",e);return r.ok?te(r):r}async loadGrammarFromSnapshot(e){return{ok:!1,diagnostics:[{range:{start:{line:0,character:0,offset:0},end:{line:0,character:0,offset:0}},severity:"error",message:"Snapshot loading not supported in VS Code",source:"grammar-tools-core"}],files:[]}}async loadGrammarFromActiveEditor(){const e=await A("loadGrammarFromActiveEditor");return e.ok?te(e):e}async previewCompletion(e,r){return await A("previewCompletion",U(e),r)}async traceMatch(e,r){return await A("traceMatch",U(e),r)}async computeCoverage(e,r){return await A("computeCoverage",U(e),r)}async diffGrammars(e,r){return await A("diffGrammars",U(e),U(r))}async format(e){return await A("format",U(e))}async listAgents(){return await A("listAgents")}}const Ce=new bt;customElements.whenDefined("gt-debug-panel").then(()=>{const t=document.getElementById("panel");t&&(t.backend=Ce,Ce.loadGrammarFromActiveEditor().then(e=>{e.ok&&(t.grammar=e.grammar)}))});
//# sourceMappingURL=debugPanel.js.map
