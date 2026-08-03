// ============================================================
// DB — el almacén de tiendas y páginas.
//
// Un solo lugar decide dónde se guarda todo:
//   - Con DATABASE_URL (Render, producción) → Postgres.
//   - Sin DATABASE_URL (tu compu) → archivos, como hasta ahora.
//
// Así el código de arriba (tiendas.js, server.js) no sabe ni le importa
// dónde vive el dato: le pide a estas funciones y listo. El día que quieras
// otra base, se cambia acá y nada más se entera.
// ============================================================

const fs = require("fs");
const path = require("path");
const { env } = require("./shopify");
const { cifrarToken, descifrarToken } = require("./cripto-tokens");

// El token vive dentro del JSONB `datos`. Se cifra al escribir y se descifra al
// leer, en esta capa: el resto de la app sigue viendo el token en claro y no se
// entera. Clonar antes de cifrar para no mutar el objeto del caller.
function cifrarDatos(datos) {
  if (!datos || datos.token == null) return datos;
  return { ...datos, token: cifrarToken(datos.token) };
}
function descifrarDatos(datos) {
  if (!datos || datos.token == null) return datos;
  return { ...datos, token: descifrarToken(datos.token) };
}

const USA_PG = !!env.DATABASE_URL;

// ---------- Postgres ----------

