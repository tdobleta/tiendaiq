"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepararDatosPublicacion } = require("../publicar");

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
