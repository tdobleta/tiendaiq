const gallery = [
  "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528407-sto6zivwkf.webp",
  "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528418-97huqwwzinj.webp",
  "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528359-2jmt14cqqyo.webp",
  "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528300-tjyeincsami.webp",
  "https://service.pagepilot.ai/storage/v1/object/public/builder/7f0e5ffb-fba5-4055-ae2f-818e455fa2f2/gallery-images/25627a22-38a7-4e90-88ac-bb785a68d0b7/1785944528847-jlteb40fktf.webp"
];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let toastTimer;

function addToCart(button) {
  const original = button.innerHTML;
  button.innerHTML = "AGREGADO AL CARRITO <span>&rarr;</span>";
  button.classList.add("is-added");
  document.querySelector(".cart-toast")?.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    button.innerHTML = original;
    button.classList.remove("is-added");
    document.querySelector(".cart-toast")?.classList.remove("is-visible");
  }, 2200);
}

document.querySelectorAll("[data-add-cart]").forEach((button) => {
  button.addEventListener("click", () => addToCart(button));
});

function setupTrack(track, previous, next, visible) {
  if (!track) return;
  const cards = [...track.children];
  let index = 0;
  const move = (direction) => {
    index = (index + direction + cards.length) % cards.length;
    const card = cards[index];
    const gap = parseFloat(getComputedStyle(track).gap) || 20;
    const offset = card.offsetLeft - track.offsetLeft;
    track.style.transform = `translate3d(${-Math.max(0, offset - gap)}px, 0, 0)`;
    cards.forEach((item, i) => item.classList.toggle("is-current", i === index));
  };
  previous?.addEventListener("click", () => move(-1));
  next?.addEventListener("click", () => move(1));
  window.addEventListener("resize", () => move(0));
  if (visible) visible(cards, index);
}

setupTrack(
  document.querySelector("[data-editorial-track]"),
  document.querySelector("[data-editorial-prev]"),
  document.querySelector("[data-editorial-next]")
);

setupTrack(
  document.querySelector("[data-review-track]"),
  document.querySelector("[data-reviews-prev]"),
  document.querySelector("[data-reviews-next]")
);

function fallbackTexture(THREE, label) {
  const surface = document.createElement("canvas");
  surface.width = 640;
  surface.height = 820;
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "#14243b";
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = "#c9d2c1";
  ctx.fillRect(42, 42, 556, 736);
  ctx.fillStyle = "#14243b";
  ctx.font = "700 42px Arial";
  ctx.fillText("NOIR ATELIER", 74, 136);
  ctx.font = "24px Arial";
  ctx.fillText(`SILK FIBER / ${label}`, 74, 178);
  ctx.strokeStyle = "#b86f54";
  ctx.lineWidth = 7;
  ctx.strokeRect(74, 234, 492, 408);
  ctx.fillStyle = "#b86f54";
  ctx.font = "700 96px Georgia";
  ctx.fillText("04", 214, 468);
  return new THREE.CanvasTexture(surface);
}

async function startOrbit() {
  const canvas = document.querySelector("#product-orbit");
  const shell = canvas?.closest(".canvas-shell");
  if (!canvas || !shell) return;
  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js").catch(() => null);
  if (!THREE) {
    shell.classList.add("is-3d-fallback");
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  camera.position.set(0, 0.08, 5.1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaeb9cb, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(-2.5, 3.5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb86f54, 1.8);
  rim.position.set(3, 0.8, 2);
  scene.add(rim);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const cards = gallery.map((src, index) => {
    const material = new THREE.MeshStandardMaterial({ map: fallbackTexture(THREE, `0${index + 1}`), roughness: 0.5, metalness: 0.04 });
    loader.load(src, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 3.1, 1, 1), material);
    scene.add(mesh);
    return mesh;
  });
  let active = 0;
  let orbit = 0;
  let targetOrbit = 0;
  let pointerX = 0;
  let pointerY = 0;
  const progress = document.querySelector(".orbit-progress b");
  const setActive = (next) => {
    active = (next + cards.length) % cards.length;
    targetOrbit = -(active * Math.PI * 2) / cards.length;
    if (progress) progress.style.width = `${((active + 1) / cards.length) * 100}%`;
    const counter = document.querySelector(".orbit-controls div span:last-child");
    if (counter) counter.textContent = `0${active + 1} - 0${cards.length}`;
  };
  document.querySelector("[data-orbit-next]")?.addEventListener("click", () => setActive(active + 1));
  document.querySelector("[data-orbit-prev]")?.addEventListener("click", () => setActive(active - 1));
  shell.addEventListener("pointermove", (event) => {
    const rect = shell.getBoundingClientRect();
    pointerX = (event.clientX - rect.left) / rect.width - 0.5;
    pointerY = (event.clientY - rect.top) / rect.height - 0.5;
  });
  shell.addEventListener("pointerleave", () => { pointerX = 0; pointerY = 0; });

  const resize = () => {
    const width = Math.max(280, shell.clientWidth);
    const height = Math.max(360, shell.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(shell);
  resize();
  setActive(0);
  let last = performance.now();
  let autoTime = 0;
  const render = (now) => {
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    autoTime += delta;
    if (!reduceMotion.matches && autoTime > 6.5) { autoTime = 0; setActive(active + 1); }
    orbit += (targetOrbit - orbit) * Math.min(1, delta * 5.5);
    cards.forEach((mesh, index) => {
      const relative = ((index * Math.PI * 2) / cards.length) + orbit;
      const depth = Math.cos(relative);
      mesh.position.set(Math.sin(relative) * 1.42, Math.sin(relative * 2) * 0.06, depth * 0.82);
      mesh.rotation.y = -relative * 0.34 + pointerX * 0.12;
      mesh.rotation.x = pointerY * 0.08;
      const scale = 0.75 + Math.max(0, depth) * 0.27;
      mesh.scale.setScalar(scale);
      mesh.material.opacity = 0.55 + Math.max(0, depth) * 0.45;
      mesh.material.transparent = true;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  requestAnimationFrame(render);
}

startOrbit();
