const gallery = [
  "https://cdn.shopify.com/s/files/1/0983/3906/2127/files/Sdd02b8ceb4a4455bb744c725421da3cfs.webp?v=1783726442",
  "https://cdn.shopify.com/s/files/1/0983/3906/2127/files/S2090cd9021a8461db131c5b80d4e5b6bj.webp?v=1783726443",
  "https://cdn.shopify.com/s/files/1/0983/3906/2127/files/S4ac92627db4e42b8adcf5dd6f2ea6db9J.webp?v=1783726442",
  "https://cdn.shopify.com/s/files/1/0983/3906/2127/files/Sec95ad5d45b54d5ea4a10511607e2c92g.webp?v=1783726442",
  "https://cdn.shopify.com/s/files/1/0983/3906/2127/files/Sa1ff52b1009f4ac8af933fc449c614fa7.webp?v=1783726442"
];
let galleryIndex = 0;
const mainImage = document.querySelector("#main-image");
const thumbs = [...document.querySelectorAll("[data-gallery]")];

function showGallery(index) {
  galleryIndex = (index + gallery.length) % gallery.length;
  mainImage.src = gallery[galleryIndex];
  thumbs.forEach((thumb, i) => thumb.classList.toggle("is-active", i === galleryIndex));
}

thumbs.forEach((thumb) => thumb.addEventListener("click", () => showGallery(Number(thumb.dataset.gallery))));
document.querySelector("[data-gallery-prev]")?.addEventListener("click", () => showGallery(galleryIndex - 1));
document.querySelector("[data-gallery-next]")?.addEventListener("click", () => showGallery(galleryIndex + 1));

document.querySelectorAll(".option").forEach((option) => option.addEventListener("click", () => {
  document.querySelectorAll(".option").forEach((item) => item.classList.toggle("is-selected", item === option));
}));

const toast = document.querySelector(".toast");
let toastTimer;
document.querySelectorAll("[data-add-cart]").forEach((button) => button.addEventListener("click", () => {
  const count = document.querySelector(".bag-count");
  count.textContent = String(Number(count.textContent || 0) + 1);
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}));

document.querySelectorAll("[data-scroll-buy]").forEach((button) => button.addEventListener("click", () => {
  document.querySelector("#comprar")?.scrollIntoView({ behavior: "smooth", block: "center" });
}));
