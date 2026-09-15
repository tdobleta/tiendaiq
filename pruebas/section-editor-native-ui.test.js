"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const editor = fs.readFileSync(path.join(__dirname, "../app/section-editor.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../app/section-editor.css"), "utf8");
const imageWithText = fs.readFileSync(
  path.join(__dirname, "../src/section-pipeline/sources/image-with-text-v1/section.liquid"),
  "utf8",
);

test("el chrome del editor usa componentes nativos de Shopify", () => {
  assert.match(editor, /<s-button variant="secondary" class="se__advanced-toggle/);
  assert.match(editor, /<s-button variant="secondary" class="se__brand-button/);
  assert.match(editor, /<s-button variant="secondary" class="se__action-button se__action-button--secondary" id="se-save"/);
  assert.match(editor, /<s-button variant="primary" class="se__action-button se__action-button--primary" id="se-publish"/);
  assert.match(editor, /<s-badge class="se__origin-badge/);
  assert.doesNotMatch(editor, /sourceIcon\(origin\).*<span class="se__origin-badge/);
});

test("las acciones de secciones conservan semántica Shopify sin perder arrastre", () => {
  assert.match(editor, /<s-button variant="tertiary" data-section-preview=/);
  assert.match(editor, /<s-button variant="tertiary" data-section-menu=/);
  assert.match(editor, /data-insert-kind="section"/);
  assert.match(editor, /<s-button variant="tertiary" accessibility-label=/);
  assert.match(editor, /<s-button variant="tertiary" class="se__add" id="se-add"/);
  assert.match(editor, /data-section-drag=/);
  assert.match(editor, /setPointerCapture/);
  assert.match(css, /\.se__tree-select-shell\.is-dragging/);
  assert.match(css, /\.se\.is-section-dragging \.se__section-insert-slot\.is-active/);
});

test("el editor no genera enlaces decorativos con href #", () => {
  assert.doesNotMatch(editor, /href=\\"#\\"/);
  assert.doesNotMatch(imageWithText, /default:\s*'#'/);
  assert.match(imageWithText, /section\.settings\.button_link != blank/);
});

test("la vista previa se intercambia sin dejar el lienzo en blanco", () => {
  assert.match(editor, /const next=frame\.cloneNode\(false\)/);
  assert.match(editor, /next\.classList\.add\("se__frame--pending"\)/);
  assert.match(editor, /frame\.replaceWith\(next\)/);
  assert.match(css, /\.se__frame-shell\{position:relative\}/);
  assert.match(css, /\.se__frame--pending\{position:absolute/);
});

test("la apertura selecciona y expande la primera sección", () => {
  assert.match(editor, /state\.selectedSection=state\.page\.sections\[0\]\?\.id\|\|null/);
  assert.match(editor, /state\.expandedSections\.add\(first\.id\)/);
});

test("publicar vuelve a estar disponible después de una edición", () => {
  assert.match(editor, /state\.published=false;syncDirty\(\)/);
  assert.match(editor, /publishButton\.disabled=demo\|\|state\.publishing\|\|\(!state\.dirty&&state\.published\)/);
  assert.match(editor, /state\.publishing=false;state\.published=true;syncDirty\(\)/);
});
