// ============================================================
// IMÁGENES — subir archivos del merchant como media del producto.
//
// El editor deja elegir fotos del pool del producto; esto agrega la otra
// mitad: subir una foto nueva desde la compu. Se sube como MEDIA DEL
// PRODUCTO en Shopify (no como File suelto) a propósito: así entra al pool
// como cualquier otra foto y el Liquid publicado la resuelve solo con
// product.media, sin tocar nada más.
//
// Flujo (el estándar de Shopify):
//   1. stagedUploadsCreate  → URL temporal de subida
//   2. POST multipart       → los bytes van a ese bucket
//   3. productCreateMedia   → el archivo pasa a ser media del producto
//   4. poll hasta READY     → recién ahí hay URL de imagen
// ============================================================

const { env, gql, SHOPIFY_TIMEOUT_MS } = require("./shopify");

const SHOPIFY_MEDIA_TIMEOUT_MS = Math.min(
  120000,
  Math.max(15000, Number(env.SHOPIFY_MEDIA_TIMEOUT_MS) || 45000)
);

function mediaSignal(signal) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(SHOPIFY_MEDIA_TIMEOUT_MS)])
    : AbortSignal.timeout(SHOPIFY_MEDIA_TIMEOUT_MS);
}

function permanentMediaError(message, status = 422, { allowDegraded = true } = {}) {
  const error = new Error(message);
  error.status = status;
  error.nonRetryable = true;
  error.allowDegraded = allowDegraded;
  return error;
}

function ambiguousMediaError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "SHOPIFY_MEDIA_AMBIGUOUS";
  error.nonRetryable = true;
  return error;
}

function isAmbiguousTransportError(error) {
  return error?.code === "SHOPIFY_TIMEOUT"
    || error?.name === "AbortError"
    || error?.name === "TimeoutError"
    || Number(error?.status) >= 500;
}

function rethrowCreatedEffect(error, signal, message) {
  if (error?.nonRetryable === true && !signal?.aborted) throw error;
  throw ambiguousMediaError(message, error);
}

function bucketUploadError(status) {
  const error = new Error(`El bucket de Shopify rechazó la subida (HTTP ${status}).`);
  error.status = status;
  error.nonRetryable = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return error;
}

async function pollCreatedEffect(load, { attempts, signal, failed, pending }) {
  for (let i = 0; i < attempts; i += 1) {
    let value;
    try {
      value = await load();
    } catch (error) {
      throw ambiguousMediaError(pending, error);
    }
    if (value.ready) return value.result;
    if (value.failed) throw permanentMediaError(failed);
    try {
      await dormir(1000, signal);
    } catch (error) {
      throw ambiguousMediaError(pending, error);
    }
  }
  throw ambiguousMediaError(pending);
}

