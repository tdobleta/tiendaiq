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

const USA_PG = !!env.DATABASE_URL;

// ---------- Postgres ----------

let pool = null;
async function pg() {
  if (pool) return pool;
  const { Pool } = require("pg");
  // Render exige SSL; un Postgres local no lo tiene. Se detecta por la URL.
  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(env.DATABASE_URL);
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: local ? false : { rejectUnauthorized: false }
  });
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
  if (USA_PG) {
    const p = await pg();
    await p.query(
      `INSERT INTO tiendas (dominio, datos, actualizada) VALUES ($1, $2, now())
       ON CONFLICT (dominio) DO UPDATE SET datos = $2, actualizada = now()`,
      [dominio, datos]
    );
  } else {
    fileGuardar(DIR_TIENDAS, dominio, datos);
  }
}

async function leerTiendaDB(dominio) {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(`SELECT datos FROM tiendas WHERE dominio = $1`, [dominio]);
    return r.rows[0]?.datos ?? null;
  }
  return fileLeer(DIR_TIENDAS, dominio);
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
    return r.rows.map((x) => x.datos);
  }
  return fileListar(DIR_TIENDAS);
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

async function listarPaginasDB(tienda) {
  if (USA_PG) {
    const p = await pg();
    const r = await p.query(`SELECT datos FROM paginas WHERE tienda = $1`, [tienda]);
    return r.rows.map((x) => x.datos);
  }
  return fileListar(path.join(DIR_PAGINAS, seguro(tienda)));
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
  guardarPaginaDB, leerPaginaDB, listarPaginasDB,
  guardarEstadoDB, consumirEstadoDB
};
