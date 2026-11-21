"use strict";(()=>{var Z=globalThis,D=e=>e,q=Z.trustedTypes,O=q?q.createPolicy("lit-html",{createHTML:e=>e}):void 0,G="$lit$",g=`lit$${Math.random().toFixed(9).slice(2)}$`,X="?"+g,pt=`<${X}>`,y=document,_=()=>y.createComment(""),k=e=>e===null||typeof e!="object"&&typeof e!="function",B=Array.isArray,ct=e=>B(e)||typeof e?.[Symbol.iterator]=="function",R=`[ 	
\f\r]`,A=/<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,L=/-->/g,Q=/>/g,u=RegExp(`>|${R}(?:([^\\s"'>=/]+)(${R}*=${R}*(?:[^ 	
\f\r"'\`<>=]|("|')|))|$)`,"g"),V=/'/g,W=/"/g,J=/^(?:script|style|textarea|title)$/i,P=e=>(t,...o)=>({_$litType$:e,strings:t,values:o}),c=P(1),K=P(2),ut=P(3),T=Symbol.for("lit-noChange"),p=Symbol.for("lit-nothing"),F=new WeakMap,v=y.createTreeWalker(y,129);function Y(e,t){if(!B(e)||!e.hasOwnProperty("raw"))throw Error("invalid template strings array");return O!==void 0?O.createHTML(t):t}var dt=(e,t)=>{let o=e.length-1,r=[],i,s=t===2?"<svg>":t===3?"<math>":"",a=A;for(let h=0;h<o;h++){let n=e[h],d,x,l=-1,f=0;for(;f<n.length&&(a.lastIndex=f,x=a.exec(n),x!==null);)f=a.lastIndex,a===A?x[1]==="!--"?a=L:x[1]!==void 0?a=Q:x[2]!==void 0?(J.test(x[2])&&(i=RegExp("</"+x[2],"g")),a=u):x[3]!==void 0&&(a=u):a===u?x[0]===">"?(a=i??A,l=-1):x[1]===void 0?l=-2:(l=a.lastIndex-x[2].length,d=x[1],a=x[3]===void 0?u:x[3]==='"'?W:V):a===W||a===V?a=u:a===L||a===Q?a=A:(a=u,i=void 0);let m=a===u&&e[h+1].startsWith("/>")?" ":"";s+=a===A?n+pt:l>=0?(r.push(d),n.slice(0,l)+G+n.slice(l)+g+m):n+g+(l===-2?h:m)}return[Y(e,s+(e[o]||"<?>")+(t===2?"</svg>":t===3?"</math>":"")),r]},S=class e{constructor({strings:t,_$litType$:o},r){let i;this.parts=[];let s=0,a=0,h=t.length-1,n=this.parts,[d,x]=dt(t,o);if(this.el=e.createElement(d,r),v.currentNode=this.el.content,o===2||o===3){let l=this.el.content.firstChild;l.replaceWith(...l.childNodes)}for(;(i=v.nextNode())!==null&&n.length<h;){if(i.nodeType===1){if(i.hasAttributes())for(let l of i.getAttributeNames())if(l.endsWith(G)){let f=x[a++],m=i.getAttribute(l).split(g),I=/([.?@])?(.*)/.exec(f);n.push({type:1,index:s,name:I[2],strings:m,ctor:I[1]==="."?U:I[1]==="?"?M:I[1]==="@"?z:w}),i.removeAttribute(l)}else l.startsWith(g)&&(n.push({type:6,index:s}),i.removeAttribute(l));if(J.test(i.tagName)){let l=i.textContent.split(g),f=l.length-1;if(f>0){i.textContent=q?q.emptyScript:"";for(let m=0;m<f;m++)i.append(l[m],_()),v.nextNode(),n.push({type:2,index:++s});i.append(l[f],_())}}}else if(i.nodeType===8)if(i.data===X)n.push({type:2,index:s});else{let l=-1;for(;(l=i.data.indexOf(g,l+1))!==-1;)n.push({type:7,index:s}),l+=g.length-1}s++}}static createElement(t,o){let r=y.createElement("template");return r.innerHTML=t,r}};function $(e,t,o=e,r){if(t===T)return t;let i=r!==void 0?o._$Co?.[r]:o._$Cl,s=k(t)?void 0:t._$litDirective$;return i?.constructor!==s&&(i?._$AO?.(!1),s===void 0?i=void 0:(i=new s(e),i._$AT(e,o,r)),r!==void 0?(o._$Co??=[])[r]=i:o._$Cl=i),i!==void 0&&(t=$(e,i._$AS(e,t.values),i,r)),t}var C=class{constructor(t,o){this._$AV=[],this._$AN=void 0,this._$AD=t,this._$AM=o}get parentNode(){return this._$AM.parentNode}get _$AU(){return this._$AM._$AU}u(t){let{el:{content:o},parts:r}=this._$AD,i=(t?.creationScope??y).importNode(o,!0);v.currentNode=i;let s=v.nextNode(),a=0,h=0,n=r[0];for(;n!==void 0;){if(a===n.index){let d;n.type===2?d=new H(s,s.nextSibling,this,t):n.type===1?d=new n.ctor(s,n.name,n.strings,this,t):n.type===6&&(d=new E(s,this,t)),this._$AV.push(d),n=r[++h]}a!==n?.index&&(s=v.nextNode(),a++)}return v.currentNode=y,i}p(t){let o=0;for(let r of this._$AV)r!==void 0&&(r.strings!==void 0?(r._$AI(t,r,o),o+=r.strings.length-2):r._$AI(t[o])),o++}},H=class e{get _$AU(){return this._$AM?._$AU??this._$Cv}constructor(t,o,r,i){this.type=2,this._$AH=p,this._$AN=void 0,this._$AA=t,this._$AB=o,this._$AM=r,this.options=i,this._$Cv=i?.isConnected??!0}get parentNode(){let t=this._$AA.parentNode,o=this._$AM;return o!==void 0&&t?.nodeType===11&&(t=o.parentNode),t}get startNode(){return this._$AA}get endNode(){return this._$AB}_$AI(t,o=this){t=$(this,t,o),k(t)?t===p||t==null||t===""?(this._$AH!==p&&this._$AR(),this._$AH=p):t!==this._$AH&&t!==T&&this._(t):t._$litType$!==void 0?this.$(t):t.nodeType!==void 0?this.T(t):ct(t)?this.k(t):this._(t)}O(t){return this._$AA.parentNode.insertBefore(t,this._$AB)}T(t){this._$AH!==t&&(this._$AR(),this._$AH=this.O(t))}_(t){this._$AH!==p&&k(this._$AH)?this._$AA.nextSibling.data=t:this.T(y.createTextNode(t)),this._$AH=t}$(t){let{values:o,_$litType$:r}=t,i=typeof r=="number"?this._$AC(t):(r.el===void 0&&(r.el=S.createElement(Y(r.h,r.h[0]),this.options)),r);if(this._$AH?._$AD===i)this._$AH.p(o);else{let s=new C(i,this),a=s.u(this.options);s.p(o),this.T(a),this._$AH=s}}_$AC(t){let o=F.get(t.strings);return o===void 0&&F.set(t.strings,o=new S(t)),o}k(t){B(this._$AH)||(this._$AH=[],this._$AR());let o=this._$AH,r,i=0;for(let s of t)i===o.length?o.push(r=new e(this.O(_()),this.O(_()),this,this.options)):r=o[i],r._$AI(s),i++;i<o.length&&(this._$AR(r&&r._$AB.nextSibling,i),o.length=i)}_$AR(t=this._$AA.nextSibling,o){for(this._$AP?.(!1,!0,o);t!==this._$AB;){let r=D(t).nextSibling;D(t).remove(),t=r}}setConnected(t){this._$AM===void 0&&(this._$Cv=t,this._$AP?.(t))}},w=class{get tagName(){return this.element.tagName}get _$AU(){return this._$AM._$AU}constructor(t,o,r,i,s){this.type=1,this._$AH=p,this._$AN=void 0,this.element=t,this.name=o,this._$AM=i,this.options=s,r.length>2||r[0]!==""||r[1]!==""?(this._$AH=Array(r.length-1).fill(new String),this.strings=r):this._$AH=p}_$AI(t,o=this,r,i){let s=this.strings,a=!1;if(s===void 0)t=$(this,t,o,0),a=!k(t)||t!==this._$AH&&t!==T,a&&(this._$AH=t);else{let h=t,n,d;for(t=s[0],n=0;n<s.length-1;n++)d=$(this,h[r+n],o,n),d===T&&(d=this._$AH[n]),a||=!k(d)||d!==this._$AH[n],d===p?t=p:t!==p&&(t+=(d??"")+s[n+1]),this._$AH[n]=d}a&&!i&&this.j(t)}j(t){t===p?this.element.removeAttribute(this.name):this.element.setAttribute(this.name,t??"")}},U=class extends w{constructor(){super(...arguments),this.type=3}j(t){this.element[this.name]=t===p?void 0:t}},M=class extends w{constructor(){super(...arguments),this.type=4}j(t){this.element.toggleAttribute(this.name,!!t&&t!==p)}},z=class extends w{constructor(t,o,r,i,s){super(t,o,r,i,s),this.type=5}_$AI(t,o=this){if((t=$(this,t,o,0)??p)===T)return;let r=this._$AH,i=t===p&&r!==p||t.capture!==r.capture||t.once!==r.once||t.passive!==r.passive,s=t!==p&&(r===p||i);i&&this.element.removeEventListener(this.name,this,r),s&&this.element.addEventListener(this.name,this,t),this._$AH=t}handleEvent(t){typeof this._$AH=="function"?this._$AH.call(this.options?.host??this.element,t):this._$AH.handleEvent(t)}},E=class{constructor(t,o,r){this.element=t,this.type=6,this._$AN=void 0,this._$AM=o,this.options=r}get _$AU(){return this._$AM._$AU}_$AI(t){$(this,t)}};var xt=Z.litHtmlPolyfillSupport;xt?.(S,H),(Z.litHtmlVersions??=[]).push("3.3.3");var tt=(e,t,o)=>{let r=o?.renderBefore??t,i=r._$litPart$;if(i===void 0){let s=o?.renderBefore??null;r._$litPart$=i=new H(t.insertBefore(_(),s),s,void 0,o??{})}return i._$AI(e),i};var N={crop_square:"M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0 0v-600 600Z",arrow_outward:"m242-246-42-42 412-412H234v-60h480v480h-60v-378L242-246Z",draw:"M160-120v-128l571-571q11-11 22.5-16t24.5-5q12 0 23.5 5t22.5 16l35 35q11 10 16 21.5t5 24.5q0 12-5 24t-16 23L288-120H160Zm60-60h44l446-446-22-22-22-22-446 446v44Zm601-557-44-44 44 44Zm-133 89-22-22 44 44-22-22ZM560-120q78 0 139-36.5T760-260q0-40-29.5-73.5T638-386l-47 47q50 12 79.5 34t29.5 45q0 32-40.5 56T560-180q-12 0-21 8.5t-9 21.5q0 12 9 21t21 9ZM240-414l48-48q-54-13-81-27.5T180-520q0-16 21.5-30.5T290-590q83-31 111.5-59.5T430-719q0-56-41-88.5T280-840q-42 0-76 14.5T153-789q-8 9-7.5 21t11.5 20q10 8 22.5 6.5T200-751q15-15 34-22t46-7q46 0 68 18t22 43q0 20-19 35t-85 39q-94 34-120 62t-26 63q0 32 28 62t92 44Z",undo:"M259-200v-60h310q70 0 120.5-46.5T740-422q0-69-50.5-115.5T569-584H274l114 114-42 42-186-186 186-186 42 42-114 114h294q95 0 163.5 64T800-422q0 94-68.5 158T568-200H259Z",close:"m249-207-42-42 231-231-231-231 42-42 231 231 231-231 42 42-231 231 231 231-42 42-231-231-231 231Z",check:"M378-246 154-470l43-43 181 181 384-384 43 43-427 427Z",delete:"M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z",public:"M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM437-141v-82q-35 0-59-26t-24-61v-44L149-559q-5 20-7 39.5t-2 39.5q0 130 84.5 227T437-141Zm294-108q44-48 66.5-107.5T820-480q0-106-58-192.5T607-799v18q0 35-24 61t-59 26h-87v87q0 17-13.5 28T393-568h-83v88h258q17 0 28 13t11 30v127h43q29 0 51 17t30 44Z"};var b=(e,t="")=>K`<svg class=${t} viewBox="0 -960 960 960" aria-hidden="true"><path d=${N[e]}></path></svg>`;var j=(e,t,o,r)=>c`
  <button class="ib ${e===r?"on":""}" data-tool=${e} data-tip=${o} aria-label=${o} aria-pressed=${e===r}>${b(t)}</button>`,et=e=>c`
  <div class="bar" role="toolbar" aria-label="Annotate">
    ${j("rect","crop_square","Frame",e.tool)}
    ${j("arrow","arrow_outward","Arrow",e.tool)}
    ${j("pen","draw","Pen",e.tool)}
    <span class="hint">Click to mark an element</span>
    <span class="sep"></span>
    <button class="ib" data-act="undo" data-tip="Undo (Ctrl+Z)" aria-label="Undo" ?disabled=${e.empty}>${b("undo")}</button>
    <button class="ib" data-act="cancel" data-tip="Cancel (Esc)" aria-label="Cancel">${b("close")}</button>
    <button class="filled" data-act="done" ?disabled=${e.empty}>${b("check")}Done</button>
  </div>`,ot=e=>c`<span class="num"></span><span class="text">${e}</span>`,rt=()=>c`
  <span class="num"></span>
  <div class="field">
    <label class="tf"><span class="lbl">Note</span><input aria-label="Note" placeholder="Add a note"></label>
    <div class="help">Enter saves · Esc discards</div>
  </div>
  <button class="ib del" data-tip="Delete mark" aria-label="Delete mark">${b("delete")}</button>`;var it=`
    .box{position:fixed;left:0;top:0;box-sizing:border-box;border:2px solid var(--c);border-radius:12px;
      box-shadow:0 0 0 2px #fff,0 0 0 0 color-mix(in srgb,var(--c) 40%,transparent);animation:ring 1.6s cubic-bezier(.2,0,0,1) 3}
    @keyframes ring{from{box-shadow:0 0 0 2px #fff,0 0 0 2px color-mix(in srgb,var(--c) 45%,transparent)}
      to{box-shadow:0 0 0 2px #fff,0 0 0 16px transparent}}
    .label{position:fixed;left:0;top:0;box-sizing:border-box;max-width:min(320px,calc(100vw - 8px));padding:12px 16px;
      border-radius:12px;background:var(--c);color:#fff;font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);white-space:pre-wrap;overflow-wrap:anywhere;
      animation:pop .2s cubic-bezier(.2,0,0,1)}
    @keyframes pop{from{scale:.92}}
    .dim{position:fixed;left:0;top:0;width:100vw;height:100vh}
    .dim path{fill:rgb(0 0 0/.32)}
    .pick{position:fixed;left:0;top:0;box-sizing:border-box;border:2px dashed var(--md-sys-color-primary,#000);
      background:color-mix(in srgb,var(--md-sys-color-primary,#000) 8%,transparent);border-radius:8px}
    .pick-tag{position:fixed;left:0;top:0;padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#2f3036);
      color:var(--md-sys-color-inverse-on-surface,#f1f0f7);
      font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;white-space:nowrap;
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 1px 3px 1px rgb(0 0 0/.15)}
    .annot{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;
      font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .mark{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;
      filter:drop-shadow(0 1px 1.5px rgb(0 0 0/.28))}
    .mark .halo{fill:none;stroke:var(--md-sys-color-surface,#fff);stroke-opacity:.92;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
    .mark path.halo{fill:var(--md-sys-color-surface,#fff);fill-opacity:0}
    .mark .line{fill:none;stroke:var(--c);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .mark .area{fill:color-mix(in srgb,var(--c) 7%,transparent)}
    .mark .el{fill:color-mix(in srgb,var(--c) 14%,transparent);stroke-width:2.5}
    .mark .head{fill:var(--c);stroke:var(--c);stroke-width:2;stroke-linejoin:round}
    .mark .badge{pointer-events:auto;cursor:pointer}
    .mark .badge circle{fill:var(--c);stroke:var(--md-sys-color-surface,#fff);stroke-width:2;transition:r .12s cubic-bezier(.2,0,0,1)}
    .mark .badge:hover circle{r:13}
    .mark .badge text{fill:var(--on,#fff);font:600 12px system-ui,"Segoe UI",Roboto,sans-serif;text-anchor:middle;dominant-baseline:central;pointer-events:none}
    .note,.note-edit{position:fixed;left:0;top:0;box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;
      color:var(--md-sys-color-on-surface,#1a1b21);transform-origin:17px 17px;animation:grow .18s cubic-bezier(.2,0,0,1)}
    .note.left,.note-edit.left{flex-direction:row-reverse}
    .note.up,.note-edit.up{align-items:flex-end;transform-origin:17px calc(100% - 17px)}
    .note.left,.note-edit.left{transform-origin:calc(100% - 17px) 17px}
    .note.left.up,.note-edit.left.up{transform-origin:calc(100% - 17px) calc(100% - 17px)}
    @keyframes grow{from{scale:.6;opacity:0}}
    .note .num,.note-edit .num{flex:none;width:22px;height:22px;border-radius:50%;background:var(--c);color:var(--on,#fff);
      box-shadow:0 0 0 1px var(--md-sys-color-surface,#fff);font:600 12px/22px system-ui,"Segoe UI",Roboto,sans-serif;text-align:center}
    .note{max-width:280px;min-height:34px;padding:6px 14px 6px 6px;border-radius:17px;cursor:pointer;
      background:var(--note-bg);
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)}
    .note.left{padding:6px 6px 6px 14px}
    :host{--note-bg:var(--md-sys-color-surface-container-lowest,#fff)}
    :host(.dark){--note-bg:var(--md-sys-color-surface-container-high,#282a2f)}
    .note::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .note:hover::before{opacity:.08}
    .note .text{min-width:0;padding-top:1px;font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.25px;white-space:pre-wrap;overflow-wrap:anywhere}
    /* ---- Annotate controls: plain templates that look like the M3E ones in the panel ---- */
    .note-edit{width:328px;padding:8px 6px 6px 8px;border-radius:16px;cursor:default;
      background:var(--md-sys-color-surface-container-high,#f4e6da);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15)}
    .note-edit .num{margin-top:17px}
    .note-edit .field{flex:1;min-width:0}
    /* a filled text field: small label, value, and an active line in the mark's colour */
    .note-edit .tf{display:block;box-sizing:border-box;padding:6px 16px 6px;border-radius:4px 4px 0 0;cursor:text;
      background:var(--md-sys-color-surface-container-highest,#eee0d5);box-shadow:inset 0 -2px 0 var(--c)}
    .note-edit .lbl{display:block;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;color:var(--c)}
    .note-edit input{all:unset;box-sizing:border-box;display:block;width:100%;
      font:400 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;color:inherit;cursor:text;caret-color:var(--c)}
    .note-edit input::placeholder{color:var(--md-sys-color-on-surface-variant,#51443a)}
    .note-edit .help{padding:4px 16px 0;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;color:var(--md-sys-color-on-surface-variant,#51443a)}
    /* icon buttons: 40px, round, with a state layer; a selected tool becomes a rounded square */
    .ib{all:unset;position:relative;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;
      width:40px;height:40px;margin:4px;border-radius:20px;color:var(--md-sys-color-on-surface-variant,#51443a);cursor:pointer;
      transition:border-radius .2s cubic-bezier(.2,0,0,1),background-color .2s cubic-bezier(.2,0,0,1)}
    .ib::before,.bar .filled::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .ib:hover::before,.bar .filled:hover::before{opacity:.08}
    .ib:active::before,.bar .filled:active::before{opacity:.12}
    .ib:focus-visible,.bar .filled:focus-visible{outline:3px solid var(--md-sys-color-secondary,#725a42);outline-offset:2px}
    .ib:disabled{cursor:default;opacity:.38}
    .ib:disabled::before{opacity:0}
    .ib.on{border-radius:12px;background:var(--md-sys-color-secondary-container,#feddbe);color:var(--md-sys-color-on-secondary-container,#58432e)}
    .ib svg,.bar .filled svg{width:24px;height:24px;fill:currentColor;flex:none}
    .note-edit .del{margin:4px 0 0}
    .bar{position:fixed;top:16px;left:50%;translate:-50% 0;display:flex;align-items:center;gap:0;padding:4px 12px 4px 8px;border-radius:999px;
      background:var(--md-sys-color-surface-container,#faebe0);color:var(--md-sys-color-on-surface-variant,#51443a);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);cursor:default;user-select:none}
    .bar .filled{all:unset;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;
      height:40px;padding:0 24px 0 16px;margin-left:8px;border-radius:20px;cursor:pointer;
      font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;
      background:var(--md-sys-color-primary,#000);color:var(--md-sys-color-on-primary,#fff)}
    .bar .filled svg{width:20px;height:20px}
    .bar .filled:disabled{cursor:default;background:color-mix(in srgb,var(--md-sys-color-on-surface,#221a14) 12%,transparent);
      color:color-mix(in srgb,var(--md-sys-color-on-surface,#221a14) 38%,transparent)}
    .bar .filled:disabled::before{opacity:0}
    .bar .hint{padding:0 12px 0 8px;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;white-space:nowrap}
    .bar .sep{width:1px;height:24px;background:var(--md-sys-color-outline-variant,#d6c3b6);margin:0 4px}
    .annot [data-tip]:hover::after{z-index:1;content:attr(data-tip);position:absolute;top:calc(100% + 8px);left:50%;translate:-50% 0;
      padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#382f28);color:var(--md-sys-color-inverse-on-surface,#feeee3);
      font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;white-space:nowrap;pointer-events:none}
    @media (max-width:680px){.bar .hint{display:none}.bar{padding:4px 8px 4px 4px}.ib{margin:2px}}`;var st=e=>e.logoData?c`<img class="logo" alt="" src=${e.logoData}>`:p;function at(e,t={}){if(e.kind==="section")return c`<div class="kicker">${e.kicker||"Section"}</div><h1 class="title">${e.title}</h1>`;if(e.kind==="outro"){let o=e.chapters||[];return c`${st(t)}<div class="kicker">${e.kicker||"Thank you for watching"}</div><h1 class="title">${e.title}</h1>
      ${o.length?c`<div class="list">${o.map(r=>c`<span class="tm">${r.time}</span><span>${r.title}</span>`)}</div>`:p}
      ${t.footer?c`<div class="foot">${t.footer}</div>`:p}`}return c`${st(t)}<div class="kicker">${e.kicker||t.name||"Review"}</div><h1 class="title">${e.title}</h1>
    ${e.subtitle?c`<div class="sub">${e.subtitle}</div>`:p}`}var ft=e=>e.favicon?c`<img class="ic" alt="" src=${e.favicon} @error=${t=>{t.target.replaceWith(bt())}}>`:b("public","ic");function bt(){let e=document.createElementNS("http://www.w3.org/2000/svg","svg");e.setAttribute("class","ic"),e.setAttribute("viewBox","0 -960 960 960");let t=document.createElementNS("http://www.w3.org/2000/svg","path");return t.setAttribute("d",N.public),e.append(t),e}function nt(e){let t=e.tabs?.length?e.tabs:[{title:e.title,url:e.url,favicon:e.favicon,active:!0}];return c`<span class="kind">${e.kind||"New tab"}</span><span class="tabs">${t.map(o=>o.more?c`<span class="tab off more" aria-hidden="true"><span class="t">⋯</span></span>`:c`<span class="tab ${o.active?"on":"off"}${o.new?" new":""}${o.closing?" closing":""}">${ft(o)}<span class="t">${o.title||o.url||""}</span>${b("close","x")}</span>`)}</span>`}var lt=`
    .shield{position:fixed;inset:0;pointer-events:auto;cursor:none;background:transparent}
    .cap{position:fixed;left:50%;bottom:30px;translate:-50% 0;box-sizing:border-box;width:max-content;max-width:min(780px,calc(100vw - 32px));padding:12px 20px;
      border-radius:12px;background:color-mix(in srgb,var(--md-sys-color-inverse-surface) 94%,transparent);
      color:var(--md-sys-color-inverse-on-surface);font:400 18px/26px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.15px;text-align:center;
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);transition:opacity .25s cubic-bezier(.2,0,0,1),translate .25s cubic-bezier(.2,0,0,1)}
    .cap .ch{font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;margin-bottom:4px;
      color:color-mix(in srgb,var(--md-sys-color-primary) 40%,var(--md-sys-color-inverse-on-surface))}
    .cap .ch:empty,.cap .tx:empty{display:none}
    .cap:has(.tx:empty) .ch{margin:0}
    .tx{transition:opacity .2s cubic-bezier(.2,0,0,1)}
    @media (max-width:600px){.cap{font-size:16px;line-height:24px;letter-spacing:.5px;padding:10px 16px}}
    .cap.dodge{opacity:.12}
    .hide{opacity:0!important}
    .cap.hide{translate:-50% 10px}
    .bar{position:fixed;left:0;right:0;bottom:0;height:4px;background:var(--md-sys-color-secondary-container)}
    .bar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--md-sys-color-primary);transition:width .6s cubic-bezier(.2,0,0,1)}
    .bar .tick{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--md-sys-color-surface)}
    .card{position:fixed;inset:0;display:grid;place-items:center;background:var(--md-sys-color-surface-container-low);
      color:var(--md-sys-color-on-surface);transition:opacity .4s cubic-bezier(.2,0,0,1)}
    .card .in{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:12px;width:min(760px,80vw);
      padding:40px 48px;border-radius:28px;background:var(--md-sys-color-surface-container-lowest);box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15);
      animation:rise .5s cubic-bezier(.2,0,0,1)}
    @keyframes rise{from{translate:0 16px;opacity:0}}
    .logo{max-height:44px;max-width:220px;margin-bottom:8px}
    .kicker{font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;color:var(--md-sys-color-primary)}
    .title{font:400 36px/44px system-ui,"Segoe UI",Roboto,sans-serif;margin:0}
    .sub{font:500 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.15px;color:var(--md-sys-color-on-surface-variant)}
    .list{display:grid;grid-template-columns:auto 1fr;gap:6px 20px;margin-top:8px;font:400 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px}
    .list .tm{font-variant-numeric:tabular-nums;color:var(--md-sys-color-on-surface-variant)}
    .foot{margin-top:12px;padding-top:16px;border-top:1px solid var(--md-sys-color-outline-variant);align-self:stretch;
      font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.25px;color:var(--md-sys-color-on-surface-variant)}
    /* The video moved to another tab: a Chrome-style tab with the page's icon and title slides in at the top. */
    .tabbar{position:fixed;top:0;left:50%;translate:-50% 0;display:flex;align-items:flex-end;gap:16px;padding:8px 24px 0;
      border-radius:0 0 16px 16px;background:var(--md-sys-color-surface-container-highest);box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15);
      transition:opacity .35s cubic-bezier(.2,0,0,1),translate .35s cubic-bezier(.2,0,0,1)}
    .tabbar.hide{translate:-50% -110%}
    .tabbar .kind{align-self:center;white-space:nowrap;padding-bottom:8px;font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;color:var(--md-sys-color-primary)}
    .tab{position:relative;display:flex;align-items:center;gap:8px;height:36px;width:max-content;max-width:min(260px,32vw);padding:0 12px;
      border-radius:10px 10px 0 0;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px}
    .tab::before,.tab::after{content:'';position:absolute;bottom:0;width:10px;height:10px}
    .tab::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab .ic{flex:none;width:16px;height:16px;border-radius:2px}
    .tab svg.ic{fill:var(--md-sys-color-on-surface-variant)}
    .tab .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tab .x{flex:none;width:16px;height:16px;margin-left:4px;fill:var(--md-sys-color-on-surface-variant)}
    /* Inactive tabs sit on the strip itself, like in Chrome: no surface, muted text, a divider between. */
    .tab.off{background:transparent;color:var(--md-sys-color-on-surface-variant);font-weight:400}
    .tab.off::before,.tab.off::after{display:none}
    .tab.off + .tab.off::before{display:block;content:'';left:0;top:10px;bottom:10px;width:1px;height:auto;background:var(--md-sys-color-outline-variant)}
    /* A tab the video opens grows into the strip, like Chrome adds a tab (the reverse of closing). */
    .tab.new{overflow:hidden;animation:tabopen .4s .45s cubic-bezier(.2,0,0,1) both}
    @keyframes tabopen{from{max-width:0;padding-left:0;padding-right:0;margin-left:-8px;opacity:0}to{max-width:min(260px,32vw);opacity:1}}
    /* A tab the video leaves and closes: its X is pressed (M3 state layer), then the tab collapses out of the strip. */
    .tab .x{border-radius:50%}
    .tab.closing .x{animation:xpress .95s .5s linear both}
    @keyframes xpress{0%,100%{background:transparent;box-shadow:none}
      30%{background:color-mix(in srgb,var(--md-sys-color-on-surface) 8%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--md-sys-color-on-surface) 8%,transparent)}
      45%,85%{background:color-mix(in srgb,var(--md-sys-color-on-surface) 20%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--md-sys-color-on-surface) 20%,transparent)}}
    .tab.closing{overflow:hidden;animation:tabclose .35s 1.45s cubic-bezier(.3,0,.8,.15) forwards}
    @keyframes tabclose{to{max-width:0;padding-left:0;padding-right:0;margin-left:-8px;opacity:0}}
    .tabs{display:flex;align-items:flex-end;gap:8px}
    /* The other tabs, not listed: one inactive tab with an ellipsis, always between the two. */
    .tab.more{padding:0 16px;font-size:20px;font-weight:700;color:var(--md-sys-color-on-surface-variant)}`;var gt={render:tt,html:c,overlay:{styles:it,toolbar:et,note:ot,noteEditor:rt},stage:{styles:lt,card:at,tabStrip:nt}};globalThis.__showAndTellUI??=gt;})();
/*! Bundled license information:

lit-html/lit-html.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   * SPDX-License-Identifier: BSD-3-Clause
   *)
*/
