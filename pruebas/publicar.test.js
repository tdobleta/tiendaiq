"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepararDatosPublicacion } = require("../publicar");
const { hashSource } = require("../src/piloto/pdp01-contract");

test("la publicación no conserva ni crea avatares de reseñas", () => {
  const original = {
    facetas: {
      hero: {
        resena_destacada: {
          autor: "Cliente verificable",
          texto: "Una reseña completa.",
          estrellas: 5,
          avatar: "https://cdn.shopify.com/historico-avatar.png"
        }
      }
    }
  };

  const publicado = prepararDatosPublicacion(original);

  assert.equal(publicado.facetas.hero.resena_destacada.avatar, null);
  assert.equal(original.facetas.hero.resena_destacada.avatar, "https://cdn.shopify.com/historico-avatar.png");
});

test("la publicación tolera páginas sin reseña destacada", () => {
  const original = { facetas: { hero: {} } };

  assert.deepEqual(prepararDatosPublicacion(original), original);
});

test("Piloto 01 publica sólo su proyección segura, sin fuente interna", () => {
  const source_fields = { product_gid: "gid://shopify/Product/1", title: "Interno", description: "Privado", vendor: "", product_type: "", options: [], media_ids: ["gid://shopify/MediaImage/1"], variants: [{ id: "gid://shopify/ProductVariant/1", title: "Única" }] };
  const original = { fuente: { shopify_product_id: source_fields.product_gid, descripcion_cruda: "No debe ir" }, piloto_pdp_01: { contract_version: 1, template: "piloto-pdp-01", source_fields, source_hash: hashSource(source_fields), evidence: {}, content: { hero: { claim: "Idea", bullets: ["Uno", "Dos"] }, offer: { heading: "Opciones", packs: [{ id: "unidad", label: "Una", subtitle: "Inicio", quantity: 1, mechanism: "multi_quantity", variant_id: "gid://shopify/ProductVariant/1" }] }, why: { eyebrow: "Rutina", heading: "Claro", body: "Texto", points: ["Uno", "Dos"] }, timeline: { heading: "Pasos", intro: "Guía", steps: [{ label: "Uno", heading: "Conocé", body: "Texto" }, { label: "Dos", heading: "Elegí", body: "Texto" }] }, faq: { heading: "Dudas", items: [{ question: "¿A?", answer: "A" }, { question: "¿B?", answer: "B" }, { question: "¿C?", answer: "C" }] }, media: { hero_media_id: "gid://shopify/MediaImage/1", gallery_media_ids: ["gid://shopify/MediaImage/1"] } } } };
  const published = prepararDatosPublicacion(original);
  assert.deepEqual(published.fuente, { shopify_product_id: "gid://shopify/Product/1" });
  assert.equal(published.piloto_pdp_01.source_fields, undefined);
  assert.equal(published.piloto_pdp_01.source_hash, undefined);
});
