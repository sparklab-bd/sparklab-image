import type { ExifReport, ExifTagEntry } from '../types/imageTools';

function readAscii(view: DataView, offset: number, length: number): string {
  const chars: string[] = [];
  const end = Math.min(view.byteLength, offset + length);
  for (let i = offset; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    if (code >= 32 && code <= 126) {
      chars.push(String.fromCharCode(code));
    }
  }
  return chars.join('').trim();
}

function readRational(view: DataView, offset: number, littleEndian: boolean, signed = false): number {
  if (offset + 8 > view.byteLength) return 0;
  const num = signed ? view.getInt32(offset, littleEndian) : view.getUint32(offset, littleEndian);
  const den = signed ? view.getInt32(offset + 4, littleEndian) : view.getUint32(offset + 4, littleEndian);
  if (den === 0) return 0;
  return num / den;
}

function formatGpsCoord(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  ref: string
): string | null {
  if (offset + 24 > view.byteLength) return null;
  const deg = readRational(view, offset, littleEndian);
  const min = readRational(view, offset + 8, littleEndian);
  const sec = readRational(view, offset + 16, littleEndian);
  if (Number.isNaN(deg) || Number.isNaN(min) || Number.isNaN(sec)) return null;
  const decimal = (deg + min / 60 + sec / 3600).toFixed(5);
  return `${deg.toFixed(0)}° ${min.toFixed(0)}' ${sec.toFixed(2)}" ${ref || ''} (${decimal}°)`.trim();
}

function parseIfdEntries(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean
): Array<{ tag: number; type: number; count: number; valueOffset: number; rawValuePos: number }> {
  const absOffset = tiffStart + ifdOffset;
  if (absOffset + 2 > view.byteLength) return [];
  const count = view.getUint16(absOffset, littleEndian);
  const entries: Array<{ tag: number; type: number; count: number; valueOffset: number; rawValuePos: number }> = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = absOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const valCount = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
    entries.push({ tag, type, count: valCount, valueOffset, rawValuePos: entryOffset + 8 });
  }
  return entries;
}

function getTagAscii(
  view: DataView,
  tiffStart: number,
  entry: { type: number; count: number; valueOffset: number; rawValuePos: number }
): string {
  if (entry.type !== 2 || entry.count === 0) return '';
  if (entry.count <= 4) {
    return readAscii(view, entry.rawValuePos, entry.count);
  }
  return readAscii(view, tiffStart + entry.valueOffset, entry.count);
}

function getTagShort(
  view: DataView,
  entry: { type: number; rawValuePos: number },
  littleEndian: boolean
): number {
  if (entry.type === 3) {
    return view.getUint16(entry.rawValuePos, littleEndian);
  }
  return view.getUint32(entry.rawValuePos, littleEndian);
}

