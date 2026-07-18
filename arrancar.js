// ============================================================
// ARRANCAR — levanta túnel + servidor con un solo comando.
//
//   node arrancar.js
//
// Hace TODO lo que antes había que hacer a mano cada vez que se caía:
//   1. mata túnel y server viejos
//   2. levanta un túnel nuevo y espera su URL
//   3. escribe esa URL en .env (APP_URL)
//   4. arranca el server
//   5. te imprime EXACTO qué pegar en el Dev Dashboard
//
// La única fricción que queda es pegar la URL en el Dashboard, porque el
// túnel gratis de Cloudflare cambia de nombre en cada arranque. Para que
// deje de cambiar hace falta un túnel con nombre fijo (cuenta de Cloudflare).
// ============================================================

const { bin } = require("cloudflared");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const RUTA_ENV = path.join(__dirname, ".env");
const RUTA_LOG = path.join(__dirname, "tunel.log");
const RUTA_PID = path.join(__dirname, "tunel.pid");
const PUERTO = 4321;

function matarViejos() {
  const { execSync } = require("child_process");
  // túnel viejo por su pid guardado
  try {
    process.kill(Number(fs.readFileSync(RUTA_PID, "utf8").trim()));
  } catch {}
  // server viejo: quien tenga tomado el puerto 4321.
  try {
    if (process.platform === "win32") {
      const salida = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
      const pids = new Set();
      salida.split(/\r?\n/).forEach((l) => {
        const m = l.match(/:4321\s.*LISTENING\s+(\d+)/);
        if (m) pids.add(m[1]);
      });
      pids.forEach((pid) => { try { execSync(`taskkill /F /PID ${pid}`); } catch {} });
    } else {
      execSync(`pkill -f server.js`, { stdio: "ignore" });
    }
  } catch {}
}

function levantarTunel() {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(RUTA_LOG);
    const p = spawn(bin, ["tunnel", "--url", `http://localhost:${PUERTO}`], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    fs.writeFileSync(RUTA_PID, String(p.pid));
    p.stdout.pipe(log);
    p.stderr.pipe(log);

    const t0 = Date.now();
    const buscar = setInterval(() => {
      const txt = fs.readFileSync(RUTA_LOG, "latin1");
      const m = txt.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearInterval(buscar);
        resolve(m[0]);
      } else if (Date.now() - t0 > 30000) {
        clearInterval(buscar);
        reject(new Error("El túnel no dio URL en 30s"));
      }
    }, 500);
  });
}

function guardarUrl(url) {
  let t = fs.readFileSync(RUTA_ENV, "utf8");
  t = /APP_URL=/.test(t) ? t.replace(/APP_URL=.*/, `APP_URL=${url}`) : t.trimEnd() + `\nAPP_URL=${url}\n`;
  fs.writeFileSync(RUTA_ENV, t);
}

(async () => {
  console.log("\n▸ Arrancando TiendaIQ…");
  matarViejos();

  process.stdout.write("  túnel      · levantando… ");
  const url = await levantarTunel();
  guardarUrl(url);
  console.log(url);

  // El server se arranca acá dentro para que herede el .env recién escrito.
  const server = spawn(process.execPath, ["server.js"], { cwd: __dirname, stdio: "inherit" });

  console.log("\n" + "─".repeat(64));
  console.log("  PEGÁ ESTO EN EL DEV DASHBOARD → TiendaIQ → Configuración → URLs:");
  console.log("");
  console.log("  URL de la app:");
  console.log("     " + url);
  console.log("");
  console.log("  URL de redireccionamiento:");
  console.log("     " + url + "/auth/callback");
  console.log("");
  console.log("  Después Publicar, y recargá la app en el admin.");
  console.log("─".repeat(64) + "\n");

  const cerrar = () => { try { process.kill(fs.readFileSync(RUTA_PID, "utf8").trim()); } catch {} server.kill(); process.exit(0); };
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
})().catch((e) => {
  console.error("\n✖ " + e.message + "\n");
  process.exit(1);
});
