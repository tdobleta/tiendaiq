"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app", "app.js"), "utf8");
const selectorStart = appSource.indexOf("async function pantallaPlantillas()");
const selectorEnd = appSource.indexOf("function generar()", selectorStart);
const selectorSource = appSource.slice(selectorStart, selectorEnd);

test("el selector sólo ofrece las plantillas activas para creación", () => {
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, "selector de plantillas localizable");
  assert.match(selectorSource, /id: "piloto-pdp-01"/);
  assert.doesNotMatch(selectorSource, /id: "clasico"/);
  assert.doesNotMatch(selectorSource, /id: "premium"/);
  assert.doesNotMatch(selectorSource, /id: "pagepilot"/);
  assert.doesNotMatch(selectorSource, /id: "pagepilot-blue"/);
});
