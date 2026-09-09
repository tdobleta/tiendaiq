(function(){
  "use strict";
  const root=document.getElementById("section-editor-root");
  const status=document.getElementById("section-editor-status");
  const toast=document.getElementById("section-editor-toast");
  const params=new URLSearchParams(location.search);
  const pageId=params.get("id");
  const demo=params.get("demo")==="1";
  const state={page:null,registry:[],selectedSection:null,selectedBlock:null,selectedOutline:null,expandedSections:new Set(),expandedOutline:new Set(),mobile:false,dirty:false,previewTimer:null};
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
  function findOutline(nodes,id,parents=[]){for(const node of nodes||[]){if(node.id===id)return{node,parents};const found=findOutline(node.children,id,[...parents,node]);if(found)return found}return null}
  function findBlockOutline(nodes,type,parents=[]){for(const node of nodes||[]){if(node.blockType===type)return{node,parents};const found=findBlockOutline(node.children,type,[...parents,node]);if(found)return found}return null}
  function selected(){const section=state.page.sections.find((item)=>item.id===state.selectedSection);if(!section)return{};const entry=definition(section);const block=section.instance.blocks.find((item)=>item.id===state.selectedBlock);const outline=findOutline(entry?.editor.outline,state.selectedOutline)?.node||null;return{section,block,outline,definition:entry}}
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
    if(field.type==="image_picker"){const url=typeof value==="string"?value:value?.url||"";return `<div class="se__media-picker ${url?"has-image":""}" data-media-drop data-media-field-id="${esc(field.id)}" data-media-scope="${scope}">${url?`<img src="${esc(url)}" alt="Vista previa de ${esc(field.label||"imagen")}">`:treeIcon("gallery")}<p>Arrastra y suelta o haz clic para seleccionar<br>una imagen</p><small>JPG, PNG, GIF, WEBP hasta 10MB</small><button type="button" class="se__media-select" data-media-menu aria-expanded="false">${treeIcon("upload")}<span>${url?"Cambiar imagen":"Seleccionar archivos"}</span></button><div class="se__media-menu" hidden><button type="button" data-media-upload>${treeIcon("upload")}<span>Subir imagen</span></button><button type="button" data-media-gallery>${treeIcon("gallery")}<span>Seleccionar de la galería</span></button></div><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-media-file hidden></div>`}
    return `<input ${attr} type="${field.type==="url"?"url":"text"}" value="${esc(value)}" placeholder="${field.type==="url"?"Pega un enlace o busca":""}">`;
  }
  function fieldsHtml(fields,settings,scope){return(fields||[]).map((field)=>{const stacked=["text","textarea","richtext","url"].includes(field.type);const sourced=stacked||field.type==="image_picker";return `<div class="se__field ${stacked?"se__field--stacked":""} ${field.type==="image_picker"?"se__field--picker":""}"><label>${esc(field.label||field.id)}${sourced?sourceIcon():""}</label>${fieldHtml(field,settings,scope)}</div>`}).join("")}
  function treeIcon(type){
    if(type==="chevron")return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>`;
    if(type==="block")return `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2"/><path d="M6 6h4M6 8h4M6 10h2"/></svg>`;
    const paths={
      section:'<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M2.5 6h11M5.5 3v3"/>',
      gallery:'<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1"/><path d="m4 11 2.7-2.7 1.8 1.8 1.4-1.4L12 11"/>',
      details:'<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
      star:'<path d="m8 2 1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.4l-3.6 1.9.7-4.1-3-2.9 4.1-.6z"/>',
      heading:'<path d="M3 3v10M13 3v10M3 8h10"/>',
      text:'<path d="M3 4h10M3 8h8M3 12h6"/>',
      benefits:'<path d="m2.5 4 1.3 1.3L6 3M7.5 4H14M2.5 8l1.3 1.3L6 7M7.5 8H14M2.5 12l1.3 1.3L6 11M7.5 12H14"/>',
      purchase:'<path d="M3 5.5h10v7H3zM5 5.5V4a3 3 0 0 1 6 0v1.5"/>',
      bundle:'<path d="M3 5.5 8 2l5 3.5v6L8 14l-5-2.5zM3 5.5 8 8l5-2.5M8 8v6"/>',
      cart:'<path d="M2 3h1.5l1.2 6.5h7.4l1.4-4.5H4M6 13a.7.7 0 1 0 0-1.4A.7.7 0 0 0 6 13ZM11 13a.7.7 0 1 0 0-1.4A.7.7 0 0 0 11 13Z"/>',
      shield:'<path d="M8 2.3 13 4v3.7c0 3-2 5-5 6-3-1-5-3-5-6V4zM5.6 8l1.5 1.5 3.3-3.3"/>',
      payment:'<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2 6.5h12M4 10h3"/>',
      tabs:'<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11M6 3v3"/>',
      upload:'<path d="M8 11V3M5 6l3-3 3 3M3 10.5v2h10v-2"/>'
    };
    return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[type]||paths.block||paths.section}</svg>`;
  }
  function outlineCount(nodes,section){return(nodes||[]).reduce((total,node)=>total+1+(node.blockType?section.instance.blocks.filter((block)=>block.type===node.blockType).length:0)+outlineCount(node.children,section),0)}
  function outlineHtml(section,nodes,level=0){const entry=definition(section);return(nodes||[]).map((node)=>{
    const key=`${section.id}:${node.id}`;const blocks=node.blockType?section.instance.blocks.filter((block)=>block.type===node.blockType):[];const expandable=Boolean(node.children||node.blockType);const expanded=state.expandedOutline.has(key);const active=section.id===state.selectedSection&&node.id===state.selectedOutline&&!state.selectedBlock;
    const row=expandable?`<button class="se__outline-row ${active?"is-active":""}" type="button" data-expand-outline="${esc(key)}" aria-expanded="${expanded}"><span class="se__outline-chevron ${expanded?"is-expanded":""}">${treeIcon("chevron")}</span>${treeIcon(node.icon||"details")}<span>${esc(node.label)}</span>${blocks.length?`<small>${blocks.length}</small>`:""}</button>`:`<button class="se__outline-row ${active?"is-active":""}" type="button" data-section="${esc(section.id)}" data-outline="${esc(node.id)}"><span class="se__outline-spacer"></span>${treeIcon(node.icon||"block")}<span>${esc(node.label)}</span></button>`;
    const children=node.children?outlineHtml(section,node.children,level+1):blocks.map((block)=>`<button class="se__outline-row se__outline-row--block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" style="--outline-level:${level+1}" type="button" data-section="${esc(section.id)}" data-block="${esc(block.id)}"><span class="se__outline-spacer"></span>${treeIcon("block")}<span>${esc(entry?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
    return `<div class="se__outline-node" style="--outline-level:${level}">${row}<div class="se__outline-children" ${expanded?"":"hidden"}>${children}</div></div>`;
  }).join("")}
  function treeHtml(){
    return state.page.sections.map((section)=>{
      const entry=definition(section);const active=section.id===state.selectedSection&&!state.selectedBlock&&!state.selectedOutline;
      const expanded=state.expandedSections.has(section.id);
      const contents=entry?.editor.outline?.length?outlineHtml(section,entry.editor.outline):section.instance.blocks.map((block)=>`<button class="se__outline-row se__outline-row--block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" data-section="${esc(section.id)}" data-block="${esc(block.id)}"><span class="se__outline-spacer"></span>${treeIcon("block")}<span>${esc(entry?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
      const count=entry?.editor.outline?.length?outlineCount(entry.editor.outline,section):section.instance.blocks.length;
      return `<div class="se__tree-section"><div class="se__tree-main ${active?"is-active":""}"><button class="se__tree-toggle ${expanded?"is-expanded":""}" type="button" data-expand-section="${esc(section.id)}" aria-expanded="${expanded}" aria-label="${expanded?"Contraer":"Expandir"} ${esc(section.label)}">${treeIcon("chevron")}</button><button class="se__tree-select" type="button" data-section="${esc(section.id)}">${treeIcon("section")}<span>${esc(section.label)}</span><small>(${count})</small></button></div><div class="se__tree-blocks" ${expanded?"":"hidden"}>${contents}</div></div>`;
    }).join("");
  }
  function inspectorHtml(){
    const {section,block,outline,definition:entry}=selected();if(!section||!entry)return`<div class="se__notice">Seleccioná una sección.</div>`;
    const title=block?(entry.editor.blocks.find((item)=>item.type===block.type)?.name||block.type):(outline?.label||section.label);
    const sectionFields=entry.editor.groups.flatMap((group)=>group.fields);const outlineFields=outline?.fields?sectionFields.filter((field)=>outline.fields.includes(field.id)):[];
    const body=block?`<section class="se__group">${fieldsHtml(entry.editor.blocks.find((item)=>item.type===block.type)?.fields,block.settings,"block")}</section>`:outline?`<section class="se__group">${fieldsHtml(outlineFields,section.instance.settings,"section")}</section>`:entry.editor.groups.map((group)=>`<section class="se__group"><h3>${esc(group.label)}</h3>${fieldsHtml(group.fields,section.instance.settings,"section")}</section>`).join("");
    const sectionActions=!block&&!outline?`<details class="se__custom-css"><summary>CSS personalizado</summary><p>Agrega estilos personalizados solo a esta sección.</p><textarea aria-label="CSS personalizado" placeholder="h2 {\n  font-size: 32px;\n}"></textarea></details><button type="button" class="se__delete" ${state.page.sections.length===1?"disabled":""}><span>Eliminar sección</span></button>`:"";
    return `<div class="se__inspector-head"><span class="se__section-icon" aria-hidden="true"></span><b>${esc(title)}</b><button type="button" class="se__head-action" aria-label="Más opciones">•••</button><button type="button" class="se__head-action" id="se-inspector-close" aria-label="Cerrar inspector">×</button></div>${body}${sectionActions}`;
  }
  function setImageValue(scope,fieldId,url){const {section,block}=selected();const target=scope==="block"?block?.settings:section?.instance.settings;if(!target)return;target[fieldId]=url;state.dirty=true;const saveButton=root.querySelector("#se-save");if(saveButton)saveButton.disabled=false;renderSelection();clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,80)}
  function readImage(file){return new Promise((resolve,reject)=>{if(!/^image\/(jpeg|png|webp|gif)$/i.test(file?.type||""))return reject(new Error("Elegí una imagen JPG, PNG, WEBP o GIF."));if(file.size>10*1024*1024)return reject(new Error("La imagen supera el límite de 10 MB."));const reader=new FileReader();reader.onerror=()=>reject(new Error("No se pudo leer la imagen."));reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");reader.readAsDataURL(file)})}
  async function uploadImage(file,picker){if(demo||!pageId)return notify("La carga desde el dispositivo está disponible en una página real.");const fieldId=picker.dataset.mediaFieldId;const scope=picker.dataset.mediaScope;picker.classList.add("is-busy");try{const base64=await readImage(file);const uploaded=await api(`/api/paginas/${encodeURIComponent(pageId)}/imagenes`,{method:"POST",body:{nombre:file.name,mime:file.type,base64}});const media=state.page.productSnapshot?.media||[];state.page.productSnapshot={...(state.page.productSnapshot||{}),media:[...media.filter((item)=>item.id!==uploaded.media_id),{id:uploaded.media_id,url:uploaded.url,alt:file.name}]};setImageValue(scope,fieldId,uploaded.url);notify("Imagen subida a Shopify y seleccionada.")}catch(error){picker.classList.remove("is-busy");notify(error.message)}}
  function closeGallery(){root.querySelector(".se__media-backdrop")?.remove()}
  function openGallery(picker){closeGallery();const media=state.page.productSnapshot?.media||[];const fieldId=picker.dataset.mediaFieldId;const scope=picker.dataset.mediaScope;const current=scope==="block"?selected().block?.settings?.[fieldId]:selected().section?.instance.settings?.[fieldId];root.insertAdjacentHTML("beforeend",`<div class="se__media-backdrop" data-media-close><section class="se__media-dialog" role="dialog" aria-modal="true" aria-labelledby="se-media-title"><header><div><h2 id="se-media-title">Seleccionar de la galería</h2><p>Imágenes disponibles en este producto de Shopify</p></div><button type="button" data-media-close aria-label="Cerrar">×</button></header><div class="se__media-grid">${media.length?media.map((item,index)=>`<button type="button" class="se__media-option ${item.url===current?"is-selected":""}" data-media-url="${esc(item.url)}"><img src="${esc(item.url)}" alt="${esc(item.alt||`Imagen ${index+1}`)}"><span>${item.url===current?"Seleccionada":`Imagen ${index+1}`}</span></button>`).join(""):`<div class="se__media-empty">Este producto todavía no tiene imágenes disponibles.</div>`}</div><footer><s-button data-media-close>Cancelar</s-button><s-button variant="primary" data-gallery-upload>Subir una imagen</s-button></footer></section></div>`);const backdrop=root.querySelector(".se__media-backdrop");backdrop.onclick=(event)=>{if(event.target===backdrop||event.target.closest("[data-media-close]"))closeGallery()};backdrop.querySelectorAll("[data-media-url]").forEach((button)=>button.onclick=()=>{setImageValue(scope,fieldId,button.dataset.mediaUrl);closeGallery()});backdrop.querySelector("[data-gallery-upload]").onclick=()=>{closeGallery();picker.querySelector("[data-media-file]").click()}}
  function bindInspector(){
    root.querySelectorAll("[data-field]").forEach((control)=>{const event=control.type==="range"?"input":"change";control.addEventListener(event,()=>update(control))});
    root.querySelectorAll("[data-number-for]").forEach((control)=>control.addEventListener("change",()=>{const range=root.querySelector(`[data-field="${CSS.escape(control.dataset.numberFor)}"]`);range.value=control.value;update(range)}));
    root.querySelectorAll("[data-color-for]").forEach((control)=>control.addEventListener("change",()=>{const picker=root.querySelector(`[data-field="${CSS.escape(control.dataset.colorFor)}"]`);if(/^#[0-9a-f]{6}$/i.test(control.value)){picker.value=control.value;update(picker)}}));
    root.querySelectorAll("input[type=color][data-field]").forEach((control)=>control.addEventListener("input",()=>{const text=root.querySelector(`[data-color-for="${CSS.escape(control.dataset.field)}"]`);if(text)text.value=control.value.toUpperCase()}));
    root.querySelectorAll("[data-media-menu]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();const menu=button.parentElement.querySelector(".se__media-menu");const open=menu.hidden;root.querySelectorAll(".se__media-menu").forEach((item)=>item.hidden=true);menu.hidden=!open;button.setAttribute("aria-expanded",String(open))});
    root.querySelectorAll("[data-media-upload]").forEach((button)=>button.onclick=()=>button.closest("[data-media-drop]").querySelector("[data-media-file]").click());
    root.querySelectorAll("[data-media-gallery]").forEach((button)=>button.onclick=()=>openGallery(button.closest("[data-media-drop]")));
    root.querySelectorAll("[data-media-file]").forEach((input)=>input.onchange=()=>{if(input.files?.[0])uploadImage(input.files[0],input.closest("[data-media-drop]"))});
    root.querySelectorAll("[data-media-drop]").forEach((picker)=>{picker.ondragover=(event)=>{event.preventDefault();picker.classList.add("is-dragging")};picker.ondragleave=()=>picker.classList.remove("is-dragging");picker.ondrop=(event)=>{event.preventDefault();picker.classList.remove("is-dragging");if(event.dataTransfer?.files?.[0])uploadImage(event.dataTransfer.files[0],picker)}});
    document.onclick=(event)=>{root.querySelectorAll(".se__media-menu").forEach((menu)=>menu.hidden=true);if(!event.target.closest?.(".se__actions-menu")){const actions=root.querySelector(".se__actions-popover");if(actions)actions.hidden=true}};
    const close=root.querySelector("#se-inspector-close");if(close)close.onclick=()=>root.querySelector(".se__panel--right").classList.add("is-closed");
  }
  function renderSelection(){
    const tree=root.querySelector(".se__tree");const inspector=root.querySelector(".se__inspector");if(tree)tree.innerHTML=treeHtml();if(inspector)inspector.innerHTML=inspectorHtml();
    root.querySelector(".se__panel--right")?.classList.remove("is-closed");
    bindTree();
    bindInspector();
  }
  function bindTree(){
    root.querySelectorAll("[data-section]").forEach((button)=>button.onclick=()=>selectItem(button.dataset.section,button.dataset.block||null,button.dataset.outline||null));
    root.querySelectorAll("[data-expand-section]").forEach((button)=>button.onclick=()=>{const id=button.dataset.expandSection;if(state.expandedSections.has(id))state.expandedSections.delete(id);else state.expandedSections.add(id);renderSelection()});
    root.querySelectorAll("[data-expand-outline]").forEach((button)=>button.onclick=()=>{const key=button.dataset.expandOutline;if(state.expandedOutline.has(key))state.expandedOutline.delete(key);else state.expandedOutline.add(key);renderSelection()});
  }
  function expandOutlinePath(section,nodeId){const entry=definition(section);const found=findOutline(entry?.editor.outline,nodeId);for(const parent of found?.parents||[])state.expandedOutline.add(`${section.id}:${parent.id}`)}
  function expandAllOutline(section,nodes){for(const node of nodes||[]){if(node.children||node.blockType)state.expandedOutline.add(`${section.id}:${node.id}`);expandAllOutline(section,node.children)}}
  function selectItem(sectionId,blockId,outlineId){const section=state.page.sections.find((item)=>item.id===sectionId);if(blockId||outlineId)state.expandedSections.add(sectionId);if(blockId&&section){const block=section.instance.blocks.find((item)=>item.id===blockId);const found=findBlockOutline(definition(section)?.editor.outline,block?.type);for(const parent of found?.parents||[])state.expandedOutline.add(`${section.id}:${parent.id}`);if(found)state.expandedOutline.add(`${section.id}:${found.node.id}`)}if(outlineId&&section)expandOutlinePath(section,outlineId);if(state.selectedSection===sectionId&&state.selectedBlock===(blockId||null)&&state.selectedOutline===(outlineId||null))return;state.selectedSection=sectionId;state.selectedBlock=blockId||null;state.selectedOutline=outlineId||null;renderSelection()}
  function productNumericId(){const value=String(state.page?.productId||state.page?.productSnapshot?.id||"");const id=value.split("/").pop();return /^\d+$/.test(id)?id:""}
  function shell(){
    root.innerHTML=`<div class="se"><header class="se__top"><div class="se__identity"><button class="se__back" id="se-back" aria-label="Volver">←</button><div class="se__title"><b>${esc(state.pageTitle)}</b><small>Editor por secciones</small></div></div><div class="se__viewport"><button id="se-desktop" aria-label="Vista de escritorio" aria-pressed="${!state.mobile}">▣</button><button id="se-mobile" aria-label="Vista móvil" aria-pressed="${state.mobile}">▯</button></div><div class="se__actions"><s-button variant="secondary" id="se-save" ${state.dirty?"":"disabled"}>Guardar</s-button><s-button variant="primary" id="se-publish" ${demo?"disabled":""}>Publicar en la tienda</s-button><s-button variant="secondary" id="se-variants" ${productNumericId()?"":"disabled"}>Editar variantes</s-button><div class="se__actions-menu"><s-button variant="secondary" id="se-actions">⚙ Acciones</s-button><div class="se__actions-popover" hidden><button type="button" id="se-expand-all">Expandir todos los elementos</button><button type="button" id="se-collapse-all">Contraer todos los elementos</button></div></div></div></header><div class="se__body"><aside class="se__panel se__panel--left"><div class="se__panel-head"><b>Página de producto</b></div><nav class="se__tree" aria-label="Secciones de la página">${treeHtml()}</nav><button class="se__add" id="se-add" ${state.registry.length<=state.page.sections.length?"disabled":""}><span aria-hidden="true">⊕</span>Añadir sección</button></aside><section class="se__canvas"><div class="se__frame-shell ${state.mobile?"is-mobile":""}"><iframe class="se__frame" id="se-frame" title="Vista previa de la página"></iframe></div></section><aside class="se__panel se__panel--right"><div class="se__inspector">${inspectorHtml()}</div></aside></div></div>`;
    bind();refreshPreview();
  }
  function bind(){
    root.querySelector("#se-back").onclick=()=>{const u=new URL("/paginas",location.origin);for(const key of["shop","host","embedded"]){const value=params.get(key);if(value)u.searchParams.set(key,value)}location.assign(u.pathname+u.search)};
    root.querySelector("#se-desktop").onclick=()=>{state.mobile=false;shell()};root.querySelector("#se-mobile").onclick=()=>{state.mobile=true;shell()};
    root.querySelector("#se-save").onclick=save;
    root.querySelector("#se-publish").onclick=publish;
    root.querySelector("#se-variants").onclick=()=>{const id=productNumericId();const shop=String(params.get("shop")||"").replace(/\.myshopify\.com$/i,"");if(id&&/^[a-z0-9][a-z0-9-]*$/i.test(shop))window.open(`https://admin.shopify.com/store/${encodeURIComponent(shop)}/products/${id}`,"_blank","noopener,noreferrer")};
    root.querySelector("#se-actions").onclick=(event)=>{event.stopPropagation();const menu=root.querySelector(".se__actions-popover");menu.hidden=!menu.hidden};
    root.querySelector("#se-expand-all").onclick=()=>{for(const section of state.page.sections){state.expandedSections.add(section.id);expandAllOutline(section,definition(section)?.editor.outline)}shell()};
    root.querySelector("#se-collapse-all").onclick=()=>{state.expandedOutline.clear();shell()};
    bindTree();
    bindInspector();
  }
  function update(control){const {section,block}=selected();const target=control.dataset.scope==="block"?block.settings:section.instance.settings;let value=control.type==="checkbox"?control.checked:control.value;if(control.type==="range"){value=Number(value);const number=root.querySelector(`[data-number-for="${CSS.escape(control.dataset.field)}"]`);if(number)number.value=control.value}target[control.dataset.field]=value;state.dirty=true;const saveButton=root.querySelector("#se-save");if(saveButton)saveButton.disabled=false;clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,160)}
  async function refreshPreview(){try{const path=demo?"/section-page-demo-preview":`/api/paginas/${encodeURIComponent(pageId)}/section-preview`;const result=await api(path,{method:"POST",body:{section_page:state.page}});const frame=root.querySelector("#se-frame");if(frame)frame.srcdoc=result.html}catch(error){notify(error.message)}}
  async function persist({render=true,announce=true}={}){const result=await api(`/api/paginas/${encodeURIComponent(pageId)}`,{method:"PUT",body:{section_page:state.page}});state.page=result.section_page;state.dirty=false;if(announce)notify("Cambios guardados.");if(render)shell();return result}
  async function save(){const button=root.querySelector("#se-save");button.disabled=true;if(demo){state.dirty=false;notify("Demostración: el cambio quedó aplicado durante esta vista.");return}try{await persist()}catch(error){button.disabled=false;notify(error.message)}}
  async function waitForJob(id){const limit=Date.now()+180000;while(Date.now()<limit){const{job}=await api(`/api/jobs/${encodeURIComponent(id)}`);if(job.status==="succeeded")return job;if(["failed","cancelled"].includes(job.status))throw new Error(job.error||"Shopify no pudo completar la publicación.");await new Promise((resolve)=>setTimeout(resolve,1000))}throw new Error("La publicación sigue en curso. Podés volver a Páginas y revisar su estado.")}
  async function publish(){const button=root.querySelector("#se-publish");button.disabled=true;button.textContent="Publicando…";try{if(state.dirty)await persist({render:false,announce:false});const{job}=await api(`/api/paginas/${encodeURIComponent(pageId)}/publicar`,{method:"POST"});const completed=await waitForJob(job.id);notify("Página publicada en Shopify.");button.textContent="Publicada";if(completed.result?.url)window.open(completed.result.url,"_blank","noopener")}catch(error){button.disabled=false;button.textContent="Publicar";notify(error.message)}}
  window.addEventListener("message",(event)=>{const frame=root.querySelector("#se-frame");if(event.source!==frame?.contentWindow||event.data?.type!=="tiq-section-select")return;selectItem(event.data.sectionId,event.data.blockId||null,event.data.outlineId||null)});
  async function start(){if(demo){const sample=await api("/section-page-demo-data");state.page=clone(sample.section_page);state.pageTitle=`${sample.titulo} · demostración`;state.registry=sample.registry||[]}else{if(!pageId)throw new Error("Falta el id de la página.");const[page,registry]=await Promise.all([api(`/api/paginas/${encodeURIComponent(pageId)}`),api("/api/section-registry")]);if(!page.data?.section_page)throw new Error("Esta página todavía no usa el sistema por secciones.");state.page=clone(page.data.section_page);state.pageTitle=page.titulo||state.page.productSnapshot?.title||"Página de producto";state.registry=registry.sections||[]}state.selectedSection=state.page.sections[0]?.id||null;if(state.selectedSection){state.expandedSections.add(state.selectedSection);const section=state.page.sections[0];expandAllOutline(section,definition(section)?.editor.outline)}status.hidden=true;root.hidden=false;shell()}
  start().catch((error)=>{status.textContent=error.message||"No se pudo abrir la página."});
}());