let pool = null;
async function pg() {
  if (pool) return pool;
  const { Pool } = require("pg");
  // Render exige SSL; un Postgres local no lo tiene. Se detecta por la URL.
  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(env.DATABASE_URL);
  // Con PG_CA_CERT (el CA de Render) se VALIDA el certificado (anti-MITM). Sin
  // el CA, se mantiene el comportamiento actual (sin validar) + aviso, para no
  // romper la conexión: la mejora de seguridad se activa al cargar la env.
  let ssl;
  if (local) {
    ssl = false;
  } else if (env.PG_CA_CERT) {
    ssl = { rejectUnauthorized: true, ca: env.PG_CA_CERT };
  } else {
    console.warn("⚠ PG_CA_CERT no seteada: conexión a Postgres SIN validar el certificado (MITM posible). Cargá el CA de Render para activar la validación.");
    ssl = { rejectUnauthorized: false };
  }
  pool = new Pool({ connectionString: env.DATABASE_URL, ssl });
  // Esquema mínimo: dos tablas, tal cual el plan.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiendas (
      dominio     TEXT PRIMARY KEY,
      datos       JSONB NOT NULL,
      actualizada TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paginas (
      tienda      TEXT NOT NULL,
      id          TEXT NOT NULL,
      datos       JSONB NOT NULL,
      actualizada TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (tienda, id)
    );
    CREATE TABLE IF NOT EXISTS estados_oauth (
      estado TEXT PRIMARY KEY,
      tienda TEXT NOT NULL,
      vence  TIMESTAMPTZ NOT NULL
    );
  `);
  return pool;
}

// ---------- archivos (fallback local) ----------

const DIR_TIENDAS = path.join(__dirname, "tiendas");
const DIR_PAGINAS = path.join(__dirname, "paginas");
const seguro = (s) => String(s).replace(/[^a-z0-9.-]/gi, "_");

function fileGuardar(dir, clave, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, seguro(clave) + ".json"), JSON.stringify(obj, null, 2));
}
function fileLeer(dir, clave) {
  const r = path.join(dir, seguro(clave) + ".json");
  return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, "utf8")) : null;
}
function fileBorrar(dir, clave) {
  const r = path.join(dir, seguro(clave) + ".json");
  if (fs.existsSync(r)) fs.unlinkSync(r);
}
function fileListar(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

// ============================================================
// API — lo único que ve el resto de la app
// ============================================================

// ---- tiendas ----

async function guardarTiendaDB(dominio, datos) {
  const cifrado = cifrarDatos(datos); // el token va cifrado en reposo
  if (USA_PG) {
    const p = await pg();
    await p.query(
      `INSERT INTO tiendas (dominio, datos, actualizada) VALUES ($1, $2, now())
       ON CONFLICT (dominio) DO UPDATE SET datos = $2, actualizada = now()`,
      [dominio, cifrado]
    );
  } else {
    fileGuardar(DIR_TIENDAS, dominio, cifrado);
  }
}

async function leerTiendaDB(dominio) {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(`SELECT datos FROM tiendas WHERE dominio = $1`, [dominio]);
    return descifrarDatos(r.rows[0]?.datos ?? null);
  }
  return descifrarDatos(fileLeer(DIR_TIENDAS, dominio));
}

async function borrarTiendaDB(dominio) {
  if (USA_PG) {
    const p = await pg();
    await p.query(`DELETE FROM tiendas WHERE dominio = $1`, [dominio]);
  } else {
    fileBorrar(DIR_TIENDAS, dominio);
  }
}

async function listarTiendasDB() {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(`SELECT datos FROM tiendas ORDER BY actualizada DESC`);
    return r.rows.map((x) => descifrarDatos(x.datos));
  }
  return fileListar(DIR_TIENDAS).map(descifrarDatos);
}

// Incremento ATÓMICO del uso del mes, con tope. Devuelve el nuevo valor si se
// incrementó, o null si ya estaba en el límite (sin cupo). En un solo UPDATE:
// el WHERE hace el chequeo y el jsonb_set el incremento, bajo el lock de fila de
// Postgres → imposible que dos requests concurrentes se pasen del cupo. `limite`
// null = sin tope (plan pro). No toca el token (queda cifrado).
async function incrementarUsoDB(dominio, mes, limite) {
  if (USA_PG) {
    const p = await pg();
    const set = `jsonb_set(datos, ARRAY['uso', $2], to_jsonb(COALESCE((datos->'uso'->>$2)::int, 0) + 1))`;
    const sql = limite == null
      ? `UPDATE tiendas SET datos = ${set}, actualizada = now() WHERE dominio = $1 RETURNING (datos->'uso'->>$2)::int AS n`
      : `UPDATE tiendas SET datos = ${set}, actualizada = now() WHERE dominio = $1 AND COALESCE((datos->'uso'->>$2)::int, 0) < $3 RETURNING (datos->'uso'->>$2)::int AS n`;
    const r = await p.query(sql, limite == null ? [dominio, mes] : [dominio, mes, limite]);
    return r.rows[0] ? r.rows[0].n : null;
  }
  // Archivos (dev, sin concurrencia): read-modify-write con chequeo.
  const d = fileLeer(DIR_TIENDAS, dominio) || {};
  const actual = (d.uso && d.uso[mes]) || 0;
  if (limite != null && actual >= limite) return null;
  d.uso = { ...(d.uso || {}), [mes]: actual + 1 };
  fileGuardar(DIR_TIENDAS, dominio, d);
  return actual + 1;
}

// Revierte un incremento (si la generación falló después de reservar el cupo).
async function decrementarUsoDB(dominio, mes) {
  if (USA_PG) {
    const p = await pg();
    await p.query(
      `UPDATE tiendas SET datos = jsonb_set(datos, ARRAY['uso', $2], to_jsonb(GREATEST(0, COALESCE((datos->'uso'->>$2)::int, 0) - 1))), actualizada = now() WHERE dominio = $1`,
      [dominio, mes]
    );
    return;
  }
  const d = fileLeer(DIR_TIENDAS, dominio);
  if (!d) return;
  const actual = (d.uso && d.uso[mes]) || 0;
  d.uso = { ...(d.uso || {}), [mes]: Math.max(0, actual - 1) };
  fileGuardar(DIR_TIENDAS, dominio, d);
}

// Actualiza SOLO los campos indicados de una tienda (jsonb_set por clave), sin
// reescribir el objeto entero → dos writers de campos distintos no se pisan
// (fin de los lost updates). No toca el token. `campos` = { plan, plan_verificado, … }.
async function actualizarCamposTiendaDB(dominio, campos) {
  const claves = Object.keys(campos);
  if (!claves.length) return;
  if (USA_PG) {
    const p = await pg();
    let expr = "datos";
    const vals = [dominio];
    let i = 2;
    for (const k of claves) {
      expr = `jsonb_set(${expr}, ARRAY[$${i}], $${i + 1}::jsonb)`;
      vals.push(k, JSON.stringify(campos[k] ?? null));
      i += 2;
    }
    await p.query(`UPDATE tiendas SET datos = ${expr}, actualizada = now() WHERE dominio = $1`, vals);
    return;
  }
  const d = fileLeer(DIR_TIENDAS, dominio);
  if (!d) return;
  Object.assign(d, campos);
  fileGuardar(DIR_TIENDAS, dominio, d);
}

// ---- páginas ----

async function guardarPaginaDB(tienda, id, datos) {
  if (USA_PG) {
    const p = await pg();
    await p.query(
      `INSERT INTO paginas (tienda, id, datos, actualizada) VALUES ($1, $2, $3, now())
       ON CONFLICT (tienda, id) DO UPDATE SET datos = $3, actualizada = now()`,
      [tienda, id, datos]
    );
  } else {
    const dir = path.join(DIR_PAGINAS, seguro(tienda));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id + ".json"), JSON.stringify(datos, null, 2));
  }
}

async function leerPaginaDB(tienda, id) {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(`SELECT datos FROM paginas WHERE tienda = $1 AND id = $2`, [tienda, id]);
    return r.rows[0]?.datos ?? null;
  }
  const r = path.join(DIR_PAGINAS, seguro(tienda), id + ".json");
  return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, "utf8")) : null;
}

// Devuelve un RESUMEN por página (no el JSONB `datos` entero). Una página con
// IA pesa cientos de KB; una tienda con muchas transfería megabytes por request
// solo para pintar una lista de títulos. Se proyectan en el SQL únicamente los
// campos que consumen las vistas de lista/estado. Para el contenido completo de
// UNA página está leerPaginaDB.
async function listarPaginasDB(tienda) {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(
      `SELECT
         datos->>'id'                         AS id,
         datos->>'shopify_product_id'         AS shopify_product_id,
         datos->>'estado'                     AS estado,
         datos->>'url_publica'                AS url_publica,
         datos->>'actualizado'                AS actualizado,
         datos#>>'{data,facetas,hero,titulo}' AS titulo,
         (datos->'urls') ->> (datos#>>'{data,facetas,hero,galeria,0}') AS imagen
       FROM paginas WHERE tienda = $1`,
      [tienda]
    );
    return r.rows.map((x) => ({
      id: x.id,
      shopify_product_id: x.shopify_product_id || null,
      estado: x.estado,
      url_publica: x.url_publica || null,
      actualizado: x.actualizado || null,
      titulo: x.titulo || null,
      imagen: x.imagen || null
    }));
  }
  // Archivos (dev): mismo resumen, calculado en memoria.
  return fileListar(path.join(DIR_PAGINAS, seguro(tienda))).map((p) => {
    const galeria = p.data?.facetas?.hero?.galeria || [];
    return {
      id: p.id,
      shopify_product_id: p.shopify_product_id || null,
      estado: p.estado,
      url_publica: p.url_publica || null,
      actualizado: p.actualizado || null,
      titulo: p.data?.facetas?.hero?.titulo || null,
      imagen: (galeria.length && p.urls?.[galeria[0]]) || null
    };
  });
}

// ---- estados de OAuth ----
//
// El `state` ata el callback de Shopify a una instalación que arrancamos
// nosotros. Antes vivía en un Map en memoria: cada reinicio de Render (y el
// free tier duerme el proceso) borraba los pendientes, y el merchant que
// venía del "Instalar" se comía un "state inválido" sin explicación. Con más
// de una instancia fallaba siempre, porque el callback podía caer en otra.
//
// De un solo uso: se borra al leerlo, exista o no.

const DIR_ESTADOS = path.join(__dirname, "estados");

async function guardarEstadoDB(estado, tienda, venceMs) {
  if (USA_PG) {
    const p = await pg();
    await p.query(
      `INSERT INTO estados_oauth (estado, tienda, vence) VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (estado) DO NOTHING`,
      [estado, tienda, venceMs]
    );
  } else {
    fileGuardar(DIR_ESTADOS, estado, { estado, tienda, vence: venceMs });
  }
}

// Devuelve { tienda } si el estado existía y no venció; null en cualquier otro
// caso. Siempre lo borra: un state se usa una vez.
async function consumirEstadoDB(estado) {
  if (!estado) return null;
  if (USA_PG) {
    const p = await pg();
    // De paso barre los vencidos: la tabla no crece con instalaciones a medias.
    await p.query(`DELETE FROM estados_oauth WHERE vence < now()`);
    const r = await p.query(`DELETE FROM estados_oauth WHERE estado = $1 RETURNING tienda`, [estado]);
    return r.rows[0] ? { tienda: r.rows[0].tienda } : null;
  }
  const e = fileLeer(DIR_ESTADOS, estado);
  fileBorrar(DIR_ESTADOS, estado);
  return e && e.vence > Date.now() ? { tienda: e.tienda } : null;
}

module.exports = {
  USA_PG,
  guardarTiendaDB, leerTiendaDB, borrarTiendaDB, listarTiendasDB,
  incrementarUsoDB, decrementarUsoDB, actualizarCamposTiendaDB,
  guardarPaginaDB, leerPaginaDB, listarPaginasDB,
  guardarEstadoDB, consumirEstadoDB
};