export async function parseImageMetadata(blob: Blob): Promise<ExifReport> {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const tags: ExifTagEntry[] = [];
  let orientation = 1;

  // Check JPEG SOI (0xFFD8)
  if (view.byteLength > 12 && view.getUint16(0, false) === 0xffd8) {
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffda || marker === 0xffd9) break;
      const segLength = view.getUint16(offset, false);
      if (segLength < 2) break;

      // APP1 Exif
      if (marker === 0xffe1 && offset + 8 < view.byteLength) {
        const header = readAscii(view, offset + 2, 4);
        if (header === 'Exif') {
          const tiffStart = offset + 8;
          if (tiffStart + 8 <= view.byteLength) {
            const byteOrder = view.getUint16(tiffStart, false);
            const littleEndian = byteOrder === 0x4949;
            const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
            const ifd0 = parseIfdEntries(view, tiffStart, firstIfdOffset, littleEndian);

            let exifIfdPointer = 0;
            let gpsIfdPointer = 0;

            for (const entry of ifd0) {
              if (entry.tag === 0x010f) {
                const v = getTagAscii(view, tiffStart, entry);
                if (v) tags.push({ label: 'Camera Make', value: v });
              } else if (entry.tag === 0x0110) {
                const v = getTagAscii(view, tiffStart, entry);
                if (v) tags.push({ label: 'Camera Model', value: v });
              } else if (entry.tag === 0x0131) {
                const v = getTagAscii(view, tiffStart, entry);
                if (v) tags.push({ label: 'Software', value: v });
              } else if (entry.tag === 0x0132) {
                const v = getTagAscii(view, tiffStart, entry);
                if (v) tags.push({ label: 'Modified Date', value: v });
              } else if (entry.tag === 0x0112) {
                orientation = getTagShort(view, entry, littleEndian) || 1;
                tags.push({ label: 'Orientation', value: `EXIF #${orientation}` });
              } else if (entry.tag === 0x8769) {
                exifIfdPointer = entry.valueOffset;
              } else if (entry.tag === 0x8825) {
                gpsIfdPointer = entry.valueOffset;
              }
            }

            if (exifIfdPointer > 0) {
              const exifEntries = parseIfdEntries(view, tiffStart, exifIfdPointer, littleEndian);
              for (const entry of exifEntries) {
                if (entry.tag === 0x9003) {
                  const v = getTagAscii(view, tiffStart, entry);
                  if (v) tags.push({ label: 'Date Taken', value: v, sensitive: true });
                } else if (entry.tag === 0xa434) {
                  const v = getTagAscii(view, tiffStart, entry);
                  if (v) tags.push({ label: 'Lens Model', value: v });
                } else if (entry.tag === 0x829a && entry.count === 1) {
                  const exp = readRational(view, tiffStart + entry.valueOffset, littleEndian);
                  if (exp > 0) {
                    const formatted = exp < 1 ? `1/${Math.round(1 / exp)}s` : `${exp.toFixed(1)}s`;
                    tags.push({ label: 'Exposure', value: formatted });
                  }
                } else if (entry.tag === 0x829d && entry.count === 1) {
                  const fnum = readRational(view, tiffStart + entry.valueOffset, littleEndian);
                  if (fnum > 0) tags.push({ label: 'Aperture', value: `f/${fnum.toFixed(1)}` });
                } else if (entry.tag === 0x8827) {
                  const iso = getTagShort(view, entry, littleEndian);
                  if (iso > 0) tags.push({ label: 'ISO Speed', value: `ISO ${iso}` });
                }
              }
            }

            if (gpsIfdPointer > 0) {
              const gpsEntries = parseIfdEntries(view, tiffStart, gpsIfdPointer, littleEndian);
              let latRef = 'N';
              let lonRef = 'E';
              let latOffset = 0;
              let lonOffset = 0;
              let altOffset = 0;

              for (const entry of gpsEntries) {
                if (entry.tag === 1) latRef = getTagAscii(view, tiffStart, entry) || 'N';
                if (entry.tag === 2) latOffset = tiffStart + entry.valueOffset;
                if (entry.tag === 3) lonRef = getTagAscii(view, tiffStart, entry) || 'E';
                if (entry.tag === 4) lonOffset = tiffStart + entry.valueOffset;
                if (entry.tag === 6) altOffset = tiffStart + entry.valueOffset;
              }

              if (latOffset > 0) {
                const latStr = formatGpsCoord(view, latOffset, littleEndian, latRef);
                if (latStr) tags.push({ label: 'GPS Latitude', value: latStr, sensitive: true });
              }
              if (lonOffset > 0) {
                const lonStr = formatGpsCoord(view, lonOffset, littleEndian, lonRef);
                if (lonStr) tags.push({ label: 'GPS Longitude', value: lonStr, sensitive: true });
              }
              if (altOffset > 0) {
                const alt = readRational(view, altOffset, littleEndian);
                if (alt > 0) tags.push({ label: 'GPS Altitude', value: `${alt.toFixed(1)} m`, sensitive: true });
              }
            }
          }
        } else if (readAscii(view, offset + 2, 28).includes('http://ns.adobe.com/xap')) {
          tags.push({ label: 'XMP Metadata', value: 'Embedded XML packet present', sensitive: true });
        }
      } else if (marker === 0xffed) {
        tags.push({ label: 'IPTC / Photoshop', value: 'Embedded profile metadata' });
      }

      offset += segLength;
    }
  }

  // Check PNG tEXt / iTXt / eXIf chunks
  if (
    view.byteLength > 8 &&
    view.getUint32(0, false) === 0x89504e47 &&
    view.getUint32(4, false) === 0x0d0a1a0a
  ) {
    let offset = 8;
    while (offset + 12 <= view.byteLength) {
      const len = view.getUint32(offset, false);
      const type = readAscii(view, offset + 4, 4);
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
        const snippet = readAscii(view, offset + 8, Math.min(len, 80));
        if (snippet) {
          const [key, ...rest] = snippet.split('\0');
          tags.push({
            label: `PNG ${type}: ${key || 'Comment'}`,
            value: rest.join(' ').trim() || 'Embedded text chunk',
          });
        }
      } else if (type === 'eXIf') {
        tags.push({ label: 'PNG eXIf Chunk', value: `${len} bytes of EXIF data`, sensitive: true });
      }
      if (type === 'IEND') break;
      offset += 12 + len;
    }
  }

  return {
    hasMetadata: tags.length > 0,
    tags,
    orientation,
  };
}

/**
 * Injects a minimal valid EXIF APP1 segment (Camera Make/Model, DateTimeOriginal, and GPS Latitude/Longitude)
 * into a clean JPEG Blob so the "Try Sample" button on EXIF Remover demonstrates real binary EXIF & GPS detection.
 */
