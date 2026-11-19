// Prepares a reference photo entirely in the browser:
//  - decodes the selected/captured file (EXIF orientation is applied by the browser),
//  - downsizes it to at most MAX_SIDE px,
//  - re-encodes it as JPEG, which drops all metadata (GPS location, device info…).

export const MAX_SIDE = 1024;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imageLoad'));
    };
    img.src = url;
  });
}

export async function prepareReferenceImage(file: Blob): Promise<PreparedImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('imageLoad');
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  // Release the canvas memory immediately (important on iOS).
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('imageLoad');
  return { blob, width, height };
}
