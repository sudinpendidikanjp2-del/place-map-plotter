export interface PreparedImage {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  mime: string;
  preview: string;
}

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("Peramban tidak bisa memproses gambar ini.");
  return jpeg;
}

function draw(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Peramban tidak bisa memproses gambar ini.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Mengecilkan gambar di peramban sebelum diunggah: versi penuh maksimal 1600 px dan thumbnail 400 px.
 * Dikodekan ulang lewat kanvas, sehingga metadata EXIF (termasuk koordinat GPS kamera) ikut terbuang.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} bukan berkas gambar.`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} lebih dari 25 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} tidak bisa dibaca sebagai gambar.`);
  }
  try {
    const fullCanvas = draw(bitmap, 1600);
    const full = await encode(fullCanvas, 0.82);
    const thumb = await encode(draw(bitmap, 400), 0.75);
    return { full, thumb, width: fullCanvas.width, height: fullCanvas.height, mime: full.type, preview: URL.createObjectURL(thumb) };
  } finally {
    bitmap.close();
  }
}
