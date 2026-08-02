// ============================================================
// GENERADOR DE THEMES POR NICHO
//
//   node construir-nicho.js <nicho>
//
// Lee nichos/<nicho>.json (la "config del nicho": paleta + copy + IDs de
// fotos) y estampa un theme completo en theme-nicho-<nicho>/, partiendo del
// theme base (Dawn + las 4 secciones custom iq-*). Solo cambia lo variable;
// el motor (secciones, estructura, Dawn) queda idéntico.
//
// Después: shopify theme push --path theme-nicho-<nicho> ...
// ============================================================

const fs = require("fs");
const path = require("path");

const BASE = path.join(__dirname, "theme-nicho-beauty"); // theme de referencia (motor)

const leerJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const escribirJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");

// --- settings_data: paleta + fuentes + esquinas desde la config ---
function settingsData(base, c) {
  const s = JSON.parse(JSON.stringify(base));
  const d = s.presets.Dawn;
  const e = c.estilo;
  d.color_schemes = c.color_schemes;
  d.type_header_font = e.type_header_font;
  d.type_body_font = e.type_body_font;
  d.buttons_radius = e.buttons_radius;
  d.variant_pills_radius = e.buttons_radius;
  d.inputs_radius = e.inputs_radius;
  d.media_radius = e.media_radius;
  d.card_corner_radius = e.card_corner_radius;
  d.collection_card_corner_radius = e.card_corner_radius;
  d.blog_card_corner_radius = e.card_corner_radius;
  d.text_boxes_radius = Math.max(e.card_corner_radius, 10);
  d.popup_corner_radius = e.card_corner_radius;
  d.badge_corner_radius = e.badge_corner_radius;
  return s;
}

// --- home ---
function indexJSON(c) {
  const feats = {}, fo = [];
  c.why.features.forEach((f, i) => { const id = "f" + (i + 1); feats[id] = { type: "feature", settings: { emoji: f.emoji, title: f.title, text: f.text } }; fo.push(id); });
  const revs = {}, ro = [];
  c.reviews.items.forEach((r, i) => { const id = "r" + (i + 1); revs[id] = { type: "review", settings: { author: r.author, text: r.text } }; ro.push(id); });
  return {
    sections: {
      hero: { type: "iq-hero", settings: { image_asset: "iq-hero.jpg", height: 620, overlay_opacity: c.hero.overlay_opacity ?? 40, heading: c.hero.heading, button_label: c.hero.button_label, button_link: "shopify://collections/all" } },
      marquee: { type: "iq-marquee", settings: { color_scheme: "scheme-5", textos: "Miles de clientes felices | Calidad garantizada | Envío a todo el país | Compra 100% segura | Cambios y devoluciones fáciles", tamano: 14, padding: 16, velocidad: 40 } },
      welcome: { type: "iq-image-text", settings: { image_asset: "iq-welcome.jpg", image_position: "left", caption: c.welcome.caption, heading: c.welcome.heading, text: `<p>${c.welcome.text}</p>`, button_label: c.welcome.button_label, button_link: "shopify://pages/about", color_scheme: "scheme-1", padding_top: 48, padding_bottom: 48 } },
      why_choose_us: { type: "iq-why", blocks: feats, block_order: fo, settings: { title: c.why.title, subtitle: c.why.subtitle, image_asset: "iq-why.jpg", gradient_color: c.estilo.gradient_color, padding_top: 56, padding_bottom: 56 } },
      collection: { type: "featured-collection", settings: { title: "Descubrí nuestra colección", heading_size: "h1", description: "", show_description: false, description_style: "body", collection: "all", products_to_show: 10, columns_desktop: 4, color_scheme: "scheme-1", full_width: false, show_view_all: true, view_all_style: "solid", enable_desktop_slider: false, swipe_on_mobile: true, image_ratio: "square", image_shape: "default", show_secondary_image: false, show_vendor: false, show_rating: false, quick_add: "none", columns_mobile: "2", padding_top: 44, padding_bottom: 44 } },
      reviews: { type: "iq-reviews", blocks: revs, block_order: ro, settings: { title: c.reviews.title, subtitle: c.reviews.subtitle, color_scheme: "scheme-1", padding_top: 48, padding_bottom: 48 } },
      guarantee: { type: "rich-text", blocks: { heading: { type: "heading", settings: { heading: c.guarantee.heading, heading_size: "h1" } }, text: { type: "text", settings: { text: `<p>${c.guarantee.text}</p>`, text_style: "body" } }, button: { type: "button", settings: { button_label: c.guarantee.button_label, button_link: "shopify://collections/all", button_style_secondary: false } } }, block_order: ["heading", "text", "button"], settings: { desktop_content_position: "center", content_alignment: "center", color_scheme: "scheme-1", full_width: true, padding_top: 52, padding_bottom: 60 } }
    },
    order: ["hero", "marquee", "welcome", "why_choose_us", "collection", "reviews", "guarantee"]
  };
}