const M_STAGED = `mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const M_CREAR_MEDIA = `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id status } }
    mediaUserErrors { field message }
  }
}`;

const Q_MEDIA = `query($id: ID!) {
  node(id: $id) {
    ... on MediaImage { id status preview { image { url } } }
  }
}`;

const dormir = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

// Sube una imagen (base64) como media del producto. Devuelve { media_id, url }.
async function subirImagenProducto(sesion, productoGid, nombre, mime, base64, { signal } = {}) {
  const operationSignal = mediaSignal(signal);
  if (!/^image\//.test(mime)) throw permanentMediaError("Solo se pueden subir imágenes.", 400);
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 10 * 1024 * 1024) throw permanentMediaError("La imagen supera los 10 MB.", 413);
  const archivo = String(nombre || "imagen.jpg").replace(/[^\w.\-]+/g, "-").slice(-80);

  // 1. lugar de subida
  const r1 = await gql(
    M_STAGED,
    {
      input: [
        {
          filename: archivo,
          mimeType: mime,
          httpMethod: "POST",
          resource: "IMAGE",
          fileSize: String(buf.length)
        }
      ]
    },
    sesion,
    { signal: operationSignal }
  );
  if (r1.stagedUploadsCreate.userErrors?.length) {
    throw permanentMediaError("Subida: " + JSON.stringify(r1.stagedUploadsCreate.userErrors));
  }
  const destino = r1.stagedUploadsCreate.stagedTargets[0];

  // 2. los bytes
  const form = new FormData();
  for (const p of destino.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), archivo);
  const r2 = await fetch(destino.url, { method: "POST", body: form, signal: operationSignal });
  if (!r2.ok) throw bucketUploadError(r2.status);

  // 3. media del producto
  let r3;
  try {
    r3 = await gql(
      M_CREAR_MEDIA,
      {
        productId: productoGid,
        media: [{ originalSource: destino.resourceUrl, mediaContentType: "IMAGE", alt: "" }]
      },
      sesion,
      { signal: operationSignal }
    );
  } catch (error) {
    rethrowCreatedEffect(
      error,
      operationSignal,
      "Shopify pudo haber creado la media; no se repetirá automáticamente"
    );
  }
  if (r3.productCreateMedia.mediaUserErrors?.length) {
    throw permanentMediaError("Media: " + JSON.stringify(r3.productCreateMedia.mediaUserErrors));
  }
  const mediaId = r3.productCreateMedia.media[0]?.id;
  if (!mediaId) throw ambiguousMediaError("Shopify no confirmó qué media creó");

  // 4. esperar a que procese (suele tardar 1-3 segundos)
  return pollCreatedEffect(async () => {
    const n = (await gql(Q_MEDIA, { id: mediaId }, sesion, { signal: operationSignal })).node;
    return {
      ready: n?.status === "READY" && Boolean(n.preview?.image?.url),
      failed: n?.status === "FAILED",
      result: { media_id: mediaId, url: n?.preview?.image?.url }
    };
  }, {
    attempts: 15,
    signal: operationSignal,
    failed: "Shopify no pudo procesar la imagen.",
    pending: "La media fue creada pero su estado quedó ambiguo; no se repetirá automáticamente"
  });
}

// ---------- imágenes sueltas de la tienda (Files API) ----------
//
// Cuando no hay producto de contexto, la imagen se sube a
// Files de la tienda (fileCreate) y se usa su URL pública del CDN.

const M_FILE = `mutation($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus }
    userErrors { field message }
  }
}`;

const Q_FILE = `query($id: ID!) {
  node(id: $id) {
    ... on MediaImage { id fileStatus preview { image { url } } }
  }
}`;

async function subirImagenTienda(sesion, nombre, mime, base64, { signal } = {}) {
  const operationSignal = mediaSignal(signal);
  if (!/^image\//.test(mime)) throw permanentMediaError("Solo se pueden subir imágenes.", 400);
  const buf = Buffer.from(base64, "base64");
  if (buf.length > 10 * 1024 * 1024) throw permanentMediaError("La imagen supera los 10 MB.", 413);
  const archivo = String(nombre || "imagen.jpg").replace(/[^\w.\-]+/g, "-").slice(-80);

  const r1 = await gql(
    M_STAGED,
    {
      input: [{ filename: archivo, mimeType: mime, httpMethod: "POST", resource: "FILE", fileSize: String(buf.length) }]
    },
    sesion,
    { signal: operationSignal }
  );
  if (r1.stagedUploadsCreate.userErrors?.length) {
    throw permanentMediaError("Subida: " + JSON.stringify(r1.stagedUploadsCreate.userErrors));
  }
  const destino = r1.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of destino.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), archivo);
  const uploadSignal = AbortSignal.any([operationSignal, AbortSignal.timeout(SHOPIFY_TIMEOUT_MS)]);
  const r2 = await fetch(destino.url, { method: "POST", body: form, signal: uploadSignal });
  if (!r2.ok) throw bucketUploadError(r2.status);

  let r3;
  try {
    r3 = await gql(
      M_FILE,
      { files: [{ originalSource: destino.resourceUrl, contentType: "IMAGE", alt: "" }] },
      sesion,
      { signal: operationSignal }
    );
  } catch (error) {
    rethrowCreatedEffect(
      error,
      operationSignal,
      "Shopify pudo haber creado el archivo; no se repetirá automáticamente"
    );
  }
  if (r3.fileCreate.userErrors?.length) {
    throw permanentMediaError("Archivo: " + JSON.stringify(r3.fileCreate.userErrors));
  }
  const fileId = r3.fileCreate.files[0]?.id;
  if (!fileId) throw ambiguousMediaError("Shopify no confirmó qué archivo creó");

  return pollCreatedEffect(async () => {
    const n = (await gql(Q_FILE, { id: fileId }, sesion, { signal: operationSignal })).node;
    return {
      ready: n?.fileStatus === "READY" && Boolean(n.preview?.image?.url),
      failed: n?.fileStatus === "FAILED",
      result: { url: n?.preview?.image?.url }
    };
  }, {
    attempts: 15,
    signal: operationSignal,
    failed: "Shopify no pudo procesar la imagen.",
    pending: "El archivo fue creado pero su estado quedó ambiguo; no se repetirá automáticamente"
  });
}

// ---------- subida directa de archivos grandes (video) ----------
//
// El binario NO pasa por nuestro server (un mp4 en base64 reventaría el body):
// el server solo pide el destino temporal (paso 1) y finaliza el archivo una
// vez que el browser subió los bytes directo al bucket de Shopify (paso 3).

async function crearDestinoArchivo(sesion, nombre, mime, size, { signal } = {}) {
  const archivo = String(nombre || "video.mp4").replace(/[^\w.\-]+/g, "-").slice(-80);
  const r = await gql(
    M_STAGED,
    { input: [{ filename: archivo, mimeType: mime, httpMethod: "POST", resource: "FILE", fileSize: String(size) }] },
    sesion,
    { signal: mediaSignal(signal) }
  );
  if (r.stagedUploadsCreate.userErrors?.length) {
    throw permanentMediaError("Subida: " + JSON.stringify(r.stagedUploadsCreate.userErrors));
  }
  return r.stagedUploadsCreate.stagedTargets[0]; // { url, resourceUrl, parameters }
}

const M_FILE_GEN = `mutation($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus ... on GenericFile { url } ... on Video { originalSource { url } } }
    userErrors { field message }
  }
}`;

const Q_FILE_GEN = `query($id: ID!) {
  node(id: $id) {
    ... on GenericFile { id fileStatus url }
    ... on Video { id fileStatus originalSource { url } }
  }
}`;

// Finaliza: convierte el archivo subido en un File de la tienda y espera su URL.
async function finalizarArchivo(sesion, resourceUrl, mime, { signal } = {}) {
  const operationSignal = mediaSignal(signal);
  let r;
  try {
    r = await gql(
      M_FILE_GEN,
      { files: [{ originalSource: resourceUrl, contentType: /^video\//.test(mime || "") ? "FILE" : "FILE", alt: "" }] },
      sesion,
      { signal: operationSignal }
    );
  } catch (error) {
    rethrowCreatedEffect(
      error,
      operationSignal,
      "Shopify pudo haber finalizado el archivo; no se repetirá automáticamente"
    );
  }
  if (r.fileCreate.userErrors?.length) throw permanentMediaError("Archivo: " + JSON.stringify(r.fileCreate.userErrors));
  const f = r.fileCreate.files[0];
  const urlYa = f?.url || f?.originalSource?.url;
  if (urlYa) return { url: urlYa };
  const id = f?.id;
  if (!id) throw ambiguousMediaError("Shopify no confirmó qué archivo creó");
  return pollCreatedEffect(async () => {
    const n = (await gql(Q_FILE_GEN, { id }, sesion, { signal: operationSignal })).node;
    const url = n?.url || n?.originalSource?.url;
    return {
      ready: n?.fileStatus === "READY" && Boolean(url),
      failed: n?.fileStatus === "FAILED",
      result: { url }
    };
  }, {
    attempts: 20,
    signal: operationSignal,
    failed: "Shopify no pudo procesar el archivo.",
    pending: "El archivo fue creado pero su estado quedó ambiguo; no se repetirá automáticamente"
  });
}

module.exports = {
  SHOPIFY_MEDIA_TIMEOUT_MS,
  ambiguousMediaError,
  bucketUploadError,
  crearDestinoArchivo,
  finalizarArchivo,
  pollCreatedEffect,
  rethrowCreatedEffect,
  permanentMediaError,
  subirImagenProducto,
  subirImagenTienda
};
