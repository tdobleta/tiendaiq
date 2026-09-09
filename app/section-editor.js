(function(){
  "use strict";
  const root=document.getElementById("section-editor-root");
  const status=document.getElementById("section-editor-status");
  const toast=document.getElementById("section-editor-toast");
  const params=new URLSearchParams(location.search);
  const pageId=params.get("id");
  const demo=params.get("demo")==="1";
  const state={page:null,registry:[],selectedSection:null,selectedBlock:null,expandedSections:new Set(),mobile:false,dirty:false,previewTimer:null};
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
  function sourceIcon(){return `<span class="se__source-icon" aria-hidden="true"><span></span><span></span><span></span></span>`}
  function fieldHtml(field,settings,scope){
    const value=fieldValue(field,settings);const attr=`data-field="${esc(field.id)}" data-scope="${scope}"`;
    if(field.type==="checkbox")return `<label class="se__toggle"><input ${attr} type="checkbox" ${value?"checked":""}><span aria-hidden="true"></span></label>`;
    if(field.type==="color")return `<div class="se__color"><input ${attr} type="color" value="${esc(value||"#ffffff")}" aria-label="${esc(field.label)}"><input data-color-for="${esc(field.id)}" type="text" value="${esc(String(value||"#ffffff").toUpperCase())}" aria-label="Valor de ${esc(field.label)}"></div>`;
    if(field.type==="select")return `<select ${attr}>${(field.options||[]).map((o)=>`<option value="${esc(o.value)}" ${o.value===value?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`;
    if(field.type==="range")return `<div class="se__range"><input ${attr} type="range" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"><span class="se__unit"><input data-number-for="${esc(field.id)}" type="number" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"><span>${esc(field.unit||"")}</span></span></div>`;
    if(field.type==="richtext")return `<div class="se__richtext"><div class="se__richbar" aria-label="Formato de texto"><button type="button" data-rich="spark" aria-label="Mejorar texto">✦</button><button type="button" data-rich="paragraph" aria-label="Estilo de párrafo">Aa⌄</button><button type="button" data-rich="bold" aria-label="Negrita"><b>B</b></button><button type="button" data-rich="italic" aria-label="Cursiva"><i>I</i></button><button type="button" data-rich="link" aria-label="Enlace">⌁</button><button type="button" data-rich="bullets" aria-label="Lista">☷</button><button type="button" data-rich="numbers" aria-label="Lista numerada">1☷</button></div><textarea ${attr}>${esc(value)}</textarea></div>`;
    if(field.type==="textarea")return `<textarea ${attr}>${esc(value)}</textarea>`;
    if(field.type==="image_picker"){const url=typeof value==="string"?value:value?.url||"";return `<div class="se__picker"><input ${attr} type="url" value="${esc(url)}" placeholder="Pega una URL de imagen"><button type="button" data-image-picker><b>Seleccionar</b>${sourceIcon()}</button><small>Explorar imágenes<br>gratuitas</small></div>`}
    return `<input ${attr} type="${field.type==="url"?"url":"text"}" value="${esc(value)}" placeholder="${field.type==="url"?"Pega un enlace o busca":""}">`;
  }
  function fieldsHtml(fields,settings,scope){return(fields||[]).map((field)=>{const stacked=["text","textarea","richtext","url"].includes(field.type);const sourced=stacked||field.type==="image_picker";return `<div class="se__field ${stacked?"se__field--stacked":""} ${field.type==="image_picker"?"se__field--picker":""}"><label>${esc(field.label||field.id)}${sourced?sourceIcon():""}</label>${fieldHtml(field,settings,scope)}</div>`}).join("")}
  function treeIcon(type){
    if(type==="chevron")return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>`;
    if(type==="block")return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 6h4M6 8h4M6 10h2"/></svg>`;
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M2.5 6h11M5.5 3v3"/></svg>`;
  }
  function treeHtml(){
    return state.page.sections.map((section)=>{
      const active=section.id===state.selectedSection&&!state.selectedBlock;
      const expanded=state.expandedSections.has(section.id);
      const blocks=section.instance.blocks.map((block)=>`<button class="se__tree-block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" data-section="${esc(section.id)}" data-block="${esc(block.id)}">${treeIcon("block")}<span>${esc(definition(section)?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
      return `<div class="se__tree-section"><div class="se__tree-main ${active?"is-active":""}"><button class="se__tree-toggle ${expanded?"is-expanded":""}" type="button" data-expand-section="${esc(section.id)}" aria-expanded="${expanded}" aria-label="${expanded?"Contraer":"Expandir"} ${esc(section.label)}">${treeIcon("chevron")}</button><button class="se__tree-select" type="button" data-section="${esc(section.id)}">${treeIcon("section")}<span>${esc(section.label)}</span><small>(${section.instance.blocks.length})</small></button></div><div class="se__tree-blocks" ${expanded?"":"hidden"}>${blocks}</div></div>`;
    }).join("");
  }
  function inspectorHtml(){
    const {section,block,definition:entry}=selected();if(!section||!entry)return`<div class="se__notice">Seleccioná una sección.</div>`;
    const title=block?(entry.editor.blocks.find((item)=>item.type===block.type)?.name||block.type):section.label;
    const body=block?`<section class="se__group">${fieldsHtml(entry.editor.blocks.find((item)=>item.type===block.type)?.fields,block.settings,"block")}</section>`:entry.editor.groups.map((group)=>`<section class="se__group"><h3>${esc(group.label)}</h3>${fieldsHtml(group.fields,section.instance.settings,"section")}</section>`).join("");
    return `<div class="se__inspector-head"><span class="se__section-icon" aria-hidden="true"></span><b>${esc(title)}</b><button type="button" class="se__head-action" aria-label="Más opciones">•••</button><button type="button" class="se__head-action" id="se-inspector-close" aria-label="Cerrar inspector">×</button></div>${body}<details class="se__custom-css"><summary>CSS personalizado</summary><p>Agrega estilos personalizados solo a esta sección.</p><textarea aria-label="CSS personalizado" placeholder="h2 {\n  font-size: 32px;\n}"></textarea></details><button type="button" class="se__delete" ${state.page.sections.length===1?"disabled":""}><span>Eliminar sección</span></button>`;
  }
  function bindInspector(){
    root.querySelectorAll("[data-field]").forEach((control)=>{const event=control.type==="range"?"input":"change";control.addEventListener(event,()=>update(control))});
    root.querySelectorAll("[data-number-for]").forEach((control)=>control.addEventListener("change",()=>{const range=root.querySelector(`[data-field="${CSS.escape(control.dataset.numberFor)}"]`);range.value=control.value;update(range)}));
    root.querySelectorAll("[data-color-for]").forEach((control)=>control.addEventListener("change",()=>{const picker=root.querySelector(`[data-field="${CSS.escape(control.dataset.colorFor)}"]`);if(/^#[0-9a-f]{6}$/i.test(control.value)){picker.value=control.value;update(picker)}}));
    root.querySelectorAll("input[type=color][data-field]").forEach((control)=>control.addEventListener("input",()=>{const text=root.querySelector(`[data-color-for="${CSS.escape(control.dataset.field)}"]`);if(text)text.value=control.value.toUpperCase()}));
    root.querySelectorAll("[data-image-picker]").forEach((button)=>button.onclick=()=>{const input=button.parentElement.querySelector("input");input.classList.toggle("is-visible");if(input.classList.contains("is-visible"))input.focus()});
    const close=root.querySelector("#se-inspector-close");if(close)close.onclick=()=>root.querySelector(".se__panel--right").classList.add("is-closed");
  }
  function renderSelection(){
    const tree=root.querySelector(".se__tree");const inspector=root.querySelector(".se__inspector");if(tree)tree.innerHTML=treeHtml();if(inspector)inspector.innerHTML=inspectorHtml();
    root.querySelector(".se__panel--right")?.classList.remove("is-closed");
    bindTree();
    bindInspector();
  }
  function bindTree(){
    root.querySelectorAll("[data-section]").forEach((button)=>button.onclick=()=>selectItem(button.dataset.section,button.dataset.block||null));
    root.querySelectorAll("[data-expand-section]").forEach((button)=>button.onclick=()=>{const id=button.dataset.expandSection;if(state.expandedSections.has(id))state.expandedSections.delete(id);else state.expandedSections.add(id);renderSelection()});
  }
  function selectItem(sectionId,blockId){if(blockId)state.expandedSections.add(sectionId);if(state.selectedSection===sectionId&&state.selectedBlock===(blockId||null))return;state.selectedSection=sectionId;state.selectedBlock=blockId||null;renderSelection()}
  function shell(){
    root.innerHTML=`<div class="se"><header class="se__top"><div class="se__identity"><button class="se__back" id="se-back" aria-label="Volver">←</button><div class="se__title"><b>${esc(state.pageTitle)}</b><small>Editor por secciones</small></div></div><div class="se__viewport"><button id="se-desktop" aria-label="Vista de escritorio" aria-pressed="${!state.mobile}">▣</button><button id="se-mobile" aria-label="Vista móvil" aria-pressed="${state.mobile}">▯</button></div><div class="se__actions"><button class="se__button" id="se-save" ${state.dirty?"":"disabled"}>Guardar</button><button class="se__button se__button--primary" id="se-publish" ${demo?"disabled":""}>Publicar</button></div></header><div class="se__body"><aside class="se__panel se__panel--left"><div class="se__panel-head"><b>Página de producto</b></div><nav class="se__tree" aria-label="Secciones de la página">${treeHtml()}</nav><button class="se__add" id="se-add" ${state.registry.length<=state.page.sections.length?"disabled":""}><span aria-hidden="true">⊕</span>Añadir sección</button></aside><section class="se__canvas"><div class="se__frame-shell ${state.mobile?"is-mobile":""}"><iframe class="se__frame" id="se-frame" title="Vista previa de la página"></iframe></div></section><aside class="se__panel se__panel--right"><div class="se__inspector">${inspectorHtml()}</div></aside></div></div>`;
    bind();refreshPreview();
  }
  function bind(){
    root.querySelector("#se-back").onclick=()=>{const u=new URL("/paginas",location.origin);for(const key of["shop","host","embedded"]){const value=params.get(key);if(value)u.searchParams.set(key,value)}location.assign(u.pathname+u.search)};
    root.querySelector("#se-desktop").onclick=()=>{state.mobile=false;shell()};root.querySelector("#se-mobile").onclick=()=>{state.mobile=true;shell()};
    root.querySelector("#se-save").onclick=save;
    root.querySelector("#se-publish").onclick=publish;
    bindTree();
    bindInspector();
  }
  function update(control){const {section,block}=selected();const target=control.dataset.scope==="block"?block.settings:section.instance.settings;let value=control.type==="checkbox"?control.checked:control.value;if(control.type==="range"){value=Number(value);const number=root.querySelector(`[data-number-for="${CSS.escape(control.dataset.field)}"]`);if(number)number.value=control.value}target[control.dataset.field]=value;state.dirty=true;const saveButton=root.querySelector("#se-save");if(saveButton)saveButton.disabled=false;clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,160)}
  async function refreshPreview(){try{const path=demo?"/section-page-demo-preview":`/api/paginas/${encodeURIComponent(pageId)}/section-preview`;const result=await api(path,{method:"POST",body:{section_page:state.page}});const frame=root.querySelector("#se-frame");if(frame)frame.srcdoc=result.html}catch(error){notify(error.message)}}
  async function persist({render=true,announce=true}={}){const result=await api(`/api/paginas/${encodeURIComponent(pageId)}`,{method:"PUT",body:{section_page:state.page}});state.page=result.section_page;state.dirty=false;if(announce)notify("Cambios guardados.");if(render)shell();return result}
  async function save(){const button=root.querySelector("#se-save");button.disabled=true;if(demo){state.dirty=false;notify("Demostración: el cambio quedó aplicado durante esta vista.");return}try{await persist()}catch(error){button.disabled=false;notify(error.message)}}
  async function waitForJob(id){const limit=Date.now()+180000;while(Date.now()<limit){const{job}=await api(`/api/jobs/${encodeURIComponent(id)}`);if(job.status==="succeeded")return job;if(["failed","cancelled"].includes(job.status))throw new Error(job.error||"Shopify no pudo completar la publicación.");await new Promise((resolve)=>setTimeout(resolve,1000))}throw new Error("La publicación sigue en curso. Podés volver a Páginas y revisar su estado.")}
  async function publish(){const button=root.querySelector("#se-publish");button.disabled=true;button.textContent="Publicando…";try{if(state.dirty)await persist({render:false,announce:false});const{job}=await api(`/api/paginas/${encodeURIComponent(pageId)}/publicar`,{method:"POST"});const completed=await waitForJob(job.id);notify("Página publicada en Shopify.");button.textContent="Publicada";if(completed.result?.url)window.open(completed.result.url,"_blank","noopener")}catch(error){button.disabled=false;button.textContent="Publicar";notify(error.message)}}
  window.addEventListener("message",(event)=>{if(event.data?.type!=="tiq-section-select")return;selectItem(event.data.sectionId,event.data.blockId||null)});
  async function start(){if(demo){const sample=await api("/section-page-demo-data");state.page=clone(sample.section_page);state.pageTitle=`${sample.titulo} · demostración`;state.registry=sample.registry||[]}else{if(!pageId)throw new Error("Falta el id de la página.");const[page,registry]=await Promise.all([api(`/api/paginas/${encodeURIComponent(pageId)}`),api("/api/section-registry")]);if(!page.data?.section_page)throw new Error("Esta página todavía no usa el sistema por secciones.");state.page=clone(page.data.section_page);state.pageTitle=page.titulo||state.page.productSnapshot?.title||"Página de producto";state.registry=registry.sections||[]}state.selectedSection=state.page.sections[0]?.id||null;status.hidden=true;root.hidden=false;shell()}
  start().catch((error)=>{status.textContent=error.message||"No se pudo abrir la página."});
}());
