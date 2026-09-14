(function(){
  "use strict";
  const root=document.getElementById("section-editor-root");
  const status=document.getElementById("section-editor-status");
  const toast=document.getElementById("section-editor-toast");
  const params=new URLSearchParams(location.search);
  document.body.classList.toggle("se-modal-host",params.get("modal")==="section-editor");
  const pageId=params.get("id");
  const demo=params.get("demo")==="1";
  const state={page:null,registry:[],shopFiles:[],shopFilesPageInfo:{hasNextPage:false,endCursor:null},language:"es",selectedSection:null,selectedBlock:null,selectedOutline:null,expandedSections:new Set(),expandedOutline:new Set(),mobile:false,fullPreview:false,dirty:false,savedFingerprint:"",previewTimer:null,previewRequest:0,previewAbort:null,libraryOpen:false,libraryCategory:"Todas",insertTarget:null,sectionAdding:false,sectionMenuId:null,past:[],future:[],historyKey:null,draggingSectionId:null,sectionDropIndex:null,keyboardDragging:false,pointerDrag:null,nativeSectionDrag:false};
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
      const error=new Error(data.error||`Error ${response.status}`);error.status=response.status;throw error;
    }
  }
  function notify(message){toast.textContent=message;toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,3500)}
  function id(prefix){return `${prefix}-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}`}
  function remember(key=null){if(key&&state.historyKey===key)return;state.past.push(clone(state.page));if(state.past.length>60)state.past.shift();state.future=[];state.historyKey=key}
  function finishHistory(){state.historyKey=null}
  function fingerprint(page){const copy=clone(page);delete copy.tree;return JSON.stringify(copy)}
  function syncDirty(){state.dirty=fingerprint(state.page)!==state.savedFingerprint;const saveButton=root.querySelector("#se-save");if(saveButton)saveButton.disabled=!state.dirty;const undoButton=root.querySelector("#se-undo");if(undoButton)undoButton.disabled=!state.past.length;const redoButton=root.querySelector("#se-redo");if(redoButton)redoButton.disabled=!state.future.length}
  function changed(){syncDirty()}
  function undo(){const previous=state.past.pop();if(!previous)return;state.future.push(clone(state.page));state.page=previous;finishHistory();syncDirty();shell()}
  function redo(){const next=state.future.pop();if(!next)return;state.past.push(clone(state.page));state.page=next;finishHistory();syncDirty();shell()}
  function definition(section){return state.registry.find((item)=>item.id===section.definition.id&&item.version===section.definition.version)}
  function findOutline(nodes,id,parents=[]){for(const node of nodes||[]){if(node.id===id)return{node,parents};const found=findOutline(node.children,id,[...parents,node]);if(found)return found}return null}
  function findBlockOutline(nodes,type,parents=[]){for(const node of nodes||[]){if(node.blockType===type)return{node,parents};const found=findBlockOutline(node.children,type,[...parents,node]);if(found)return found}return null}
  function selected(){const section=state.page.sections.find((item)=>item.id===state.selectedSection);if(!section)return{};const entry=definition(section);const block=section.instance.blocks.find((item)=>item.id===state.selectedBlock);const outline=findOutline(entry?.editor.outline,state.selectedOutline)?.node||null;return{section,block,outline,definition:entry}}
  function blockDefinition(entry,type){return entry?.editor.blocks?.find((item)=>item.type===type)||null}
  function blockLimit(entry,type){const limit=blockDefinition(entry,type)?.limit;return Number.isInteger(limit)?limit:null}
  function fieldValue(field,settings){const value=settings[field.id];return value==null?"":value}
  function copySlot(entry,scope,block,fieldId){if(scope==="block")return Boolean(entry?.copySlots?.blocks?.[block?.type]?.includes(fieldId));return Boolean(entry?.copySlots?.section?.includes(fieldId))}
  function contentSource(entry,scope,block,fieldId){if(scope==="block")return entry?.contentSources?.blocks?.[block?.type]?.[fieldId]||"template";return entry?.contentSources?.section?.[fieldId]||"template"}
  function lockedField(entry,scope,block,fieldId){if(scope==="block")return Boolean(entry?.lockedFields?.blocks?.[block?.type]?.includes(fieldId));return Boolean(entry?.lockedFields?.section?.includes(fieldId))}
  function fieldOrigin(entry,scope,block,fieldId){if(copySlot(entry,scope,block,fieldId))return{label:"IA",kind:"ai",title:"Este campo puede adaptarse al producto durante la generación."};const source=contentSource(entry,scope,block,fieldId);if(source==="shopify")return{label:"Shopify",kind:"shopify",title:"Este valor proviene del producto o de sus archivos de Shopify."};return{label:"Plantilla",kind:"template",title:"Este valor pertenece al diseño base de la sección."}}
  function sourceIcon(origin){return `<span class="se__origin-badge se__origin-badge--${origin.kind}" title="${origin.title}" aria-label="Origen: ${origin.label}">${origin.label}</span>`}
  function fieldHtml(field,settings,scope,locked=false,aiEnabled=false){
    // Sólo los campos declarados como copy editorial reciben el flujo de IA.
    // La primera versión reutilizable expone la descripción como slot estable;
    // los demás richtext conservan su formato manual.
    aiEnabled=Boolean(aiEnabled);
    const value=fieldValue(field,settings);const disabled=locked?' disabled aria-disabled="true"':'';const attr=`data-field="${esc(field.id)}" data-scope="${scope}" aria-label="${esc(field.label||field.id)}"${locked?' data-field-locked="true"':''}`;
    if(field.type==="checkbox")return `<label class="se__toggle"><input ${attr} type="checkbox" ${value?"checked":""}${disabled}><span aria-hidden="true"></span></label>`;
    if(field.type==="color")return `<div class="se__color"><input ${attr} type="color" value="${esc(value||"#ffffff")}" aria-label="${esc(field.label)}"${disabled}><input data-color-for="${esc(field.id)}" type="text" value="${esc(String(value||"#ffffff").toUpperCase())}" aria-label="Valor de ${esc(field.label)}"${disabled}></div>`;
    if(field.type==="select")return `<select ${attr}${disabled}>${(field.options||[]).map((o)=>`<option value="${esc(o.value)}" ${o.value===value?"selected":""}>${esc(o.label)}</option>`).join("")}</select>`;
    if(field.type==="range")return `<div class="se__range"><input ${attr} type="range" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"${disabled}><span class="se__unit"><input data-number-for="${esc(field.id)}" type="number" min="${field.min}" max="${field.max}" step="${field.step||1}" value="${esc(value)}"${disabled}><span>${esc(field.unit||"")}</span></span></div>`;
    if(field.type==="richtext")return `<div class="se__richtext"><div class="se__richbar" aria-label="Formato de texto"><button type="button" data-rich="spark" data-rich-field="${esc(field.id)}" data-rich-scope="${esc(scope)}" aria-label="Mejorar texto con IA" title="Generar una propuesta con IA"${aiEnabled&&!locked?"":" disabled"}>✦</button><button type="button" data-rich="paragraph" aria-label="Párrafo"${disabled}>Aa</button><button type="button" data-rich="bold" aria-label="Negrita"${disabled}><b>B</b></button><button type="button" data-rich="italic" aria-label="Cursiva"${disabled}><i>I</i></button><button type="button" data-rich="link" aria-label="Enlace"${disabled}>⌁</button><button type="button" data-rich="bullets" aria-label="Lista"${disabled}>☷</button><button type="button" data-rich="numbers" aria-label="Lista numerada"${disabled}>1☷</button></div><textarea ${attr}${disabled}>${esc(value)}</textarea></div>`;
    if(field.type==="textarea")return `<textarea ${attr}${disabled}>${esc(value)}</textarea>`;
    if(field.type==="image_picker"){const url=typeof value==="string"?value:value?.url||"";return `<div class="se__media-picker ${url?"has-image":""} ${locked?"is-locked":""}" data-media-drop data-media-field-id="${esc(field.id)}" data-media-scope="${scope}">${url?`<img src="${esc(url)}" alt="Vista previa de ${esc(field.label||"imagen")}">`:treeIcon("gallery")}<p>${locked?"Imagen vinculada al producto de Shopify":"Arrastra y suelta o haz clic para seleccionar"}${locked?"":"<br>una imagen"}</p><small>JPG, PNG, GIF, WEBP hasta 10MB</small><button type="button" class="se__media-select" data-media-menu aria-expanded="false"${disabled}>${treeIcon("upload")}<span>${url?"Cambiar imagen":"Seleccionar archivos"}</span></button><div class="se__media-menu" hidden><button type="button" data-media-upload${disabled}>${treeIcon("upload")}<span>Subir imagen</span></button><button type="button" data-media-gallery${disabled}>${treeIcon("gallery")}<span>Seleccionar de la galería</span></button></div><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-media-file hidden${disabled}></div>`}
    return `<input ${attr} type="${field.type==="url"?"url":"text"}" value="${esc(value)}" placeholder="${field.type==="url"?"Pega un enlace o busca":""}"${disabled}>`;
  }
  function fieldsHtml(fields,settings,scope,entry,block){return(fields||[]).map((field)=>{const stacked=["text","textarea","richtext","url"].includes(field.type);const sourced=stacked||field.type==="image_picker";const origin=fieldOrigin(entry,scope,block,field.id);const locked=lockedField(entry,scope,block,field.id);const aiEnabled=field.type==="richtext"&&copySlot(entry,scope,block,field.id);return `<div class="se__field ${stacked?"se__field--stacked":""} ${field.type==="image_picker"?"se__field--picker":""} ${locked?"is-locked":""}" data-content-origin="${origin.kind}"${locked?' data-field-locked="true"':''}><label>${esc(field.label||field.id)}${sourced?sourceIcon(origin):""}${locked?'<small class="se__locked-note">Controlado por Shopify</small>':""}</label>${fieldHtml(field,settings,scope,locked,aiEnabled)}</div>`}).join("")}
  function originLegend(){return `<div class="se__origin-legend" role="note" aria-label="Origen del contenido"><div><b>Origen del contenido</b><span class="se__origin-badge se__origin-badge--shopify">Shopify</span><span class="se__origin-badge se__origin-badge--ai">IA</span><span class="se__origin-badge se__origin-badge--template">Plantilla</span></div><small>Los cambios que hagas aquí son ediciones manuales y se guardan con esta página.</small></div>`}
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
      upload:'<path d="M8 11V3M5 6l3-3 3 3M3 10.5v2h10v-2"/>',
      duplicate:'<rect x="5" y="3" width="8" height="9" rx="1.5"/><path d="M3 6v6.5A1.5 1.5 0 0 0 4.5 14H10"/>',
      trash:'<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9M7 7v4M9 7v4"/>',
      search:'<circle cx="7" cy="7" r="4"/><path d="m10 10 3 3"/>',
      eye:'<path d="M1.8 8s2.2-3.5 6.2-3.5S14.2 8 14.2 8s-2.2 3.5-6.2 3.5S1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.6"/>',
      more:'<circle cx="3.2" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.8" cy="8" r=".8"/>',
      select:'<path d="M3 2.5v7l2.3-2.1L7 12l1.5-.7-1.8-4.6 3.2.3z"/>',
      desktop:'<rect x="2" y="3" width="12" height="8" rx="1.4"/><path d="M6 13h4M8 11v2"/>',
      mobile:'<rect x="5" y="2" width="6" height="12" rx="1.3"/><path d="M7.2 12h1.6"/>',
      fullscreen:'<path d="M5.5 3H3v2.5M10.5 3H13v2.5M5.5 13H3v-2.5M10.5 13H13v-2.5"/>',
      plus:'<path d="M8 3v10M3 8h10"/>'
    };
    return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths[type]||paths.block||paths.section}</svg>`;
  }
  function descendantBlockTypes(node,result=[]){if(node?.blockType&&!result.includes(node.blockType))result.push(node.blockType);for(const child of node?.children||[])descendantBlockTypes(child,result);return result}
  function blocksForOutline(node,section){const blocks=section.instance.blocks||[];return blocks.filter((block)=>block.parentId===node.id||(node.blockType&&block.type===node.blockType&&(!block.parentId||block.parentId===node.id)))}
  function outlineCount(nodes,section){return(nodes||[]).reduce((total,node)=>total+1+blocksForOutline(node,section).length+outlineCount(node.children,section),0)}
  function blockIdsForOutline(node,section){return blocksForOutline(node,section).map((block)=>block.id).concat((node.children||[]).flatMap((child)=>blockIdsForOutline(child,section)))}
  function insertSlotHtml({section,label,index=null}){const dropIndex=index===null?"":` data-section-drop-index="${index}"`;return `<div class="se__insert-slot se__section-insert-slot" data-insert-kind="section" data-insert-section="${esc(section?.id||"")}" data-insert-index="${index??""}"${dropIndex} role="separator"><button type="button" aria-label="${esc(label)}">${treeIcon("plus")}<span>${esc(label)}</span></button></div>`}
  function outlineHtml(section,nodes,level=0){const entry=definition(section);return(nodes||[]).map((node)=>{
    const key=`${section.id}:${node.id}`;const blocks=blocksForOutline(node,section);const expandable=Boolean(node.children||node.blockType);const expanded=state.expandedOutline.has(key);const active=section.id===state.selectedSection&&node.id===state.selectedOutline&&!state.selectedBlock;
    const row=expandable?`<button class="se__outline-row ${active?"is-active":""}" type="button" data-expand-outline="${esc(key)}" aria-expanded="${expanded}" aria-pressed="${active}"><span class="se__outline-chevron ${expanded?"is-expanded":""}">${treeIcon("chevron")}</span>${treeIcon(node.icon||"details")}<span>${esc(node.label)}</span>${blocks.length?`<small>${blocks.length}</small>`:""}</button>`:`<button class="se__outline-row ${active?"is-active":""}" type="button" data-section="${esc(section.id)}" data-outline="${esc(node.id)}" aria-pressed="${active}"><span class="se__outline-spacer"></span>${treeIcon(node.icon||"block")}<span>${esc(node.label)}</span></button>`;
    const blockRows=(items)=>items.map((block)=>`<button class="se__outline-row se__outline-row--block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" style="--outline-level:${level+1}" type="button" data-section="${esc(section.id)}" data-block="${esc(block.id)}" aria-pressed="${section.id===state.selectedSection&&block.id===state.selectedBlock}"><span class="se__outline-spacer"></span>${treeIcon("block")}<span>${esc(entry?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
    const children=node.children?outlineHtml(section,node.children,level+1)+blockRows(blocks.filter((block)=>block.parentId===node.id)):blockRows(blocks);
    return `<div class="se__outline-node" style="--outline-level:${level}">${row}<div class="se__outline-children" ${expanded?"":"hidden"}>${children}</div></div>`;
  }).join("")}
  function sectionInsertSlot(index){const sections=state.page.sections;if(index===0&&sectionOrderFloor()>0)return"";const previous=sections[index-1];const next=sections[index];const anchor=previous||next;const label=index===0?`Añadir sección antes de ${next?.label||"la primera sección"}`:index===sections.length?`Añadir sección después de ${previous?.label||"la última sección"}`:`Añadir sección entre ${previous.label} y ${next.label}`;return insertSlotHtml({kind:"section",section:anchor,label,index});}
  function sectionMenuHtml(section){const open=state.sectionMenuId===section.id;return `<div class="se__section-menu" data-section-menu-popover="${esc(section.id)}" role="menu" ${open?"":"hidden"}><button type="button" role="menuitem" data-section-action="select" data-section-id="${esc(section.id)}">Seleccionar</button><button type="button" role="menuitem" data-section-action="save" data-section-id="${esc(section.id)}" ${state.dirty?"":"disabled"}>Guardar cambios</button><button type="button" role="menuitem" data-section-action="duplicate" data-section-id="${esc(section.id)}">Duplicar sección</button><button type="button" role="menuitem" data-section-action="delete" data-section-id="${esc(section.id)}">Eliminar sección</button></div>`}
  function treeHtml(){
    return sectionInsertSlot(0)+state.page.sections.map((section,index)=>{
    const entry=definition(section);const active=section.id===state.selectedSection&&!state.selectedBlock&&!state.selectedOutline;const dragEnabled=entry?.capabilities?.protected!==true&&entry?.capabilities?.reorderable!==false&&index>=sectionOrderFloor();const dragAttrs=dragEnabled?` aria-roledescription="sortable" aria-describedby="se-section-drag-help" data-section-drag="${esc(section.id)}"`:` aria-disabled="true"`;
      const expanded=state.expandedSections.has(section.id);
      const contents=entry?.editor.outline?.length?outlineHtml(section,entry.editor.outline):section.instance.blocks.map((block)=>`<button class="se__outline-row se__outline-row--block ${section.id===state.selectedSection&&block.id===state.selectedBlock?"is-active":""}" data-section="${esc(section.id)}" data-block="${esc(block.id)}"><span class="se__outline-spacer"></span>${treeIcon("block")}<span>${esc(entry?.editor.blocks.find((item)=>item.type===block.type)?.name||block.type)}</span></button>`).join("");
      const count=entry?.editor.outline?.length?outlineCount(entry.editor.outline,section):section.instance.blocks.length;
      const rowActions=dragEnabled?`<div class="se__tree-actions"><button type="button" data-section-preview="${esc(section.id)}" aria-label="Vista previa de ${esc(section.label)}" title="Vista previa">${treeIcon("eye")}</button><button type="button" data-section-menu="${esc(section.id)}" aria-label="Más opciones de ${esc(section.label)}" title="Más opciones">${treeIcon("more")}</button>${sectionMenuHtml(section)}</div>`:"";
      const shellA11y=dragEnabled?` role="button" tabindex="0" aria-label="${esc(section.label)}" aria-pressed="${active}"`:"";
      const selectA11y=dragEnabled?` role="presentation" tabindex="-1"`:` role="button" tabindex="0"`;
      return `<div class="se__tree-section"><div class="se__tree-main ${active?"is-active":""}"><button class="se__tree-toggle ${expanded?"is-expanded":""}" type="button" data-expand-section="${esc(section.id)}" aria-expanded="${expanded}" aria-label="${expanded?"Contraer":"Expandir"} ${esc(section.label)}">${treeIcon("chevron")}</button><div class="se__tree-select-shell"${dragEnabled?` draggable="true"`:""}${dragAttrs}${shellA11y}><div class="se__tree-select"${dragEnabled?` draggable="true"`:""}${selectA11y} data-section="${esc(section.id)}" aria-pressed="${active}">${treeIcon("section")}<span>${esc(section.label)}</span><small>(${count})</small></div>${rowActions}</div></div><div class="se__tree-blocks" ${expanded?"":"hidden"}>${contents}</div></div>${sectionInsertSlot(index+1)}`;
    }).join("");
  }
  function sectionOrderFloor(){let floor=0;for(const section of state.page.sections){const entry=definition(section);if(entry?.capabilities?.protected===true||entry?.capabilities?.reorderable===false){floor++;continue}break}return floor}
  function sectionDropIndex(index){const floor=sectionOrderFloor();return Math.max(floor,Math.min(Number(index)||floor,state.page.sections.length))}
  function sectionMoveTarget(sectionId,targetIndex){
    const from=state.page.sections.findIndex((section)=>section.id===sectionId);const target=sectionDropIndex(targetIndex);const finalIndex=target>from?target-1:target;
    const floor=sectionOrderFloor();if(from<floor||finalIndex<floor||finalIndex>=state.page.sections.length||finalIndex===from)return null;
    const moving=state.page.sections[from];if(definition(moving)?.capabilities?.reorderable===false)return null;
    const start=Math.min(from,finalIndex);const end=Math.max(from,finalIndex);for(let index=start;index<=end;index++){if(index!==from&&definition(state.page.sections[index])?.capabilities?.reorderable===false)return null}
    return{from,finalIndex,target};
  }
  function syncSectionDragUI(){
    const dragging=Boolean(state.draggingSectionId);root.querySelector(".se")?.classList.toggle("is-section-dragging",dragging);
    root.querySelectorAll("[data-section-drag]").forEach((button)=>button.classList.toggle("is-dragging",button.dataset.sectionDrag===state.draggingSectionId));
    root.querySelectorAll("[data-section-drop-index]").forEach((slot)=>{const move=dragging&&sectionMoveTarget(state.draggingSectionId,Number(slot.dataset.sectionDropIndex));slot.classList.toggle("is-active",Boolean(move&&move.target===Number(slot.dataset.sectionDropIndex)))})
  }
  function clearSectionDrag(){const pointer=state.pointerDrag;state.draggingSectionId=null;state.sectionDropIndex=null;state.keyboardDragging=false;state.pointerDrag=null;state.nativeSectionDrag=false;if(pointer?.button&&pointer.pointerId!=null){try{if(pointer.button.hasPointerCapture?.(pointer.pointerId))pointer.button.releasePointerCapture(pointer.pointerId)}catch{}}syncSectionDragUI()}
  function beginSectionDrag(button,event){
    traceSectionDrag("dragstart",event);
    const sectionId=button.dataset.sectionDrag;const index=state.page.sections.findIndex((section)=>section.id===sectionId);if(!sectionId||index<sectionOrderFloor()||definition(state.page.sections[index])?.capabilities?.protected===true||definition(state.page.sections[index])?.capabilities?.reorderable===false){event.preventDefault();return}
    state.draggingSectionId=sectionId;state.nativeSectionDrag=true;state.pointerDrag=null;state.keyboardDragging=false;state.sectionDropIndex=null;if(event.dataTransfer){event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",sectionId)}syncSectionDragUI()
  }
  function isSpaceKey(event){return event.key===" "||event.key==="Spacebar"||event.key==="Space"||event.code==="Space"}
  function beginKeyboardSectionDrag(button,event){
    if(!isSpaceKey(event))return;const sectionId=button.dataset.sectionDrag;if(!sectionId)return;const from=state.page.sections.findIndex((section)=>section.id===sectionId);if(from<sectionOrderFloor()||definition(state.page.sections[from])?.capabilities?.protected===true||definition(state.page.sections[from])?.capabilities?.reorderable===false)return;event.preventDefault();state.draggingSectionId=sectionId;state.sectionDropIndex=from;state.keyboardDragging=true;syncSectionDragUI();notify("Sección seleccionada. Usá ↑ y ↓ para moverla; espacio para soltar.")
  }
  function moveKeyboardSection(event){
    if(!state.keyboardDragging)return false;const delta=event.key==="ArrowUp"?-1:event.key==="ArrowDown"?1:0;if(!delta)return false;event.preventDefault();const from=state.page.sections.findIndex((section)=>section.id===state.draggingSectionId);const current=sectionMoveTarget(state.draggingSectionId,state.sectionDropIndex)?.finalIndex??from;const finalIndex=Math.max(sectionOrderFloor(),Math.min(state.page.sections.length-1,current+delta));state.sectionDropIndex=finalIndex>from?finalIndex+1:finalIndex;syncSectionDragUI();return true
  }
  function reorderSectionToIndex(sectionId,finalIndex){
    const from=state.page.sections.findIndex((section)=>section.id===sectionId);if(from<0||from===finalIndex)return false;const target=finalIndex>from?finalIndex+1:finalIndex;const move=sectionMoveTarget(sectionId,target);if(!move)return false;
    remember();const[moving]=state.page.sections.splice(move.from,1);state.page.sections.splice(move.finalIndex,0,moving);state.selectedSection=moving.id;state.selectedBlock=null;state.selectedOutline=null;state.insertTarget=null;changed();shell();return true
  }
  function commitSectionDrop(targetIndex){
    const sectionId=state.draggingSectionId;const move=sectionId&&sectionMoveTarget(sectionId,targetIndex);if(!move){clearSectionDrag();return false}const moved=reorderSectionToIndex(sectionId,move.finalIndex);clearSectionDrag();if(moved)notify("Sección reordenada.");return moved
  }
  function previewSectionDrop(slot,event){if(!state.draggingSectionId)return;const targetIndex=Number(slot.dataset.sectionDropIndex);if(!sectionMoveTarget(state.draggingSectionId,targetIndex))return;event.preventDefault();state.sectionDropIndex=targetIndex;syncSectionDragUI()}
  function reorderSectionByDrop(slot,event){if(!state.draggingSectionId)return;event.preventDefault();commitSectionDrop(Number(slot.dataset.sectionDropIndex))}
  function sectionRowDropIndex(button,event){
    const targetIndex=state.page.sections.findIndex((section)=>section.id===button.dataset.sectionDrag);if(targetIndex<sectionOrderFloor())return null;
    const rect=button.getBoundingClientRect();return event.clientY<rect.top+rect.height/2?targetIndex:targetIndex+1
  }
  function reorderSectionByRow(button,event){
    if(!state.draggingSectionId||state.draggingSectionId===button.dataset.sectionDrag)return;
    const targetIndex=sectionRowDropIndex(button,event);if(targetIndex===null||!sectionMoveTarget(state.draggingSectionId,targetIndex))return;
    event.preventDefault();state.sectionDropIndex=targetIndex;syncSectionDragUI()
  }
  function dropSectionOnRow(button,event){
    if(!state.draggingSectionId||state.draggingSectionId===button.dataset.sectionDrag)return;
    const targetIndex=sectionRowDropIndex(button,event);if(targetIndex===null)return;event.preventDefault();commitSectionDrop(targetIndex)
  }
  function sectionDragTargetAtPoint(event){
    const direct=event.target?.closest?.("[data-section-drag]");
    if(direct&&root.contains(direct))return direct;
    const pointed=document.elementFromPoint?.(event.clientX,event.clientY)?.closest?.("[data-section-drag]");
    if(pointed&&root.contains(pointed))return pointed;
    return [...root.querySelectorAll("[data-section-drag]")].find((candidate)=>{const rect=candidate.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom})||null
  }
  function handleSectionDragOver(event){
    traceSectionDrag("dragover",event);
    if(!state.draggingSectionId)return;
    const row=sectionDragTargetAtPoint(event);
    if(row)traceSectionDrag(`dragover-target:${row.dataset.sectionDrag}`,event);
    if(row){reorderSectionByRow(row,event);return}
    const slot=event.target?.closest?.("[data-section-drop-index]");
    if(slot&&root.contains(slot))previewSectionDrop(slot,event)
  }
  function handleSectionDrop(event){
    traceSectionDrag("drop",event);
    if(!state.draggingSectionId)return;
    const row=sectionDragTargetAtPoint(event);
    if(row){dropSectionOnRow(row,event);return}
    const slot=event.target?.closest?.("[data-section-drop-index]");
    if(slot&&root.contains(slot))reorderSectionByDrop(slot,event)
  }
  function handleSectionDragEnd(event){
    traceSectionDrag("dragend",event);
    if(state.draggingSectionId){const targetIndex=Number.isInteger(state.sectionDropIndex)?state.sectionDropIndex:sectionDropIndexNearPoint(event);traceSectionDrag(`dragend-target:${targetIndex}`,event);if(Number.isInteger(targetIndex)){commitSectionDrop(targetIndex);return}}
    clearSectionDrag()
  }
  function sectionDropIndexNearPoint(event){
    const rows=[...root.querySelectorAll("[data-section-drag]")];const nearest=rows.map((row)=>{const rect=row.getBoundingClientRect();return{row,rect,distance:event.clientY<rect.top?rect.top-event.clientY:event.clientY>rect.bottom?event.clientY-rect.bottom:0}}).filter(({distance})=>distance<=12).sort((a,b)=>a.distance-b.distance)[0];
    if(!nearest)return null;const index=state.page.sections.findIndex((section)=>section.id===nearest.row.dataset.sectionDrag);const from=state.page.sections.findIndex((section)=>section.id===state.draggingSectionId);if(index>from)return index+1;if(index<from)return index;return event.clientY>=nearest.rect.top+nearest.rect.height/2?index+1:index
  }
  function handleSectionDragStart(event){
    const row=sectionDragTargetAtPoint(event);if(row)beginSectionDrag(row,event)
  }
  function pointerSectionTarget(event){
    const pointer=state.pointerDrag;let point=event;
    if(pointer?.coordinateSpace==="delta"&&pointer.button){const rect=pointer.button.getBoundingClientRect();point={...event,clientX:rect.left+pointer.startOffsetX+(event.clientX-pointer.startX),clientY:rect.top+pointer.startOffsetY+(event.clientY-pointer.startY)}}
    const tree=root.querySelector(".se__tree");const rect=tree?.getBoundingClientRect();if(!rect||point.clientX<rect.left||point.clientX>rect.right||point.clientY<rect.top||point.clientY>rect.bottom)return null;
    const rows=[...root.querySelectorAll("[data-section-drag]")];
    const row=rows.find((candidate)=>{const rect=candidate.getBoundingClientRect();return point.clientY>=rect.top&&point.clientY<=rect.bottom});
    if(row){const targetIndex=sectionRowDropIndex(row,point);if(targetIndex!==null&&sectionMoveTarget(state.draggingSectionId,targetIndex))return targetIndex}
    const slots=[...root.querySelectorAll("[data-section-drop-index]")];
    const slot=slots.find((candidate)=>{const rect=candidate.getBoundingClientRect();return point.clientY>=rect.top&&point.clientY<=rect.bottom});
    if(slot){const targetIndex=Number(slot.dataset.sectionDropIndex);if(sectionMoveTarget(state.draggingSectionId,targetIndex))return targetIndex}
    return null
  }
  function traceSectionDrag(name,event){
    console.debug("[section-drag]",JSON.stringify({name,type:event?.type,x:event?.clientX,y:event?.clientY,pointerId:event?.pointerId,button:event?.button,pointerType:event?.pointerType,target:event?.target?.tagName,dragging:state.draggingSectionId,dropIndex:state.sectionDropIndex}))
  }
  function beginPointerSectionDrag(button,event){
    traceSectionDrag("pointerdown",event);
    if(!button||event.button!==0||event.isPrimary===false||state.keyboardDragging||event.target.closest?.(".se__tree-actions"))return;
    const rect=button.getBoundingClientRect();const local=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
    state.pointerDrag={sectionId:button.dataset.sectionDrag,pointerId:event.pointerId,mouse:event.pointerType==="mouse",button,startX:event.clientX,startY:event.clientY,startOffsetX:local?event.clientX-rect.left:rect.width/2,startOffsetY:local?event.clientY-rect.top:rect.height/2,coordinateSpace:local?"local":"delta",active:false};
    try{button.setPointerCapture?.(event.pointerId)}catch{}
  }
  function beginMouseSectionDrag(button,event){
    traceSectionDrag("mousedown",event);
    if(!button||event.button!==0||state.keyboardDragging||state.pointerDrag||event.target.closest?.(".se__tree-actions"))return;
    const rect=button.getBoundingClientRect();const local=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
    state.pointerDrag={sectionId:button.dataset.sectionDrag,mouse:true,button,startX:event.clientX,startY:event.clientY,startOffsetX:local?event.clientX-rect.left:rect.width/2,startOffsetY:local?event.clientY-rect.top:rect.height/2,coordinateSpace:local?"local":"delta",active:false};
  }
  function handleSectionPointerDown(event){
    const button=event.target.closest?.("[data-section-drag]");if(button&&root.contains(button))beginPointerSectionDrag(button,event)
  }
  function handleSectionMouseDown(event){
    const button=event.target.closest?.("[data-section-drag]");if(button&&root.contains(button))beginMouseSectionDrag(button,event)
  }
  function handleSectionPointerMove(event){
    const pointer=state.pointerDrag;if(!pointer||event.pointerId!==pointer.pointerId||event.isPrimary===false)return;
    const moved=Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>=6;
    if(!pointer.active&&!moved)return;
    if(!pointer.active){pointer.active=true;state.draggingSectionId=pointer.sectionId;state.keyboardDragging=false;state.sectionDropIndex=null;event.preventDefault();syncSectionDragUI()}
    const targetIndex=pointerSectionTarget(event);if(targetIndex===null){state.sectionDropIndex=null;syncSectionDragUI();return}
    event.preventDefault();state.sectionDropIndex=targetIndex;syncSectionDragUI()
  }
  function handleSectionPointerUp(event){
    traceSectionDrag("pointerup",event);
    const pointer=state.pointerDrag;if(!pointer||event.pointerId!==pointer.pointerId||event.isPrimary===false)return;
    if(!pointer.active){
      const moved=Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>=6;
      if(!moved){
        // Pointer capture retargets the release to the sortable shell, not
        // the inner label. Use the id captured on pointerdown so a short
        // click still selects the section instead of being swallowed by drag.
        selectItem(pointer.sectionId,null,null);
        clearSectionDrag();return
      }
      state.draggingSectionId=pointer.sectionId;state.keyboardDragging=false;
    }
    const targetIndex=pointerSectionTarget(event);state.pointerDrag=null;if(targetIndex===null){clearSectionDrag();return}
    event.preventDefault();commitSectionDrop(targetIndex)
  }
  function handleSectionPointerCancel(event){
    if(state.nativeSectionDrag){state.pointerDrag=null;return}
    const pointer=state.pointerDrag;if(!pointer||event.pointerId!==pointer.pointerId)return;
    state.pointerDrag=null;clearSectionDrag()
  }
  function handleSectionMouseMove(event){
    const pointer=state.pointerDrag;if(!pointer?.mouse)return;
    const moved=Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>=6;
    if(!pointer.active&&!moved)return;
    if(!pointer.active){pointer.active=true;state.draggingSectionId=pointer.sectionId;state.keyboardDragging=false;state.sectionDropIndex=null;event.preventDefault();syncSectionDragUI()}
    const targetIndex=pointerSectionTarget(event);if(targetIndex===null){state.sectionDropIndex=null;syncSectionDragUI();return}
    event.preventDefault();state.sectionDropIndex=targetIndex;syncSectionDragUI()
  }
  function handleSectionMouseUp(event){
    traceSectionDrag("mouseup",event);
    const pointer=state.pointerDrag;if(!pointer?.mouse)return;
    if(!pointer.active){
      const moved=Math.hypot(event.clientX-pointer.startX,event.clientY-pointer.startY)>=6;
      if(!moved){
        // Mouse capture can retarget mouseup to the sortable shell as well.
        selectItem(pointer.sectionId,null,null);
        clearSectionDrag();return
      }
      state.draggingSectionId=pointer.sectionId;state.keyboardDragging=false;
    }
    const targetIndex=pointerSectionTarget(event);state.pointerDrag=null;if(targetIndex===null){clearSectionDrag();return}
    event.preventDefault();commitSectionDrop(targetIndex)
  }
  function handleSectionKeydown(event){
    const button=event.target.closest?.("[data-section-drag]");if(!button)return;
    if(state.keyboardDragging&&event.key==="Escape"){event.preventDefault();clearSectionDrag();return}
    if(state.keyboardDragging&&["ArrowUp","ArrowDown"].includes(event.key)){moveKeyboardSection(event);return}
    if(state.keyboardDragging&&(isSpaceKey(event)||event.key==="Enter")){event.preventDefault();commitSectionDrop(state.sectionDropIndex);return}
    if(!state.keyboardDragging&&event.key==="Enter"){event.preventDefault();selectItem(button.dataset.sectionDrag,null,null);return}
    beginKeyboardSectionDrag(button,event)
  }
  function sectionCanMove(section,finalIndex){const index=state.page.sections.indexOf(section);if(index<0||finalIndex<0||finalIndex>=state.page.sections.length)return false;const target=finalIndex>index?finalIndex+1:finalIndex;return Boolean(sectionMoveTarget(section.id,target))}
  function moveSelectedSection(direction){const {section,definition:entry}=selected();if(!section||entry?.capabilities?.reorderable===false)return;const index=state.page.sections.indexOf(section);const nextIndex=index+direction;if(index<0||nextIndex<0||nextIndex>=state.page.sections.length)return;if(!reorderSectionToIndex(section.id,nextIndex))notify("Esa sección está protegida y no se puede atravesar.")}
  function inspectorHtml(){
    const {section,block,outline,definition:entry}=selected();if(!section||!entry)return`<div class="se__notice">Seleccioná una sección.</div>`;
    const title=block?(entry.editor.blocks.find((item)=>item.type===block.type)?.name||block.type):(outline?.label||section.label);
    const sectionFields=entry.editor.groups.flatMap((group)=>group.fields);const outlineFields=outline?.fields?sectionFields.filter((field)=>outline.fields.includes(field.id)):[];
    const body=originLegend()+(block?`<section class="se__group">${fieldsHtml(entry.editor.blocks.find((item)=>item.type===block.type)?.fields,block.settings,"block",entry,block)}</section>`:outline?`<section class="se__group">${fieldsHtml(outlineFields,section.instance.settings,"section",entry,null)}</section>`:entry.editor.groups.map((group)=>`<section class="se__group"><h3>${esc(group.label)}</h3>${fieldsHtml(group.fields,section.instance.settings,"section",entry,null)}</section>`).join(""));
    const canDuplicate=entry.capabilities?.duplicable!==false;const canDelete=entry.capabilities?.deletable!==false&&state.page.sections.length>1;
     const canMove=entry.capabilities?.reorderable!==false;const sectionIndex=state.page.sections.indexOf(section);const sectionActions=!block&&!outline?`<div class="se__capabilities"><b>Capacidades de esta sección</b><span>${entry.capabilities?.editableStructure?"Estructura editable":"Diseño protegido"}</span><p>${entry.capabilities?.editableStructure?"Podés editar sus elementos y reordenar la sección completa desde la barra lateral.":"Podés editar contenido y apariencia sin alterar su composición aprobada."}</p></div>${canMove?`<div class="se__section-move" aria-label="Mover sección"><button type="button" data-section-up ${sectionCanMove(section,sectionIndex-1)?"":"disabled"}>↑ <span>Subir sección</span></button><button type="button" data-section-down ${sectionCanMove(section,sectionIndex+1)?"":"disabled"}>↓ <span>Bajar sección</span></button></div>`:""}<button type="button" class="se__duplicate" ${canDuplicate?"":"disabled"}>${treeIcon("duplicate")}<span>Duplicar sección</span></button><button type="button" class="se__delete" ${canDelete?"":"disabled"}>${treeIcon("trash")}<span>Eliminar sección</span></button>`:"";
    const blockActions=block&&entry.capabilities?.editableStructure?`<div class="se__block-actions" aria-label="Acciones del bloque"><button type="button" data-block-duplicate>${treeIcon("duplicate")}<span>Duplicar</span></button><button type="button" data-block-up aria-label="Subir bloque">↑</button><button type="button" data-block-down aria-label="Bajar bloque">↓</button><button type="button" data-block-delete class="is-danger">${treeIcon("trash")}<span>Eliminar</span></button></div>`:"";
     return `<div class="se__inspector-head"><span class="se__section-icon" aria-hidden="true"></span><b>${esc(title)}</b><button type="button" class="se__head-action" data-inspector-menu aria-label="Más opciones">•••</button>${sectionMenuHtml(section)}<button type="button" class="se__head-action" id="se-inspector-close" aria-label="Cerrar inspector">×</button></div>${body}${blockActions}${sectionActions}`;
  }
  function setImageValue(scope,fieldId,url,selection={}){const sectionId=selection.sectionId!==undefined?selection.sectionId:state.selectedSection;const blockId=selection.blockId!==undefined?selection.blockId:state.selectedBlock;const section=state.page.sections.find((item)=>item.id===sectionId);const block=section?.instance.blocks?.find((item)=>item.id===blockId);const target=scope==="block"?block?.settings:section?.instance.settings;if(!target||!section)return;remember(`${section.id}:${block?.id||"section"}:${fieldId}`);target[fieldId]=url;finishHistory();changed();renderSelection();clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,80)}
  function readImage(file){return new Promise((resolve,reject)=>{if(!/^image\/(jpeg|png|webp|gif)$/i.test(file?.type||""))return reject(new Error("Elegí una imagen JPG, PNG, WEBP o GIF."));if(file.size>10*1024*1024)return reject(new Error("La imagen supera el límite de 10 MB."));const reader=new FileReader();reader.onerror=()=>reject(new Error("No se pudo leer la imagen."));reader.onload=()=>resolve(String(reader.result||"").split(",")[1]||"");reader.readAsDataURL(file)})}
  async function uploadImage(file,picker){if(demo||!pageId)return notify("La carga desde el dispositivo está disponible en una página real.");const fieldId=picker.dataset.mediaFieldId;const scope=picker.dataset.mediaScope;const selection={sectionId:state.selectedSection,blockId:state.selectedBlock};picker.classList.add("is-busy");try{const base64=await readImage(file);const uploaded=await api(`/api/paginas/${encodeURIComponent(pageId)}/imagenes`,{method:"POST",body:{nombre:file.name,mime:file.type,base64}});state.shopFiles=[{id:uploaded.id||uploaded.url,url:uploaded.url,alt:uploaded.alt||file.name},...state.shopFiles.filter((item)=>item.url!==uploaded.url)];setImageValue(scope,fieldId,uploaded.url,selection);notify("Imagen subida a Shopify Files y seleccionada.")}catch(error){notify(error.message)}finally{picker.classList.remove("is-busy")}}
  function closeGallery(){root.querySelector(".se__media-backdrop")?.remove()}
  async function loadShopFiles(after=null){const query=after?`?after=${encodeURIComponent(after)}`:"";const library=await api(`/api/paginas/${encodeURIComponent(pageId)}/imagenes${query}`);const incoming=library.items||[];state.shopFiles=after?[...state.shopFiles,...incoming].filter((item,index,items)=>item?.url&&items.findIndex((candidate)=>candidate.url===item.url)===index):incoming;state.shopFilesPageInfo=library.pageInfo||{hasNextPage:false,endCursor:null}}
  async function openGallery(picker,{refresh=true}={}){closeGallery();const fieldId=picker.dataset.mediaFieldId;const scope=picker.dataset.mediaScope;const selection={sectionId:state.selectedSection,blockId:state.selectedBlock};const selectedSection=state.page.sections.find((item)=>item.id===selection.sectionId);const selectedBlock=selectedSection?.instance.blocks?.find((item)=>item.id===selection.blockId);const current=scope==="block"?selectedBlock?.settings?.[fieldId]:selectedSection?.instance.settings?.[fieldId];if(!demo&&pageId&&refresh){try{await loadShopFiles()}catch(error){return notify(error.message)}}const media=[...(state.page.productSnapshot?.media||[]),...state.shopFiles].filter((item,index,items)=>item?.url&&items.findIndex((candidate)=>candidate.url===item.url)===index);root.insertAdjacentHTML("beforeend",`<div class="se__media-backdrop" data-media-close><section class="se__media-dialog" role="dialog" aria-modal="true" aria-labelledby="se-media-title"><header><div><h2 id="se-media-title">Seleccionar de la galería</h2><p>Imágenes del producto y archivos de Shopify</p></div><button type="button" data-media-close aria-label="Cerrar">×</button></header><div class="se__media-grid">${media.length?media.map((item,index)=>`<button type="button" class="se__media-option ${item.url===current?"is-selected":""}" data-media-url="${esc(item.url)}"><img src="${esc(item.url)}" alt="${esc(item.alt||`Imagen ${index+1}`)}"><span>${item.url===current?"Seleccionada":esc(item.alt||`Imagen ${index+1}`)}</span></button>`).join(""):`<div class="se__media-empty">La tienda todavía no tiene imágenes disponibles.</div>`}</div><footer><s-button data-media-close>Cancelar</s-button>${state.shopFilesPageInfo.hasNextPage?`<s-button data-gallery-more>Cargar más</s-button>`:""}<s-button variant="primary" data-gallery-upload>Subir una imagen</s-button></footer></section></div>`);const backdrop=root.querySelector(".se__media-backdrop");backdrop.onclick=(event)=>{if(event.target===backdrop||event.target.closest("[data-media-close]"))closeGallery()};backdrop.querySelectorAll("[data-media-url]").forEach((button)=>button.onclick=()=>{setImageValue(scope,fieldId,button.dataset.mediaUrl,selection);closeGallery()});backdrop.querySelector("[data-gallery-upload]").onclick=()=>{closeGallery();picker.querySelector("[data-media-file]").click()};const more=backdrop.querySelector("[data-gallery-more]");if(more)more.onclick=async()=>{more.setAttribute("disabled","");try{await loadShopFiles(state.shopFilesPageInfo.endCursor);await openGallery(picker,{refresh:false})}catch(error){more.removeAttribute("disabled");notify(error.message)}}}
  function formatRichText(button){const textarea=button.closest(".se__richtext")?.querySelector("textarea[data-field]");if(!textarea)return;const start=textarea.selectionStart;const end=textarea.selectionEnd;const selectedText=textarea.value.slice(start,end);if(!selectedText)return notify("Seleccioná el texto que querés formatear.");let replacement=selectedText;const type=button.dataset.rich;if(type==="paragraph")replacement=`<p>${selectedText}</p>`;if(type==="bold")replacement=`<strong>${selectedText}</strong>`;if(type==="italic")replacement=`<em>${selectedText}</em>`;if(type==="link")replacement=`<a href="#">${selectedText}</a>`;if(type==="bullets"||type==="numbers"){const tag=type==="bullets"?"ul":"ol";const items=selectedText.split(/\r?\n/).filter(Boolean).map((line)=>`<li>${line}</li>`).join("");replacement=`<${tag}>${items}</${tag}>`}textarea.setRangeText(replacement,start,end,"select");update(textarea);textarea.focus()}
  function aiStorageKey(sectionId,blockId,fieldId){return `tiq-section-ai:${pageId||"demo"}:${sectionId}:${blockId||"section"}:${fieldId}`}
  function openAiWriter(button){
    const {section,block,definition:entry}=selected();const fieldId=button.dataset.richField;const scope=button.dataset.richScope||"section";const fields=scope==="block"?(entry?.editor.blocks?.find((item)=>item.type===block?.type)?.fields||[]):entry?.editor.groups?.flatMap((group)=>group.fields)||[];const field=fields.find((item)=>item.id===fieldId);const settings=scope==="block"?block?.settings:section?.instance?.settings;if(!section||!field||!settings||!copySlot(entry,scope,block,fieldId))return;
    root.querySelector("[data-ai-modal]")?.remove();
    root.insertAdjacentHTML("beforeend",`<div class="se__ai-backdrop" data-ai-modal><section class="se__ai-dialog" role="dialog" aria-modal="true" aria-labelledby="se-ai-title"><header><div><h2 id="se-ai-title">Mejorar texto con IA</h2><p>${esc(field.label||"Contenido editorial")} · ${esc(section.label)}</p></div><button type="button" data-ai-close aria-label="Cerrar">×</button></header><div class="se__ai-body"><label>Objetivo<select data-ai-mode><option value="rewrite">Mejorar claridad y conversión</option><option value="shorter">Hacer más breve</option><option value="longer">Ampliar sin repetir</option></select></label><label>Indicaciones opcionales<textarea data-ai-instructions placeholder="Ej.: tono directo y profesional para hombres mayores de 40 años"></textarea></label><div class="se__ai-result" data-ai-result-wrap><span>Texto actual</span><div data-ai-original>${esc(String(settings[fieldId]||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()||"(vacío)")}</div></div><div class="se__ai-result se__ai-result--new" data-ai-new-wrap hidden><span>Propuesta de IA</span><textarea data-ai-new readonly></textarea></div></div><footer><button type="button" data-ai-close>Cancelar</button><button type="button" class="se__ai-submit" data-ai-submit>Generar propuesta</button><button type="button" class="se__ai-apply" data-ai-apply hidden>Usar este texto</button></footer></section></div>`);
    const modal=root.querySelector("[data-ai-modal]"),submit=modal.querySelector("[data-ai-submit]"),apply=modal.querySelector("[data-ai-apply]"),newWrap=modal.querySelector("[data-ai-new-wrap]"),newText=modal.querySelector("[data-ai-new]"),key=aiStorageKey(section.id,block?.id,fieldId);let result="";
    const close=()=>modal.remove();modal.querySelectorAll("[data-ai-close]").forEach((item)=>item.onclick=close);modal.onclick=(event)=>{if(event.target===modal)close()};
    submit.onclick=async()=>{submit.disabled=true;submit.textContent="Generando…";const instructions=modal.querySelector("[data-ai-instructions]").value;const mode=modal.querySelector("[data-ai-mode]").value;let pending=null;try{try{pending=JSON.parse(localStorage.getItem(key)||"null")}catch{}if(!pending?.requestId){const requestId=globalThis.crypto?.randomUUID?.();if(!requestId)throw new Error("El navegador no permite iniciar una edición segura.");pending={requestId,mode,instructions};localStorage.setItem(key,JSON.stringify(pending))}if(!pending.jobId){const response=await api("/api/texto/editar",{method:"POST",body:{texto:String(settings[fieldId]||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim(),instrucciones:pending.instructions||"",modo:pending.mode||"rewrite",idioma:state.language||"es",contexto:JSON.stringify({producto:state.page.productSnapshot?.title||"Producto",descripcion:state.page.productSnapshot?.description||"",seccion:section.label,campo:field.label}),page_id:pageId,section_id:section.id,block_id:block?.id||null,field_id:fieldId,request_id:pending.requestId}});pending={...pending,jobId:response.job.id};localStorage.setItem(key,JSON.stringify(pending))}const completed=await waitForJob(pending.jobId);result=String(completed.result?.texto||"").trim();if(!result)throw new Error("La IA no devolvió una propuesta.");localStorage.removeItem(key);newText.value=result;newWrap.hidden=false;submit.hidden=true;apply.hidden=false;modal.querySelector("[data-ai-instructions]").disabled=true;modal.querySelector("[data-ai-mode]").disabled=true}catch(error){if(error.status>=400&&error.status<500)localStorage.removeItem(key);submit.disabled=false;submit.textContent="Generar propuesta";notify(error.message)}};
    apply.onclick=()=>{remember(`${section.id}:${block?.id||"section"}:${fieldId}`);settings[fieldId]=`<p>${esc(result)}</p>`;changed();close();shell();notify("Propuesta aplicada al borrador. Guardá para conservarla.")};modal.querySelector("[data-ai-instructions]")?.focus();
  }
  function bindInspector(){
    root.querySelectorAll("[data-field]").forEach((control)=>{
      const textLike=control.tagName==="TEXTAREA"||["text","url"].includes(control.type);
      const event=control.type==="range"||textLike?"input":"change";
      control.addEventListener(event,()=>update(control));
      if(textLike){
        // Mantener el borrador sincronizado mientras se escribe evita perder
        // el valor cuando la vista previa vuelve a renderizarse.
        control.addEventListener("change",()=>{update(control);finishHistory()});
      }
      if(control.type==="range"){control.addEventListener("change",finishHistory);control.addEventListener("blur",finishHistory)}
    });
    root.querySelectorAll("[data-number-for]").forEach((control)=>control.addEventListener("change",()=>{const range=root.querySelector(`[data-field="${CSS.escape(control.dataset.numberFor)}"]`);range.value=control.value;update(range)}));
    root.querySelectorAll("[data-color-for]").forEach((control)=>control.addEventListener("change",()=>{const picker=root.querySelector(`[data-field="${CSS.escape(control.dataset.colorFor)}"]`);if(/^#[0-9a-f]{6}$/i.test(control.value)){picker.value=control.value;update(picker)}}));
    root.querySelectorAll("input[type=color][data-field]").forEach((control)=>control.addEventListener("input",()=>{const text=root.querySelector(`[data-color-for="${CSS.escape(control.dataset.field)}"]`);if(text)text.value=control.value.toUpperCase()}));
    root.querySelectorAll("[data-media-menu]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();const menu=button.parentElement.querySelector(".se__media-menu");const open=menu.hidden;root.querySelectorAll(".se__media-menu").forEach((item)=>item.hidden=true);menu.hidden=!open;button.setAttribute("aria-expanded",String(open))});
    root.querySelectorAll("[data-media-upload]").forEach((button)=>button.onclick=()=>button.closest("[data-media-drop]").querySelector("[data-media-file]").click());
    root.querySelectorAll("[data-media-gallery]").forEach((button)=>button.onclick=()=>openGallery(button.closest("[data-media-drop]")));
    root.querySelectorAll("[data-media-file]").forEach((input)=>input.onchange=()=>{if(input.files?.[0])uploadImage(input.files[0],input.closest("[data-media-drop]"))});
    root.querySelectorAll("[data-media-drop]").forEach((picker)=>{picker.ondragover=(event)=>{if(picker.classList.contains("is-locked"))return;event.preventDefault();picker.classList.add("is-dragging")};picker.ondragleave=()=>picker.classList.remove("is-dragging");picker.ondrop=(event)=>{event.preventDefault();picker.classList.remove("is-dragging");if(picker.classList.contains("is-locked"))return;if(event.dataTransfer?.files?.[0])uploadImage(event.dataTransfer.files[0],picker)}});
    root.querySelectorAll("[data-rich]:not([disabled])").forEach((button)=>button.onclick=()=>button.dataset.rich==="spark"?openAiWriter(button):formatRichText(button));
     document.onclick=(event)=>{root.querySelectorAll(".se__media-menu").forEach((menu)=>menu.hidden=true);if(!event.target.closest?.(".se__actions-menu")){const actions=root.querySelector(".se__actions-popover");if(actions)actions.hidden=true}if(state.sectionMenuId&&!event.target.closest?.("[data-section-menu],[data-inspector-menu],[data-section-menu-popover]")){state.sectionMenuId=null;renderSelection()}};
    const close=root.querySelector("#se-inspector-close");if(close)close.onclick=()=>root.querySelector(".se__panel--right").classList.add("is-closed");
    const duplicate=root.querySelector(".se__duplicate");if(duplicate&&!duplicate.disabled)duplicate.onclick=duplicateSelectedSection;
    const remove=root.querySelector(".se__delete");if(remove&&!remove.disabled)remove.onclick=deleteSelectedSection;
    const duplicateBlock=root.querySelector("[data-block-duplicate]");if(duplicateBlock)duplicateBlock.onclick=duplicateSelectedBlock;
    const moveUp=root.querySelector("[data-block-up]");if(moveUp)moveUp.onclick=()=>moveSelectedBlock(-1);
    const moveDown=root.querySelector("[data-block-down]");if(moveDown)moveDown.onclick=()=>moveSelectedBlock(1);
    const deleteBlock=root.querySelector("[data-block-delete]");if(deleteBlock)deleteBlock.onclick=deleteSelectedBlock;
    const sectionUp=root.querySelector("[data-section-up]");if(sectionUp)sectionUp.onclick=()=>moveSelectedSection(-1);
    const sectionDown=root.querySelector("[data-section-down]");if(sectionDown)sectionDown.onclick=()=>moveSelectedSection(1);
  }
  function renderSelection(){
    const tree=root.querySelector(".se__tree");const inspector=root.querySelector(".se__inspector");if(tree)tree.innerHTML=treeHtml();if(inspector)inspector.innerHTML=inspectorHtml();
    root.querySelector(".se__panel--right")?.classList.remove("is-closed");
    bindTree();
    bindInspector();
    requestAnimationFrame(()=>{tree?.querySelector(".is-active")?.scrollIntoView({block:"nearest"});focusPreview()});
  }
  function focusPreview(){const frame=root.querySelector("#se-frame");const doc=frame?.contentDocument;if(!doc||!state.selectedSection)return;const section=doc.querySelector(`[data-tiq-section-id="${CSS.escape(state.selectedSection)}"]`);if(!section)return;let target=section;if(state.selectedBlock)target=section.querySelector(`[data-tiq-block-id="${CSS.escape(state.selectedBlock)}"]`)||section;if(state.selectedOutline)target=section.querySelector(`[data-tiq-outline-id="${CSS.escape(state.selectedOutline)}"]`)||section;target.scrollIntoView({block:"center",behavior:"smooth"})}
  function applySectionMenuAction(button){const sectionId=button.dataset.sectionId;const section=state.page.sections.find((item)=>item.id===sectionId);if(!section)return;const action=button.dataset.sectionAction;state.sectionMenuId=null;state.selectedSection=sectionId;state.selectedBlock=null;state.selectedOutline=null;if(action==="select"){renderSelection();return}if(action==="save"){save();return}if(action==="duplicate"){duplicateSelectedSection();return}if(action==="delete"){deleteSelectedSection();return}renderSelection()}
  function bindTree(){
    const tree=root.querySelector(".se__tree");
    if(tree)tree.onclick=(event)=>{
      const button=event.target.closest?.("[data-section]");
      if(!button||!tree.contains(button)||event.target.closest?.("[data-section-menu],[data-section-preview]"))return;
      selectItem(button.dataset.section,button.dataset.block||null,button.dataset.outline||null);
    };
    root.querySelectorAll("[data-expand-section]").forEach((button)=>button.onclick=()=>{const id=button.dataset.expandSection;if(state.expandedSections.has(id))state.expandedSections.delete(id);else state.expandedSections.add(id);renderSelection()});
    root.querySelectorAll("[data-expand-outline]").forEach((button)=>button.onclick=()=>{const key=button.dataset.expandOutline;if(state.expandedOutline.has(key))state.expandedOutline.delete(key);else state.expandedOutline.add(key);renderSelection()});
    root.querySelectorAll("[data-section-preview]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();selectItem(button.dataset.sectionPreview,null,null)});
    root.querySelectorAll("[data-section-menu],[data-inspector-menu]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();const id=button.dataset.sectionMenu||state.selectedSection;if(!id)return;state.sectionMenuId=state.sectionMenuId===id?null:id;renderSelection()});
    root.querySelectorAll("[data-section-action]").forEach((button)=>button.onclick=(event)=>{event.stopPropagation();applySectionMenuAction(button)});
    bindDynamicTreeInteractions();
  }
  function bindDynamicTreeInteractions(){
    root.querySelectorAll("[data-section-drag]").forEach((button)=>{
      button.addEventListener("dragstart",(event)=>beginSectionDrag(button,event));
      button.addEventListener("dragover",(event)=>reorderSectionByRow(button,event));
      button.addEventListener("drop",(event)=>dropSectionOnRow(button,event));
      button.addEventListener("dragend",handleSectionDragEnd);
      button.addEventListener("pointerdown",handleSectionPointerDown);
      button.addEventListener("mousedown",handleSectionMouseDown);
    });
    root.querySelectorAll("[data-section-drop-index]").forEach((slot)=>{
      slot.addEventListener("dragover",(event)=>previewSectionDrop(slot,event));
      slot.addEventListener("drop",(event)=>reorderSectionByDrop(slot,event));
    });
    root.querySelectorAll('[data-insert-kind="section"]').forEach((slot)=>slot.querySelector("button").onclick=()=>openSectionLibrary(Number(slot.dataset.insertIndex)));
  }
  function expandOutlinePath(section,nodeId){const entry=definition(section);const found=findOutline(entry?.editor.outline,nodeId);for(const parent of found?.parents||[])state.expandedOutline.add(`${section.id}:${parent.id}`)}
  function expandAllOutline(section,nodes){for(const node of nodes||[]){if(node.children||node.blockType)state.expandedOutline.add(`${section.id}:${node.id}`);expandAllOutline(section,node.children)}}
  function selectItem(sectionId,blockId,outlineId){const section=state.page.sections.find((item)=>item.id===sectionId);if(blockId||outlineId)state.expandedSections.add(sectionId);if(blockId&&section){const block=section.instance.blocks.find((item)=>item.id===blockId);const found=findBlockOutline(definition(section)?.editor.outline,block?.type);for(const parent of found?.parents||[])state.expandedOutline.add(`${section.id}:${parent.id}`);if(found)state.expandedOutline.add(`${section.id}:${found.node.id}`)}if(outlineId&&section)expandOutlinePath(section,outlineId);if(state.selectedSection===sectionId&&state.selectedBlock===(blockId||null)&&state.selectedOutline===(outlineId||null))return;state.selectedSection=sectionId;state.selectedBlock=blockId||null;state.selectedOutline=outlineId||null;renderSelection()}
  function productNumericId(){const value=String(state.page?.productId||state.page?.productSnapshot?.id||"");const id=value.split("/").pop();return /^\d+$/.test(id)?id:""}
  function availableSections(){return state.registry.filter((entry)=>entry.catalog?.scale!=="block"&&(entry.capabilities?.allowMultipleInstances!==false||!state.page.sections.some((section)=>section.definition.id===entry.id&&section.definition.version===entry.version)))}
  function libraryPreview(entry){const thumbnail=entry.catalog?.thumbnail;const product=thumbnail==="product-information";const testimonials=thumbnail==="testimonials";const timeline=thumbnail==="image-timeline";const spotlight=thumbnail==="benefits-spotlight";const benefits=thumbnail==="image-benefits";return `<span class="se__library-preview ${product?"is-product":testimonials?"is-testimonials":timeline?"is-timeline":spotlight?"is-benefits-spotlight":benefits?"is-benefits":"is-image-text"}" aria-hidden="true"><i></i><b></b><em></em><small></small></span>`}
  function libraryHtml(){if(!state.libraryOpen)return"";const entries=availableSections();const categories=[...new Set(entries.map((entry)=>entry.catalog?.category).filter(Boolean))];const target=state.insertTarget?.kind==="section"&&Number.isInteger(state.insertTarget.index)?`<p class="se__library-context">Se insertará en la posición ${state.insertTarget.index} de la página.</p>`:"";return `<div class="se__library-backdrop" data-library-backdrop><section class="se__library-dialog" role="dialog" aria-modal="true" aria-labelledby="se-library-title"><header><div><h2 id="se-library-title">Añadir sección</h2><p>Composiciones completas preparadas para escritorio y móvil.</p>${target}</div><button type="button" data-library-close aria-label="Cerrar">×</button></header><div class="se__library-layout"><aside><b>Categorías</b><button type="button" data-library-category="Todas" class="${state.libraryCategory==="Todas"?"is-active":""}">Todas</button>${categories.map((category)=>`<button type="button" data-library-category="${esc(category)}" class="${state.libraryCategory===category?"is-active":""}">${esc(category)}</button>`).join("")}</aside><div class="se__library-content"><label class="se__library-search">${treeIcon("search")}<input type="search" placeholder="Buscar secciones" data-library-search></label><div class="se__library-grid">${entries.map((entry)=>`<button type="button" class="se__library-card" data-add-definition="${esc(entry.id)}" data-add-version="${entry.version}" data-category="${esc(entry.catalog?.category||"")}" data-search-value="${esc(`${entry.name} ${entry.catalog?.category||""}`.toLowerCase())}" ${state.sectionAdding?"disabled":""}>${libraryPreview(entry)}<span><b>${esc(entry.name)}</b><small>${esc(entry.catalog?.description||"")}</small></span></button>`).join("")}</div><p class="se__library-empty" data-library-empty hidden>No encontramos secciones con esos filtros.</p></div></div></section></div>`}
  function filterLibrary(){const search=root.querySelector("[data-library-search]");const query=search?.value.trim().toLowerCase()||"";let visible=0;root.querySelectorAll("[data-search-value]").forEach((card)=>{const categoryMatches=state.libraryCategory==="Todas"||card.dataset.category===state.libraryCategory;const searchMatches=!query||card.dataset.searchValue.includes(query);card.hidden=!(categoryMatches&&searchMatches);if(!card.hidden)visible+=1});const empty=root.querySelector("[data-library-empty]");if(empty)empty.hidden=visible!==0}
  function openSectionLibrary(index=state.page.sections.length){const nextIndex=Number.isInteger(index)?Math.max(sectionOrderFloor(),Math.min(index,state.page.sections.length)):state.page.sections.length;state.insertTarget={kind:"section",index:nextIndex};state.libraryOpen=true;state.libraryCategory="Todas";state.blockLibraryOpen=false;shell();requestAnimationFrame(()=>root.querySelector("[data-library-search]")?.focus())}
  async function seedFor(entry){const path=demo?"/section-page-demo-section-instance":`/api/paginas/${encodeURIComponent(pageId)}/sections/instantiate`;const occurrence=state.page.sections.filter((section)=>section.definition?.id===entry.id&&Number(section.definition?.version)===Number(entry.version)).length+1;const result=await api(path,{method:"POST",body:{definition:{id:entry.id,version:entry.version},occurrence}});const instance=clone(result.instance);for(const block of instance.blocks||[])block.id=id("block");return instance}
  async function addSection(entry){if(state.sectionAdding)return;state.sectionAdding=true;shell();try{const instance=await seedFor(entry);remember();const sectionId=id("section");const section={id:sectionId,label:entry.name,definition:{id:entry.id,version:entry.version,sourceSha256:entry.sourceSha256},instance};const requestedIndex=state.insertTarget?.kind==="section"?Number(state.insertTarget.index):state.page.sections.length;const floor=sectionOrderFloor();const index=Math.max(floor,Math.min(Number.isInteger(requestedIndex)?requestedIndex:state.page.sections.length,state.page.sections.length));state.page.sections.splice(index,0,section);state.selectedSection=sectionId;state.selectedBlock=null;state.selectedOutline=null;state.expandedSections.add(sectionId);expandAllOutline(section,entry.editor.outline);state.insertTarget=null;state.libraryOpen=false;changed();shell();notify(`${entry.name} agregada.`)}catch(error){notify(error.message)}finally{state.sectionAdding=false;if(state.libraryOpen)shell()}}
  function duplicateSelectedSection(){const {section,definition:entry}=selected();if(!section||entry?.capabilities?.duplicable===false)return;remember();const copy=clone(section);copy.id=id("section");copy.label=`${section.label} — copia`;for(const block of copy.instance.blocks||[])block.id=id("block");const index=state.page.sections.indexOf(section);state.page.sections.splice(index+1,0,copy);state.selectedSection=copy.id;state.selectedBlock=null;state.selectedOutline=null;state.expandedSections.add(copy.id);changed();shell();notify("Sección duplicada.")}
  function deleteSelectedSection(){const {section,definition:entry}=selected();if(!section||entry?.capabilities?.deletable===false||state.page.sections.length<=1)return;remember();const index=state.page.sections.indexOf(section);state.page.sections.splice(index,1);const next=state.page.sections[Math.min(index,state.page.sections.length-1)];state.selectedSection=next?.id||null;state.selectedBlock=null;state.selectedOutline=null;changed();shell();notify("Sección eliminada.")}
  function duplicateSelectedBlock(){const {section,block,definition:entry}=selected();if(!section||!block||!entry?.capabilities?.editableStructure)return;const blocks=section.instance.blocks||[];const limit=blockLimit(entry,block.type);if(limit!==null&&blocks.filter((item)=>item.type===block.type).length>=limit)return notify(`Este tipo de bloque admite como máximo ${limit}.`);remember();const copy=clone(block);copy.id=id("block");const index=blocks.indexOf(block);blocks.splice(index+1,0,copy);state.selectedBlock=copy.id;state.selectedOutline=null;changed();shell();notify("Bloque duplicado.")}
  function deleteSelectedBlock(){const {section,block,definition:entry}=selected();if(!section||!block||!entry?.capabilities?.editableStructure)return;const blocks=section.instance.blocks||[];const minimum=Number.isInteger(entry.capabilities?.minBlocks)?entry.capabilities.minBlocks:0;if(blocks.length<=minimum)return notify(minimum?`La sección necesita al menos ${minimum} bloque${minimum===1?"":"s"}.`:"No quedan bloques para eliminar.");remember();const index=blocks.indexOf(block);blocks.splice(index,1);const next=blocks[Math.min(index,blocks.length-1)];state.selectedBlock=next?.id||null;state.selectedOutline=null;changed();shell();notify("Bloque eliminado.")}
  function moveSelectedBlock(direction){const {section,block,definition:entry}=selected();if(!section||!block||!entry?.capabilities?.editableStructure)return;const blocks=section.instance.blocks||[];const index=blocks.indexOf(block);const nextIndex=index+direction;if(index<0||nextIndex<0||nextIndex>=blocks.length)return;remember();[blocks[index],blocks[nextIndex]]=[blocks[nextIndex],blocks[index]];changed();shell()}
  function blockLibraryHtml(){return ""}
  function shell(){
    // Contrato del control de publicación: <s-button variant="primary" id="se-publish"/>.
    root.innerHTML=`<div class="se ${state.fullPreview?"is-full-preview":""}"><header class="se__top"><div class="se__identity"><button class="se__back" id="se-back" aria-label="Volver">←</button><span class="se__brand-mark" aria-hidden="true">✦</span><div class="se__title"><b>${esc(state.pageTitle)}</b><small>Editor por secciones</small></div></div><div class="se__viewport" role="group" aria-label="Herramientas de vista"><button class="se__viewport-tool ${state.fullPreview?"":"is-selected"}" id="se-select" aria-label="Seleccionar" title="Seleccionar" aria-pressed="${!state.fullPreview}">${treeIcon("select")}</button><button class="se__viewport-tool" id="se-desktop" aria-label="Vista de escritorio" title="Vista de escritorio" aria-pressed="${!state.mobile}">${treeIcon("desktop")}</button><button class="se__viewport-tool" id="se-mobile" aria-label="Vista móvil" title="Vista móvil" aria-pressed="${state.mobile}">${treeIcon("mobile")}</button><button class="se__viewport-tool" id="se-fullscreen" aria-label="Vista previa" title="Vista previa" aria-pressed="${state.fullPreview}">${treeIcon("fullscreen")}</button></div><div class="se__actions"><button class="se__history" id="se-undo" aria-label="Deshacer" ${state.past.length?"":"disabled"}>↶</button><button class="se__history" id="se-redo" aria-label="Rehacer" ${state.future.length?"":"disabled"}>↷</button><button class="se__action-button se__action-button--secondary" id="se-save" ${state.dirty?"":"disabled"}>Guardar</button><s-button variant="primary" class="se__action-button se__action-button--primary" id="se-publish" ${demo?"disabled":""}>Publicar en la tienda</s-button><button class="se__action-button se__action-button--secondary" id="se-variants" ${productNumericId()?"":"disabled"}>Editar variantes</button><div class="se__actions-menu"><button class="se__action-button se__action-button--secondary" id="se-actions" aria-expanded="false">⚙ <span>Acciones</span></button><div class="se__actions-popover" hidden><button type="button" id="se-expand-all">Expandir todos los elementos</button><button type="button" id="se-collapse-all">Contraer todos los elementos</button></div></div></div></header><div class="se__body"><aside class="se__panel se__panel--left"><div class="se__panel-head"><b>Página de producto</b><span class="se__drag-help" id="se-section-drag-help">Mantené pulsada una sección para reordenarla. Con foco: espacio, flechas y espacio.</span></div><nav class="se__tree" aria-label="Secciones de la página">${treeHtml()}</nav><button class="se__add" id="se-add" ${availableSections().length?"":"disabled"}><span aria-hidden="true">${treeIcon("plus")}</span>Añadir sección</button></aside><section class="se__canvas"><div class="se__frame-shell ${state.mobile?"is-mobile":""}"><iframe class="se__frame" id="se-frame" title="Vista previa de la página"></iframe></div></section><aside class="se__panel se__panel--right"><div class="se__inspector">${inspectorHtml()}</div></aside></div></div>${libraryHtml()}${blockLibraryHtml()}`;
    // Keep one native draggable surface on the row. The inner label is
    // presentation-only so Chrome starts the gesture on the sortable shell;
    // pointer events remain the fallback for touch and custom iframe hosts.
    root.querySelectorAll('[data-section-drag] .se__tree-select').forEach((item)=>item.removeAttribute('draggable'));
    bind();refreshPreview();
  }
  function bind(){
    root.querySelector("#se-back").onclick=()=>{if(state.dirty&&!window.confirm("Tenés cambios sin guardar. ¿Querés salir igualmente?"))return;const u=new URL("/paginas",location.origin);for(const key of["shop","host","embedded"]){const value=params.get(key);if(value)u.searchParams.set(key,value)}location.assign(u.pathname+u.search)};
    root.querySelector("#se-select").onclick=()=>{state.fullPreview=false;shell()};root.querySelector("#se-desktop").onclick=()=>{state.mobile=false;shell()};root.querySelector("#se-mobile").onclick=()=>{state.mobile=true;shell()};root.querySelector("#se-fullscreen").onclick=()=>{state.fullPreview=!state.fullPreview;shell()};
    root.querySelector("#se-undo").onclick=undo;root.querySelector("#se-redo").onclick=redo;
    root.querySelector("#se-save").onclick=save;
    root.querySelector("#se-publish").onclick=publish;
    root.querySelector("#se-variants").onclick=()=>{const id=productNumericId();const shop=String(params.get("shop")||"").replace(/\.myshopify\.com$/i,"");if(id&&/^[a-z0-9][a-z0-9-]*$/i.test(shop))window.open(`https://admin.shopify.com/store/${encodeURIComponent(shop)}/products/${id}`,"_blank","noopener,noreferrer")};
    root.querySelector("#se-actions").onclick=(event)=>{event.stopPropagation();const menu=root.querySelector(".se__actions-popover");menu.hidden=!menu.hidden;root.querySelector("#se-actions").setAttribute("aria-expanded",String(!menu.hidden))};
    root.querySelector("#se-expand-all").onclick=()=>{for(const section of state.page.sections){state.expandedSections.add(section.id);expandAllOutline(section,definition(section)?.editor.outline)}shell()};
    root.querySelector("#se-collapse-all").onclick=()=>{state.expandedSections.clear();state.expandedOutline.clear();shell()};
    root.querySelector("#se-add").onclick=()=>openSectionLibrary();
    if(!root.dataset.sectionDragBound){
      root.addEventListener("pointermove",handleSectionPointerMove,{passive:false});
      root.addEventListener("pointerup",handleSectionPointerUp,{passive:false});
      root.addEventListener("pointercancel",handleSectionPointerCancel,{passive:false});
      root.addEventListener("lostpointercapture",handleSectionPointerCancel,{passive:false});
      root.addEventListener("mousemove",handleSectionMouseMove,{passive:false});
      root.addEventListener("mouseup",handleSectionMouseUp,{passive:false});
      root.addEventListener("keydown",handleSectionKeydown);
      root.dataset.sectionDragBound="true";
    }
    // App Bridge renders this editor inside a modal iframe. Capture the final
    // pointer event at document level as well, because the modal host can keep
    // the release outside the tree root after pointer capture starts.
    if(!document.documentElement.dataset.sectionDragDocumentBound){
      document.addEventListener("pointerdown",handleSectionPointerDown,{passive:false,capture:true});
      document.addEventListener("pointermove",handleSectionPointerMove,{passive:false,capture:true});
      document.addEventListener("pointerup",handleSectionPointerUp,{passive:false,capture:true});
      document.addEventListener("pointercancel",handleSectionPointerCancel,{passive:false,capture:true});
      document.addEventListener("mousedown",handleSectionMouseDown,{passive:false,capture:true});
      document.addEventListener("mousemove",handleSectionMouseMove,{passive:false,capture:true});
      document.addEventListener("mouseup",handleSectionMouseUp,{passive:false,capture:true});
      document.addEventListener("dragover",handleSectionDragOver,{passive:false,capture:true});
      document.addEventListener("drop",handleSectionDrop,{passive:false,capture:true});
      document.addEventListener("dragstart",handleSectionDragStart,{passive:false,capture:true});
      document.documentElement.dataset.sectionDragDocumentBound="true";
    }
    const backdrop=root.querySelector("[data-library-backdrop]");if(backdrop)backdrop.onclick=(event)=>{if(event.target===backdrop){state.libraryOpen=false;shell()}};
    root.querySelectorAll("[data-library-close]").forEach((button)=>button.onclick=()=>{state.libraryOpen=false;state.insertTarget=null;shell()});
    root.querySelectorAll("[data-add-definition]").forEach((button)=>button.onclick=()=>{const entry=state.registry.find((item)=>item.id===button.dataset.addDefinition&&item.version===Number(button.dataset.addVersion));if(entry)addSection(entry)});
    root.querySelectorAll("[data-library-category]").forEach((button)=>button.onclick=()=>{state.libraryCategory=button.dataset.libraryCategory;root.querySelectorAll("[data-library-category]").forEach((item)=>item.classList.toggle("is-active",item===button));filterLibrary()});
    const search=root.querySelector("[data-library-search]");if(search)search.oninput=filterLibrary;
    bindTree();
    bindInspector();
  }
  function update(control){const {section,block}=selected();if(!section)return;const target=control.dataset.scope==="block"?block?.settings:section.instance.settings;if(!target)return;const historyKey=`${section.id}:${block?.id||"section"}:${control.dataset.field}`;remember(historyKey);let value=control.type==="checkbox"?control.checked:control.value;if(control.type==="range"){value=Number(value);const number=root.querySelector(`[data-number-for="${CSS.escape(control.dataset.field)}"]`);if(number)number.value=control.value}target[control.dataset.field]=value;changed();if(control.type!=="range"&&!((control.tagName==="TEXTAREA")||["text","url"].includes(control.type)))finishHistory();clearTimeout(state.previewTimer);state.previewTimer=setTimeout(refreshPreview,160)}
  async function refreshPreview(){const request=++state.previewRequest;state.previewAbort?.abort();const controller=new AbortController();state.previewAbort=controller;try{const path=demo?"/section-page-demo-preview":`/api/paginas/${encodeURIComponent(pageId)}/section-preview`;const result=await api(path,{method:"POST",signal:controller.signal,body:{section_page:state.page}});if(request!==state.previewRequest)return;const frame=root.querySelector("#se-frame");if(frame){frame.onload=()=>focusPreview();frame.srcdoc=result.html}}catch(error){if(error.name!=="AbortError"&&request===state.previewRequest)notify(error.message)}}
  async function recoverFromConflict(message){
    try{
      const current=await api(`/api/paginas/${encodeURIComponent(pageId)}`);
      if(!current.data?.section_page)throw new Error("No se pudo recuperar la página actual.");
      state.page=clone(current.data.section_page);state.savedFingerprint=fingerprint(state.page);state.dirty=false;state.past=[];state.future=[];state.historyKey=null;state.selectedSection=null;state.selectedBlock=null;state.selectedOutline=null;state.sectionMenuId=null;state.insertTarget=null;state.libraryOpen=false;state.blockLibraryOpen=false;shell();notify("La página se actualizó desde otra sesión. Los cambios locales no guardados se descartaron.");
    }catch(error){notify(`${message||"No se pudo guardar por un conflicto."} ${error.message||""}`.trim())}
  }
  async function persist({render=true,announce=true}={}){const expectedRevision=Number(state.page.revision??0);const result=await api(`/api/paginas/${encodeURIComponent(pageId)}`,{method:"PUT",body:{section_page:state.page,expected_revision:expectedRevision}});state.page=result.section_page;state.savedFingerprint=fingerprint(state.page);state.dirty=false;if(announce)notify("Cambios guardados.");if(render)shell();return result}
  async function save(){const button=root.querySelector("#se-save");button.disabled=true;if(demo){state.savedFingerprint=fingerprint(state.page);state.dirty=false;notify("Demostración: el cambio quedó aplicado durante esta vista.");return}try{await persist()}catch(error){if(error.status===409){await recoverFromConflict(error.message);return}button.disabled=false;notify(error.message)}}
  async function waitForJob(id){const limit=Date.now()+180000;while(Date.now()<limit){const{job}=await api(`/api/jobs/${encodeURIComponent(id)}`);if(job.status==="succeeded")return job;if(["failed","cancelled"].includes(job.status))throw new Error(job.lastError||"La operación no pudo completarse. Intentá nuevamente.");await new Promise((resolve)=>setTimeout(resolve,1000))}throw new Error("La edición sigue en curso. Podés cerrar este cuadro y retomarla desde el mismo campo.")}
  async function publish(){const button=root.querySelector("#se-publish");button.disabled=true;button.textContent="Publicando…";try{if(state.dirty)await persist({render:false,announce:false});const{job}=await api(`/api/paginas/${encodeURIComponent(pageId)}/publicar`,{method:"POST"});const completed=await waitForJob(job.id);notify("Página publicada en Shopify.");button.textContent="Publicada";if(completed.result?.url)window.open(completed.result.url,"_blank","noopener")}catch(error){button.disabled=false;button.textContent="Publicar";notify(error.message)}}
  window.addEventListener("keydown",(event)=>{const editing=event.target?.matches?.("input,textarea,select,[contenteditable=true]");if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();if(state.dirty)save();return}if(!editing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();if(event.shiftKey)redo();else undo();return}if(!editing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();redo();return}if(event.key==="Escape"){const ai=root.querySelector("[data-ai-modal]");if(ai){ai.remove();return}if(root.querySelector(".se__media-backdrop[data-media-close]")){closeGallery();return}if(state.blockLibraryOpen){state.blockLibraryOpen=false;state.insertTarget=null;shell();return}if(state.libraryOpen){state.libraryOpen=false;state.insertTarget=null;shell()}}});
  window.addEventListener("beforeunload",(event)=>{if(!state.dirty)return;event.preventDefault();event.returnValue=""});
  window.addEventListener("message",(event)=>{const frame=root.querySelector("#se-frame");if(event.source!==frame?.contentWindow)return;if(event.data?.type==="tiq-section-select"){selectItem(event.data.sectionId,event.data.blockId||null,event.data.outlineId||null);return}if(event.data?.type==="tiq-preview-cart")notify("El carrito se prueba en la tienda publicada; el preview no modifica pedidos.")});
  async function start(){if(demo){const sample=await api("/section-page-demo-data");state.page=clone(sample.section_page);state.language=sample.idioma||"es";state.pageTitle=`${sample.titulo} · demostración`;state.registry=sample.registry||[]}else{if(!pageId)throw new Error("Falta el id de la página.");const[page,registry]=await Promise.all([api(`/api/paginas/${encodeURIComponent(pageId)}`),api("/api/section-registry")]);if(!page.data?.section_page)throw new Error("Esta página todavía no usa el sistema por secciones.");state.page=clone(page.data.section_page);state.language=page.data?.global?.idioma||"es";state.pageTitle=page.titulo||state.page.productSnapshot?.title||"Página de producto";state.registry=registry.sections||[]}state.savedFingerprint=fingerprint(state.page);state.selectedSection=null;state.selectedBlock=null;state.selectedOutline=null;state.expandedSections.clear();state.expandedOutline.clear();status.hidden=true;root.hidden=false;shell()}
  start().catch((error)=>{status.textContent=error.message||"No se pudo abrir la página."});
}());