export async function injectSampleExifToJpeg(cleanJpegBlob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await cleanJpegBlob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return cleanJpegBlob;
  }

  // Build big-endian TIFF structure with IFD0 + ExifIFD + GPSIFD
  const buf = new Uint8Array(512);
  const view = new DataView(buf.buffer);
  let cursor = 0;

  const writeAscii = (pos: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      buf[pos + i] = text.charCodeAt(i);
    }
    buf[pos + text.length] = 0;
  };

  // APP1 marker + placeholder length
  view.setUint16(0, 0xffe1, false);
  // 2..3 = length
  writeAscii(4, 'Exif');
  buf[9] = 0; // "Exif\0\0"

  const tiff = 10;
  // TIFF header: MM (0x4D4D), 42 (0x002A), IFD0 offset (8)
  view.setUint16(tiff, 0x4d4d, false);
  view.setUint16(tiff + 2, 42, false);
  view.setUint32(tiff + 4, 8, false);

  // IFD0 at tiff + 8: 4 entries (Make, Model, ExifIFD, GPSIFD)
  const ifd0 = tiff + 8;
  view.setUint16(ifd0, 4, false);
  cursor = ifd0 + 2 + 4 * 12 + 4; // after entries + next IFD=0

  const writeEntry = (pos: number, tag: number, type: number, count: number, valOrOffset: number) => {
    view.setUint16(pos, tag, false);
    view.setUint16(pos + 2, type, false);
    view.setUint32(pos + 4, count, false);
    view.setUint32(pos + 8, valOrOffset, false);
  };

  const makeStr = 'SparkCam';
  writeAscii(cursor, makeStr);
  writeEntry(ifd0 + 2, 0x010f, 2, makeStr.length + 1, cursor - tiff);
  cursor += makeStr.length + 1;

  const modelStr = 'Model X-200';
  writeAscii(cursor, modelStr);
  writeEntry(ifd0 + 14, 0x0110, 2, modelStr.length + 1, cursor - tiff);
  cursor += modelStr.length + 1;

  // Exif IFD starts at cursor
  const exifIfdOffset = cursor - tiff;
  writeEntry(ifd0 + 26, 0x8769, 4, 1, exifIfdOffset);

  // GPS IFD will come after Exif IFD
  const exifIfdPos = cursor;
  view.setUint16(exifIfdPos, 1, false); // 1 entry: DateTimeOriginal
  cursor = exifIfdPos + 2 + 1 * 12 + 4;
  const dateStr = '2026:11:24 12:30:00';
  writeAscii(cursor, dateStr);
  writeEntry(exifIfdPos + 2, 0x9003, 2, dateStr.length + 1, cursor - tiff);
  cursor += dateStr.length + 1;

  // GPS IFD
  const gpsIfdOffset = cursor - tiff;
  writeEntry(ifd0 + 38, 0x8825, 4, 1, gpsIfdOffset);

  const gpsIfdPos = cursor;
  view.setUint16(gpsIfdPos, 4, false); // LatRef, Lat, LonRef, Lon
  cursor = gpsIfdPos + 2 + 4 * 12 + 4;

  // Tag 1: GPSLatitudeRef = "N\0\0\0" (inline 4 bytes)
  view.setUint16(gpsIfdPos + 2, 1, false);
  view.setUint16(gpsIfdPos + 4, 2, false);
  view.setUint32(gpsIfdPos + 6, 2, false);
  buf[gpsIfdPos + 10] = 'N'.charCodeAt(0);
  buf[gpsIfdPos + 11] = 0;

  // Tag 2: GPSLatitude = 37° 46' 30.00"
  writeEntry(gpsIfdPos + 14, 2, 5, 3, cursor - tiff);
  view.setUint32(cursor, 37, false); view.setUint32(cursor + 4, 1, false);
  view.setUint32(cursor + 8, 46, false); view.setUint32(cursor + 12, 1, false);
  view.setUint32(cursor + 16, 3000, false); view.setUint32(cursor + 20, 100, false);
  cursor += 24;

  // Tag 3: GPSLongitudeRef = "W\0\0\0"
  view.setUint16(gpsIfdPos + 26, 3, false);
  view.setUint16(gpsIfdPos + 28, 2, false);
  view.setUint32(gpsIfdPos + 30, 2, false);
  buf[gpsIfdPos + 34] = 'W'.charCodeAt(0);
  buf[gpsIfdPos + 35] = 0;

  // Tag 4: GPSLongitude = 122° 25' 9.84"
  writeEntry(gpsIfdPos + 38, 4, 5, 3, cursor - tiff);
  view.setUint32(cursor, 122, false); view.setUint32(cursor + 4, 1, false);
  view.setUint32(cursor + 8, 25, false); view.setUint32(cursor + 12, 1, false);
  view.setUint32(cursor + 16, 984, false); view.setUint32(cursor + 20, 100, false);
  cursor += 24;

  // Set APP1 segment length (excludes 2-byte marker 0xFFE1)
  view.setUint16(2, cursor - 2, false);

  const app1Segment = buf.slice(0, cursor);
  const restOfJpeg = bytes.slice(2);
  return new Blob([bytes.slice(0, 2), app1Segment, restOfJpeg], { type: 'image/jpeg' });
}
