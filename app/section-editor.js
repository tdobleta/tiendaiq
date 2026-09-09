(function(){
  "use strict";
  const root=document.getElementById("section-editor-root");
  const status=document.getElementById("section-editor-status");
  const toast=document.getElementById("section-editor-toast");
  const params=new URLSearchParams(location.search);
  const pageId=params.get("id");
  const demo=params.get("demo")==="1";
  const state={page:null,registry:[],selectedSection:null,selectedBlock:null,mobile:false,dirty:false,previewTimer:null};
  const esc=(value)=>String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const clone=(value)=>JSON.parse(JSON.stringify(value));

  async function token(){return window.shopify?.idToken?window.shopify.idToken():null}
  async function api(path,options={}){
    let retry=0;
    while(true){
      const headers={"Content-Type":"application/json"};const pass=await token();if(pass)headers.Authorization=`Bearer ${pass}`;
      const response=await fetch(path,{...options,headers,body:options.body?JSON.stringify(options.body):undefined});
      const data=await response.json().catch(()=>({}));
      if(response.ok)return data;
      if(retry++===0&&(response.status===401||response.headers.get("X-Shopify-Retry-Invalid-Session-Request")==="1")){await new Promise((r)=>setTimeout(r,120));continue}
      throw new Error(data.error||`Error ${response.status}`);
    }
  }
  function notify(message){toast.textContent=message;toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,3500)}
  function definition(section){return state.registry.find((item)=>item.id===section.definition.id&&item.version===section.definition.version)}
  function selected(){const section=state.page.sections.find((item)=>item.id===state.selectedSection);if(!section)return{};const block=section.instance.blocks.find((item)=>item.id===state.selectedBlock);return{section,block,definition:definition(section)}}
  function fieldValue(field,settings){const value=settings[field.id];return value==null?"":value}
  function fieldHtml(field,settings,scope){
    const value=fieldValue(field,settings);const attr=`data-field="${esc(field.id)}" data-scope="${scope}"`;
    if(field.type==="checkbox")return `<input ${attr} type="checkbox" ${value?"checked":""}>`;
    if(field.type==="color")return `<input ${attr} type="color" value="${esc(value||"#ffffff")}">`;
    if(field.type==="select")return `<select ${attr}>${(field.options||[]).map((o)=>`<option value="${esc(o.value)}" ${o.value===value?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`;
    if(field.type==="range")return `<div class="se__range"><input ${attr} type="range" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"><span class="se__unit"><input data-number-for="${esc(field.id)}" type="number" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"><span>${esc(field.unit||"")}</span></span></div>`;
    if(["textarea","richtext"].includes(field.type))return `<textarea ${attr}>${esc(value)}</textarea>`;
    if(field.type==="image_picker")return `<input ${attr} type="url" value="${esc(typeof value==="string"?value:value?.url||"")}" placeholder="URL o imagen de Shopify">`;
    return `<input ${attr} type="${field.type==="url"?"url":"text"}" value="${esc(value)}">`;
  }
  function fieldsHtml(fields,settings,scope){return(fields||[]).map((field)=>`<div class="se__field"><label for="">${esc(field.label||field.id)}</label>${fieldHtml(field,settings,scope)}</div>`).join("")}
  function treeHtml(){
    return state.page.sections.map((section)=>{
      const active=section.id===state.selectedSection&&!state.selectedBlock;
      const blocks=section.instance.blocks.map((block)=>`<button class="se__tree-row se__tree-row--block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" data-section="${esc(section.id)}" data-block="${esc(block.id)}"><i>▫</i><span>${esc(definition(section)?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
      return `<button class="se__tree-row ${active?"is-active":""}" data-section="${esc(section.id)}"><i>▣</i><span>${esc(section.label)}</span><small>${section.instance.blocks.length}</small></button>${blocks}`;
    }).join("");
  }
  function inspectorHtml(){
    const {section,block,definition:entry}=selected();if(!section||!entry)return`<div class="se__notice">Seleccioná una sección.</div>`;
    if(block){const blockDef=entry.editor.blocks.find((item)=>item.type===block.type);return `<div class="se__panel-head"><b>${esc(blockDef?.name||block.type)}</b><small>Bloque de ${esc(section.label)}</small></div><div class="se__group"><h3>Contenido</h3>${fieldsHtml(blockDef?.fields,block.settings,"block")}</div>`}
    return `<div class="se__panel-head"><b>${esc(section.label)}</b><small>Editor sincronizado con Shopify · ${entry.sourceSha256.slice(0,8)}</small></div>${entry.editor.groups.map((group)=>`<section class="se__group"><h3>${esc(group.label)}</h3>${fieldsHtml(group.fields,section.instance.settings,"section")}</section>`).join("")}<div class="se__notice">El diseño y el comportamiento pertenecen a la sección versionada. Acá sólo aparecen los controles que declara su schema real.</div>`;
  }
  function shell(){
    root.innerHTML=`<div class="se"><header class="se__top"><div class="se__identity"><button class="se__back" id="se-back" aria-label="Volver">←</button><div class="se__title"><b>${esc(state.pageTitle)}</b><small>Editor por secciones</small></div></div><div class="se__viewport"><button id="se-desktop" aria-label="Vista de escritorio" aria-pressed="${!state.mobile}">▣</button><button id="se-mobile" aria-label="Vista móvil" aria-pressed="${state.mobile}">▯</button></div><div class="se__actions"><button class="se__button" id="se-save" ${state.dirty?"":"disabled"}>Guardar</button><button class="se__button se__button--primary" id="se-publish" disabled>Publicar</button></div></header><div class="se__body"><aside class="se__panel se__panel--left"><div class="se__panel-head"><b>Página de producto</b><small>${state.page.sections.length} ${state.page.sections.length===1?"sección":"secciones"}</small></div><nav class="se__tree">${treeHtml()}</nav><button class="se__add" id="se-add" ${state.registry.length<=state.page.sections.length?"disabled":""}>＋ Añadir sección</button></aside><section class="se__canvas"><div class="se__frame-shell ${state.mobile?"is-mobile":""}"><iframe class="se__frame" id="se-frame" title="Vista previa de la página"></iframe></div></section><aside class="se__panel se__panel--right"><div class="se__inspector">${inspectorHtml()}</div></aside></div></div>`;
    bind();refreshPreview();
  }
  function bind(){
    root.querySelector("#se-back").onclick=()=>{const u=new URL("/paginas",location.origin);for(const key of["shop","host","embedded"]){const value=params.get(key);if(value)u.searchParams.set(key,value)}location.assign(u.pathname+u.search)};
    root.querySelector("#se-desktop").onclick=()=>{state.mobile=false;shell()};root.querySelector("#se-mobile").onclick=()=>{state.mobile=true;shell()};
    root.querySelector("#se-save").onclick=save;
    root.querySelectorAll("[data-section]").forEach((button)=>button.onclick=()=>{state.selectedSection=button.dataset.section;state.selectedBlock=button.dataset.block||null;shell()});
    root.querySelectorAll("[data-field]").forEach((control)=>{const event=control.type==="range"?"input":"change";control.addEventListener(event,()=>update(control))});
    root.querySelectorAll("[data-number-for]").forEach((control)=>control.addEventListener("change",()=>{const range=root.querySelector(`[data-field="${CSS.escape(control.dataset.numberFor)}"]`);range.value=control.value;update(range)}));
  }
  function update(control){const {section,block}=selected();const target=control.dataset.scope==="block"?block.settings:section.instance.settings;let value=control.type==="checkbox"?control.checked:control.value;if(control.type==="range")value=Number(value);target[control.dataset.field]=value;state.dirty=true;const saveButton=root.querySelector("#se-save");if(saveButton)saveButton.disabled=false;clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,160)}
  async function refreshPreview(){try{const path=demo?"/section-page-demo-preview":`/api/paginas/${encodeURIComponent(pageId)}/section-preview`;const result=await api(path,{method:"POST",body:{section_page:state.page}});const frame=root.querySelector("#se-frame");if(frame)frame.srcdoc=result.html}catch(error){notify(error.message)}}
  async function save(){const button=root.querySelector("#se-save");button.disabled=true;if(demo){state.dirty=false;notify("Demostración: el cambio quedó aplicado durante esta vista.");return}try{const result=await api(`/api/paginas/${encodeURIComponent(pageId)}`,{method:"PUT",body:{section_page:state.page}});state.page=result.section_page;state.dirty=false;notify("Cambios guardados.");shell()}catch(error){button.disabled=false;notify(error.message)}}
  window.addEventListener("message",(event)=>{if(event.data?.type!=="tiq-section-select")return;state.selectedSection=event.data.sectionId;state.selectedBlock=event.data.blockId||null;shell()});
  async function start(){if(demo){const sample=await api("/section-page-demo-data");state.page=clone(sample.section_page);state.pageTitle=`${sample.titulo} · demostración`;state.registry=sample.registry||[]}else{if(!pageId)throw new Error("Falta el id de la página.");const[page,registry]=await Promise.all([api(`/api/paginas/${encodeURIComponent(pageId)}`),api("/api/section-registry")]);if(!page.data?.section_page)throw new Error("Esta página todavía no usa el sistema por secciones.");state.page=clone(page.data.section_page);state.pageTitle=page.titulo||state.page.productSnapshot?.title||"Página de producto";state.registry=registry.sections||[]}state.selectedSection=state.page.sections[0]?.id||null;status.hidden=true;root.hidden=false;shell()}
  start().catch((error)=>{status.textContent=error.message||"No se pudo abrir la página."});
}());