// --- about ---
function aboutJSON(c) {
  const b = c.about.blocks;
  const bloque = (i, pos, scheme, pt, pb) => ({ type: "iq-image-text", settings: { image_asset: `iq-about-${i + 1}.jpg`, image_position: pos, caption: "", heading: b[i].heading, text: `<p>${b[i].text}</p>`, button_label: b[i].button_label || "", button_link: b[i].button_label ? "shopify://collections/all" : "", color_scheme: scheme, padding_top: pt, padding_bottom: pb } });
  return {
    sections: {
      title: { type: "rich-text", blocks: { heading: { type: "heading", settings: { heading: "Sobre nosotros", heading_size: "h0" } } }, block_order: ["heading"], settings: { desktop_content_position: "center", content_alignment: "center", color_scheme: "scheme-1", full_width: true, padding_top: 52, padding_bottom: 16 } },
      b1: bloque(0, "left", "scheme-1", 40, 40),
      b2: bloque(1, "right", "scheme-2", 56, 56),
      b3: bloque(2, "left", "scheme-1", 40, 52)
    },
    order: ["title", "b1", "b2", "b3"]
  };
}

async function bajarImagen(id, destino) {
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`foto ${id}: HTTP ${res.status}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
}

async function construir(nicho) {
  const c = leerJSON(path.join(__dirname, "nichos", nicho + ".json"));
  const dest = path.join(__dirname, "theme-nicho-" + nicho);

  fs.cpSync(BASE, dest, { recursive: true, force: true });

  escribirJSON(path.join(dest, "config", "settings_data.json"), settingsData(leerJSON(path.join(BASE, "config", "settings_data.json")), c));
  escribirJSON(path.join(dest, "templates", "index.json"), indexJSON(c));
  escribirJSON(path.join(dest, "templates", "page.about.json"), aboutJSON(c));

  const header = leerJSON(path.join(dest, "sections", "header-group.json"));
  header.sections["announcement-bar"].blocks["announcement-bar-0"].settings.text = c.announcement;
  escribirJSON(path.join(dest, "sections", "header-group.json"), header);

  const footer = leerJSON(path.join(dest, "sections", "footer-group.json"));
  const ab = footer.sections.footer.blocks.about.settings;
  ab.heading = c.footer.about_heading;
  ab.subtext = `<p>${c.footer.about_text}</p>`;
  escribirJSON(path.join(dest, "sections", "footer-group.json"), footer);

  const fotos = { "iq-hero.jpg": c.imagenes.hero, "iq-welcome.jpg": c.imagenes.welcome, "iq-why.jpg": c.imagenes.why, "iq-about-1.jpg": c.imagenes.about1, "iq-about-2.jpg": c.imagenes.about2, "iq-about-3.jpg": c.imagenes.about3 };
  for (const [name, id] of Object.entries(fotos)) { await bajarImagen(id, path.join(dest, "assets", name)); console.log("  foto", name, "←", id); }

  console.log(`\n✓ theme-nicho-${nicho} listo (marca ${c.marca})\n  push: shopify theme push --path theme-nicho-${nicho} --store <tienda> --unpublished --theme "${c.theme_name}"`);
}

const nicho = process.argv[2];
if (!nicho) { console.error("uso: node construir-nicho.js <nicho>"); process.exit(1); }
construir(nicho).catch((e) => { console.error("ERR", e.message); process.exit(1); });
