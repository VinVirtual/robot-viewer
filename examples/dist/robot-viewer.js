/* robot-viewer (MIT). https://github.com/VinVirtual/robot-viewer . Licence texts: robot-viewer-licenses.txt */
var u=`/* <robot-viewer> styles. Every colour, size and timing is a custom property on :host, so a site can
   restyle the component from outside: robot-viewer { --rv-accent: #0a7; }  */
:host {
  --rv-surface: oklch(98.4% 0.005 85);
  --rv-stage: oklch(95.6% 0.007 85);
  --rv-stage-glow: oklch(99.5% 0.003 85);
  --rv-ink: oklch(23% 0.012 255);
  --rv-muted: oklch(50% 0.012 255);
  --rv-line: oklch(87% 0.008 85);
  --rv-accent: oklch(63% 0.19 38);
  --rv-accent-ink: oklch(99% 0.01 85);
  --rv-warn: oklch(64% 0.15 70);
  --rv-grid: oklch(80% 0.01 85);
  --rv-shadow: 0.22;
  --rv-radius-frame: 14px;
  --rv-radius-control: 6px;
  --rv-panel-width: 288px;
  --rv-aspect: 4 / 3;
  --rv-font: inherit;
  --rv-mono: ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --rv-fast: 140ms;
  --rv-slow: 520ms;
  --rv-ease: cubic-bezier(0.16, 1, 0.3, 1);
  display: block;
  position: relative;
  container-type: inline-size;
  color: var(--rv-ink);
  font: var(--rv-font);
  contain: layout paint;
}
:host([hidden]) { display: none; }

:host([theme="dark"]) {
  --rv-surface: oklch(19.5% 0.012 255);
  --rv-stage: oklch(16.5% 0.012 255);
  --rv-stage-glow: oklch(25% 0.016 255);
  --rv-ink: oklch(94% 0.006 85);
  --rv-muted: oklch(70% 0.01 255);
  --rv-line: oklch(31% 0.012 255);
  --rv-accent: oklch(72% 0.17 45);
  --rv-accent-ink: oklch(18% 0.02 45);
  --rv-warn: oklch(80% 0.14 80);
  --rv-grid: oklch(36% 0.012 255);
  --rv-shadow: 0.5;
}
@media (prefers-color-scheme: dark) {
  :host(:not([theme="light"])) {
    --rv-surface: oklch(19.5% 0.012 255);
    --rv-stage: oklch(16.5% 0.012 255);
    --rv-stage-glow: oklch(25% 0.016 255);
    --rv-ink: oklch(94% 0.006 85);
    --rv-muted: oklch(70% 0.01 255);
    --rv-line: oklch(31% 0.012 255);
    --rv-accent: oklch(72% 0.17 45);
    --rv-accent-ink: oklch(18% 0.02 45);
    --rv-warn: oklch(80% 0.14 80);
    --rv-grid: oklch(36% 0.012 255);
    --rv-shadow: 0.5;
  }
}

.frame {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: var(--rv-surface);
  border: 1px solid var(--rv-line);
  border-radius: var(--rv-radius-frame);
  overflow: hidden;
  height: 100%;
}
:host([controls="none"]) .frame { border: 0; background: transparent; border-radius: 0; }

.stage {
  position: relative;
  aspect-ratio: var(--rv-aspect);
  min-height: 0;
  background: radial-gradient(120% 90% at 50% 38%, var(--rv-stage-glow), var(--rv-stage) 70%);
  overflow: hidden;
  isolation: isolate;
}
:host([controls="none"]) .stage { background: transparent; }
.stage canvas {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  opacity: 0; transition: opacity var(--rv-slow) var(--rv-ease);
  touch-action: pan-y; outline: none;
}
.stage canvas.shown { opacity: 1; }
.stage canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--rv-accent); }
.stage canvas.grab { cursor: grab; }
.stage canvas.grabbing { cursor: grabbing; }

.poster {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;
  transition: opacity var(--rv-slow) var(--rv-ease);
  user-select: none;
}
.poster.gone { opacity: 0; }

.status {
  position: absolute; left: 14px; bottom: 12px; right: 14px; margin: 0; z-index: 2;
  font: 500 12px/1.35 var(--rv-mono); letter-spacing: 0.01em; color: var(--rv-muted);
  pointer-events: none;
}
.status:empty { display: none; }

.start, .ar, .pose, .reset {
  font: 600 12px/1 var(--rv-mono); letter-spacing: 0.04em; text-transform: uppercase;
  border-radius: var(--rv-radius-control); cursor: pointer;
  transition: background-color var(--rv-fast) ease, color var(--rv-fast) ease, border-color var(--rv-fast) ease, transform var(--rv-fast) ease;
}
.start {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3;
  padding: 12px 18px; border: 0; background: var(--rv-ink); color: var(--rv-surface);
  box-shadow: 0 10px 30px -12px rgb(0 0 0 / 0.45);
}
.start:hover { background: var(--rv-accent); color: var(--rv-accent-ink); }
.start:active { transform: translate(-50%, calc(-50% + 1px)); }
.start[hidden], .ar[hidden] { display: none; }

.ar {
  position: absolute; right: 12px; top: 12px; z-index: 3; display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 12px; text-decoration: none;
  background: color-mix(in oklab, var(--rv-surface) 86%, transparent); color: var(--rv-ink);
  border: 1px solid var(--rv-line); backdrop-filter: blur(8px);
}
.ar::before { content: ""; width: 8px; height: 8px; border: 1.5px solid currentColor; transform: rotate(45deg); }
.ar:hover { border-color: var(--rv-ink); }
.ar-img { position: absolute; width: 0; height: 0; }

/* ---------- panel ---------- */
.panel {
  display: flex; flex-direction: column; gap: 18px;
  padding: 18px 18px 20px;
  border-top: 1px solid var(--rv-line);
  min-width: 0;
}
.panel[hidden] { display: none; }
@container (min-width: 760px) {
  .frame:has(.panel:not([hidden])) {
    grid-template-columns: minmax(0, 1fr) var(--rv-panel-width);
    grid-template-rows: minmax(0, 1fr);
    aspect-ratio: var(--rv-aspect-wide, 16 / 9);
  }
  .frame:has(.panel:not([hidden])) .stage { aspect-ratio: auto; min-height: 100%; }
  .panel { border-top: 0; border-left: 1px solid var(--rv-line); min-height: 0; overflow: auto; overscroll-behavior: contain; }
}

.heading {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  font: 600 11px/1 var(--rv-mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--rv-muted);
  margin: 0;
}
.heading b { font-weight: 600; color: var(--rv-ink); letter-spacing: 0.04em; }

.poses { display: flex; flex-wrap: wrap; gap: 6px; }
.pose {
  padding: 8px 10px; background: transparent; color: var(--rv-ink); border: 1px solid var(--rv-line);
  text-transform: none; letter-spacing: 0.01em; font-weight: 500;
}
.pose:hover { border-color: var(--rv-ink); }
.pose:active { transform: translateY(1px); }
.pose[aria-pressed="true"] { background: var(--rv-ink); color: var(--rv-surface); border-color: var(--rv-ink); }
.pose:focus-visible, .reset:focus-visible, .start:focus-visible, .ar:focus-visible { outline: 2px solid var(--rv-accent); outline-offset: 2px; }

.joints { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; border: 0; }
.joint { display: grid; grid-template-columns: 1fr auto; align-items: baseline; row-gap: 4px; column-gap: 10px; }
.joint label {
  font: 500 11px/1.2 var(--rv-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--rv-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.joint output {
  font: 600 15px/1 var(--rv-mono); font-variant-numeric: tabular-nums; color: var(--rv-ink);
  transition: color var(--rv-fast) ease;
}
.joint.near output { color: var(--rv-warn); }
.joint.near output::after { content: " ◆"; font-size: 9px; vertical-align: 2px; }
.joint .limits {
  grid-column: 1 / -1; display: flex; justify-content: space-between;
  font: 500 10px/1 var(--rv-mono); color: var(--rv-muted); font-variant-numeric: tabular-nums; opacity: 0.85;
}

/* the slider: a hairline track, a filled run from zero to the value, a fader-cap thumb */
.joint input[type="range"] {
  --from: 50%; --to: 50%;
  grid-column: 1 / -1; width: 100%; height: 26px; margin: 0; background: transparent; cursor: pointer;
  -webkit-appearance: none; appearance: none;
}
.joint input[type="range"]::-webkit-slider-runnable-track {
  height: 2px; border-radius: 1px;
  background: linear-gradient(to right, var(--rv-line) var(--from), var(--rv-accent) var(--from), var(--rv-accent) var(--to), var(--rv-line) var(--to));
}
.joint input[type="range"]::-moz-range-track {
  height: 2px; border-radius: 1px;
  background: linear-gradient(to right, var(--rv-line) var(--from), var(--rv-accent) var(--from), var(--rv-accent) var(--to), var(--rv-line) var(--to));
}
.joint input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 8px; height: 20px; margin-top: -9px;
  border-radius: 2px; background: var(--rv-ink); border: 2px solid var(--rv-surface);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); transition: transform var(--rv-fast) ease, background-color var(--rv-fast) ease;
}
.joint input[type="range"]::-moz-range-thumb {
  width: 8px; height: 20px; border-radius: 2px; background: var(--rv-ink); border: 2px solid var(--rv-surface);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
}
.joint input[type="range"]:hover::-webkit-slider-thumb { transform: scaleY(1.12); }
.joint input[type="range"]:active::-webkit-slider-thumb { background: var(--rv-accent); }
.joint input[type="range"]:focus-visible { outline: none; }
.joint input[type="range"]:focus-visible::-webkit-slider-thumb { background: var(--rv-accent); box-shadow: 0 0 0 3px color-mix(in oklab, var(--rv-accent) 35%, transparent); }
.joint input[type="range"]:focus-visible::-moz-range-thumb { background: var(--rv-accent); }
.joint.mimic { opacity: 0.6; }

.foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: auto; }
.hint { margin: 0; font: 400 11px/1.4 var(--rv-mono); color: var(--rv-muted); }
.reset { padding: 7px 10px; background: transparent; color: var(--rv-muted); border: 1px solid transparent; }
.reset:hover { color: var(--rv-ink); border-color: var(--rv-line); }

.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .stage canvas, .poster, .start, .pose, .reset, .ar, .joint output { transition: none; }
}
`;function g({glb:s=null,usdz:t=null,base:e,userAgent:r="",supportsRelAr:a=!1,title:n=""}={}){var d;let l=i=>{try{return new URL(i,e)}catch{return null}},f=i=>i&&(i.protocol==="https:"||i.protocol==="http:")?i:null;if(t&&a){let i=f(l(t));if(i)return{mode:"quicklook",href:i.href}}if(s&&/Android/i.test(r)&&!/Instagram|FBAN|FBAV/i.test(r)){let i=((d=l(s))==null?void 0:d.protocol)==="https:"?l(s):null;if(i){let v=new URLSearchParams({file:i.href,mode:"ar_preferred"});n&&v.set("title",n);let p=l(""),m=p&&p.protocol==="https:"?p.href:i.href;return{mode:"sceneviewer",href:`intent://arvr.google.com/scene-viewer/1.0?${v}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(m)};end;`}}}return{mode:"none",href:null}}var _=new URL("./robot-viewer-engine.js",import.meta.url).href,k=new URL("./robot-viewer.css",import.meta.url).href,c=null,o=(s,t={},e=[])=>{let r=document.createElement(s);for(let[a,n]of Object.entries(t))a==="class"?r.className=n:a==="text"?r.textContent=n:a.startsWith("aria-")||a==="role"||a==="part"||a==="for"||a==="tabindex"?r.setAttribute(a,n):r[a]=n;for(let a of e)r.append(a);return r};function w(){try{let s=document.createElement("canvas");return!!(s.getContext("webgl2")||s.getContext("webgl"))}catch{return!1}}var b=()=>typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches,h=class extends HTMLElement{static get observedAttributes(){return["src","poster","alt","pose","theme","controls","ik","grid","ar-glb","ar-usdz"]}constructor(){super(),this._root=this.attachShadow({mode:"open"}),this._engine=null,this._state="idle",this._observer=null}connectedCallback(){this._built||this._build(),this._updateAr(),this._start.hidden=!0,this._state==="idle"&&(this.getAttribute("loading")==="eager"?this.activate("eager"):b()?this._offerStart("Motion is reduced on this device. The 3D view opens only when you ask."):this._observe())}disconnectedCallback(){this._teardown()}_teardown(){var t;(t=this._observer)==null||t.disconnect(),this._observer=null,this._gen=(this._gen||0)+1,this._engine&&(this._engine.dispose(),this._engine=null),this._state="idle",this._ready=null,this.removeAttribute("aria-busy"),this._status&&this._say("")}attributeChangedCallback(t,e,r){var a;if(!(!this._built||e===r)){if(t==="poster"&&this._setPoster(),t==="alt"&&(this._poster.alt=r||"",this._stage.setAttribute("aria-label",r||"Robot model")),(t==="ar-glb"||t==="ar-usdz")&&this._updateAr(),(t==="src"||t==="controls"||t==="ik")&&this._state!=="idle"){this._teardown(),this.isConnected&&this.activate("attribute");return}(a=this._engine)==null||a.attributeChanged(t,r)}}_build(){this._built=!0,"adoptedStyleSheets"in this._root&&typeof CSSStyleSheet=="function"&&"replaceSync"in CSSStyleSheet.prototype?(c||(c=new CSSStyleSheet,c.replaceSync(u)),this._root.adoptedStyleSheets=[c]):this._root.append(o("link",{rel:"stylesheet",href:k})),this._poster=o("img",{class:"poster",part:"poster",alt:this.getAttribute("alt")||"",decoding:"async",draggable:!1}),this._status=o("p",{class:"status",part:"status",role:"status","aria-live":"polite"}),this._start=o("button",{class:"start",part:"start-button",type:"button",text:"Open 3D view",hidden:!0}),this._start.addEventListener("click",()=>this.activate("button")),this._ar=o("a",{class:"ar",part:"ar-button",hidden:!0},[o("img",{alt:"",class:"ar-img"}),o("span",{text:"View in your room"})]),this._stage=o("div",{class:"stage",part:"stage",role:"group","aria-label":this.getAttribute("alt")||"Robot model"},[this._poster,this._status,this._start,this._ar]),this._panel=o("div",{class:"panel",part:"panel",hidden:!0}),this._frame=o("div",{class:"frame",part:"frame"},[this._stage,this._panel]),this._root.append(this._frame),this._setPoster()}_setPoster(){let t=this.getAttribute("poster");t?(this._poster.src=t,this._poster.hidden=!1):(this._poster.removeAttribute("src"),this._poster.hidden=!0)}_updateAr(){let t=document.createElement("a"),e=g({glb:this.getAttribute("ar-glb"),usdz:this.getAttribute("ar-usdz"),base:document.baseURI,userAgent:navigator.userAgent,supportsRelAr:!!(t.relList&&t.relList.supports&&t.relList.supports("ar")),title:this.getAttribute("alt")||""});if(this._ar.hidden=e.mode==="none",e.mode==="none"){this._ar.removeAttribute("href"),this._ar.removeAttribute("rel");return}this._ar.href=e.href,e.mode==="quicklook"?this._ar.setAttribute("rel","ar"):this._ar.removeAttribute("rel")}_say(t){this._status.textContent=t}_offerStart(t){this._say(t),this._start.hidden=!1}_observe(){if(typeof IntersectionObserver!="function"){this.activate("no-observer");return}this._observer=new IntersectionObserver(t=>{t.some(e=>e.isIntersecting)&&(this._observer.disconnect(),this._observer=null,this.activate("visible"))},{rootMargin:"200px 0px"}),this._observer.observe(this)}async activate(t="api"){if(this._state!=="idle")return this._ready;this._state="loading",this._start.hidden=!0;let e=this._gen||0;return this._ready=(async()=>{if(!w()){this._state="still",this._say("3D needs WebGL, which this browser has turned off. Showing a still image."),this.dispatchEvent(new CustomEvent("fallback",{detail:{reason:"no-webgl"}}));return}if(!this.getAttribute("src")){this._state="error",this._say("No robot file given (set the src attribute).");return}this._say("Loading the 3D model…"),this.setAttribute("aria-busy","true");try{let a=await(await import(_)).mount(this,{stage:this._stage,panel:this._panel,poster:this._poster,status:this._status,reducedMotion:b(),reason:t});if(e!==(this._gen||0)||!this.isConnected){a.dispose();return}this._engine=a,this._state="ready",this._say("")}catch(r){if(e!==(this._gen||0))return;this._state="error",this._say("The 3D model could not be loaded. Showing a still image."),this.dispatchEvent(new CustomEvent("error",{detail:{message:String(r&&r.message||r)}}))}finally{e===(this._gen||0)&&this.removeAttribute("aria-busy")}})(),this._ready}get joints(){return this._engine?this._engine.joints():[]}get poses(){return this._engine?this._engine.poseNames():[]}get values(){return this._engine?this._engine.values():{}}setJoint(t,e){var r;(r=this._engine)==null||r.setJoint(t,e)}setJoints(t){var e;(e=this._engine)==null||e.setJoints(t)}fitView(t){var e;(e=this._engine)==null||e.fitView(t)}linkScreenPoint(t,e){return this._engine?this._engine.linkScreenPoint(t,e):null}goToPose(t,e){return this._engine?this._engine.goToPose(t,e):Promise.resolve(!1)}};typeof customElements<"u"&&!customElements.get("robot-viewer")&&customElements.define("robot-viewer",h);export{h as RobotViewerElement,w as webglAvailable};
