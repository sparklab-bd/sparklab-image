import type { ColorSwatch, ToolId } from '../types/imageTools';
import { injectSampleExifToJpeg } from './exifParser';

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image file.'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Browser failed to encode ${mimeType}.`));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

export async function convertToWebP(file: File, qualityPercent: number): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/webp', Math.max(0.1, Math.min(1, qualityPercent / 100)));
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(
  file: File,
  qualityPercent: number,
  outputFormat: 'auto' | 'jpeg' | 'webp'
): Promise<{ blob: Blob; ext: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    const q = Math.max(0.1, Math.min(1, qualityPercent / 100));
    const isPng = file.type === 'image/png';
    let targetMime = 'image/jpeg';
    let ext = 'jpg';

    if (outputFormat === 'webp') {
      targetMime = 'image/webp';
      ext = 'webp';
    } else if (outputFormat === 'jpeg') {
      targetMime = 'image/jpeg';
      ext = 'jpg';
    } else {
      // 'auto': keep PNG transparency by using lossless/lossy WebP when PNG would otherwise bloat, or JPEG for photos
      targetMime = isPng ? 'image/webp' : 'image/jpeg';
      ext = isPng ? 'webp' : 'jpg';
    }

    if (targetMime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, targetMime, q);
    return { blob, ext, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizeForSocial(
  file: File,
  targetWidth: number,
  targetHeight: number,
  fitMode: 'cover' | 'contain'
): Promise<{ blob: Blob; ext: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const srcRatio = srcW / srcH;
    const dstRatio = targetWidth / targetHeight;

    if (fitMode === 'cover') {
      // Smart center crop: fills exact dimensions with zero stretching
      let drawW = targetWidth;
      let drawH = targetHeight;
      let offsetX = 0;
      let offsetY = 0;

      if (srcRatio > dstRatio) {
        drawH = targetHeight;
        drawW = targetHeight * srcRatio;
        offsetX = (targetWidth - drawW) / 2;
      } else {
        drawW = targetWidth;
        drawH = targetWidth / srcRatio;
        offsetY = (targetHeight - drawH) / 2;
      }

      ctx.clearRect(0, 0, targetWidth, targetHeight);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    } else {
      // Fit inside with clean soft backdrop (zero cropping, zero stretching)
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      let drawW = targetWidth;
      let drawH = targetHeight;
      if (srcRatio > dstRatio) {
        drawW = targetWidth;
        drawH = targetWidth / srcRatio;
      } else {
        drawH = targetHeight;
        drawW = targetHeight * srcRatio;
      }
      const offsetX = (targetWidth - drawW) / 2;
      const offsetY = (targetHeight - drawH) / 2;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    }

    const isPng = file.type === 'image/png';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const ext = isPng ? 'png' : 'jpg';
    const blob = await canvasToBlob(canvas, mime, 0.92);
    return { blob, ext, width: targetWidth, height: targetHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function stripExifAndGps(file: File): Promise<{ blob: Blob; ext: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');

    const isPng = file.type === 'image/png';
    const isWebP = file.type === 'image/webp';
    const mime = isPng ? 'image/png' : isWebP ? 'image/webp' : 'image/jpeg';
    const ext = isPng ? 'png' : isWebP ? 'webp' : 'jpg';

    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Re-drawing onto Canvas completely strips all APP1/EXIF/GPS/XMP/IPTC/tEXt metadata chunks
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, mime, 0.94);
    return { blob, ext, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function colorDistSq(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export async function extractBrandPalette(file: File, colorCount = 6): Promise<ColorSwatch[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const sampleSize = 96;
    const scale = Math.min(1, sampleSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const pixels: Array<[number, number, number]> = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] >= 128) {
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
    }

    if (pixels.length === 0) {
      return [];
    }

    // Deterministic k-means++ initialization for crisp, reproducible brand palettes
    const centroids: Array<[number, number, number]> = [pixels[Math.floor(pixels.length / 2)]];
    while (centroids.length < colorCount) {
      let bestPixel = pixels[0];
      let bestDist = -1;
      for (let i = 0; i < pixels.length; i += 3) {
        const p = pixels[i];
        let minD = Infinity;
        for (const c of centroids) {
          const d = colorDistSq(p, c);
          if (d < minD) minD = d;
        }
        if (minD > bestDist) {
          bestDist = minD;
          bestPixel = p;
        }
      }
      if (bestDist <= 16) break;
      centroids.push([...bestPixel]);
    }

    // Run 10 fast k-means iterations
    const counts = new Array(centroids.length).fill(0);
    for (let iter = 0; iter < 10; iter++) {
      const sums = centroids.map(() => [0, 0, 0]);
      counts.fill(0);

      for (const p of pixels) {
        let bestIdx = 0;
        let minD = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const d = colorDistSq(p, centroids[c]);
          if (d < minD) {
            minD = d;
            bestIdx = c;
          }
        }
        sums[bestIdx][0] += p[0];
        sums[bestIdx][1] += p[1];
        sums[bestIdx][2] += p[2];
        counts[bestIdx]++;
      }

      for (let c = 0; c < centroids.length; c++) {
        if (counts[c] > 0) {
          centroids[c] = [
            Math.round(sums[c][0] / counts[c]),
            Math.round(sums[c][1] / counts[c]),
            Math.round(sums[c][2] / counts[c]),
          ];
        }
      }
    }

    const total = pixels.length;
    const swatches: ColorSwatch[] = centroids
      .map((c, idx) => ({
        r: c[0],
        g: c[1],
        b: c[2],
        hex: rgbToHex(c[0], c[1], c[2]),
        rgb: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
        percentage: Math.round((counts[idx] / total) * 100),
      }))
      .filter((s) => s.percentage > 0)
      .sort((a, b) => b.percentage - a.percentage);

    // Pad to 6 if image has fewer distinct colors
    while (swatches.length < colorCount && swatches.length > 0) {
      const base = swatches[swatches.length % swatches.length];
      swatches.push({ ...base, percentage: 0 });
    }

    return swatches.slice(0, colorCount);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function generatePaletteCardBlob(swatches: ColorSwatch[], title: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 520;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(`Brand Color Palette — ${title}`, 48, 64);

  const gap = 20;
  const cardW = (canvas.width - 96 - gap * (swatches.length - 1)) / swatches.length;
  swatches.forEach((swatch, idx) => {
    const x = 48 + idx * (cardW + gap);
    ctx.fillStyle = swatch.hex;
    ctx.fillRect(x, 100, cardW, 290);

    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, 100, cardW, 290);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(swatch.hex, x, 430);

    ctx.fillStyle = '#475569';
    ctx.font = '14px monospace';
    ctx.fillText(swatch.rgb, x, 460);
  });

  return await canvasToBlob(canvas, 'image/png');
}

export async function createSampleImage(tool: ToolId): Promise<File> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  if (tool === 'webp' || tool === 'palette') {
    // Transparent PNG brand mark + colorful geometric studio composition
    canvas.width = 960;
    canvas.height = 720;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rounded card backdrop with transparent outer margin (proves alpha preservation on WebP!)
    ctx.fillStyle = '#1E1B4B';
    ctx.beginPath();
    ctx.roundRect(80, 60, 800, 600, 48);
    ctx.fill();

    // Rich brand color blocks for Palette Extractor & WebP showcase
    const blocks: Array<{ x: number; y: number; w: number; h: number; color: string }> = [
      { x: 140, y: 120, w: 320, h: 240, color: '#6366F1' },
      { x: 480, y: 120, w: 340, h: 160, color: '#0EA5E9' },
      { x: 480, y: 300, w: 160, h: 180, color: '#F59E0B' },
      { x: 660, y: 300, w: 160, h: 180, color: '#10B981' },
      { x: 140, y: 380, w: 320, h: 100, color: '#F43F5E' },
    ];
    for (const b of blocks) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, 24);
      ctx.fill();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText('SPARK STUDIO', 140, 575);
    ctx.fillStyle = '#C7D2FE';
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('Transparent PNG Sample', 530, 575);

    const blob = await canvasToBlob(canvas, 'image/png');
    return new File([blob], tool === 'webp' ? 'sample-transparent-logo.png' : 'sample-brand-kit.png', {
      type: 'image/png',
    });
  }

  // High-detail scenic vector/gradient artwork for Compressor, Social Resizer, and EXIF Remover
  canvas.width = 1600;
  canvas.height = 1066;

  const sky = ctx.createLinearGradient(0, 0, 0, 700);
  sky.addColorStop(0, '#0F172A');
  sky.addColorStop(0.55, '#312E81');
  sky.addColorStop(1, '#6366F1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Sun / horizon glow
  const sun = ctx.createRadialGradient(1180, 420, 20, 1180, 420, 320);
  sun.addColorStop(0, '#FDE68A');
  sun.addColorStop(0.35, '#F59E0B');
  sun.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(700, 50, 900, 750);

  // Distant mountain range
  ctx.fillStyle = '#1E1B4B';
  ctx.beginPath();
  ctx.moveTo(0, 760);
  ctx.lineTo(240, 520);
  ctx.lineTo(480, 650);
  ctx.lineTo(790, 440);
  ctx.lineTo(1060, 620);
  ctx.lineTo(1340, 470);
  ctx.lineTo(1600, 660);
  ctx.lineTo(1600, 1066);
  ctx.lineTo(0, 1066);
  ctx.closePath();
  ctx.fill();

  // Foreground ridge
  ctx.fillStyle = '#0F172A';
  ctx.beginPath();
  ctx.moveTo(0, 860);
  ctx.lineTo(360, 690);
  ctx.lineTo(680, 820);
  ctx.lineTo(1050, 660);
  ctx.lineTo(1420, 800);
  ctx.lineTo(1600, 730);
  ctx.lineTo(1600, 1066);
  ctx.lineTo(0, 1066);
  ctx.closePath();
  ctx.fill();

  // Subtle architectural grid texture so compression comparison is visibly meaningful
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  for (let x = 0; x < canvas.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  let jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
  if (tool === 'exif') {
    jpegBlob = await injectSampleExifToJpeg(jpegBlob);
    return new File([jpegBlob], 'sample-photo-with-gps.jpg', { type: 'image/jpeg' });
  }

  return new File([jpegBlob], tool === 'resize' ? 'sample-landscape-photo.jpg' : 'sample-highres-photo.jpg', {
    type: 'image/jpeg',
  });
}
