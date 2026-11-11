/** Image bounds/signature inspection without decoding pixels or stripping animation. */
export function metadataImageHeader(bytes: Uint8Array): { extension: string; mime: string; width?: number; height?: number } | null {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.slice(at, at + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG') return { extension: 'png', mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return { extension: 'gif', mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (ascii(12, 4) === 'VP8X') return { extension: 'webp', mime: 'image/webp', width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (ascii(12, 4) === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return { extension: 'webp', mime: 'image/webp', width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    if (ascii(12, 4) === 'VP8L' && bytes[20] === 47) return { extension: 'webp', mime: 'image/webp', width: 1 + bytes[21] + ((bytes[22] & 63) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10) };
    return null;
  }
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1]; if (marker === 216 || marker === 217) { offset += 2; continue; }
      const size = view.getUint16(offset + 2); if (size < 2 || offset + size + 2 > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { extension: 'jpg', mime: 'image/jpeg', width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += 2 + size;
    }
  }
  return null;
}
export function validMetadataImageBounds(header: ReturnType<typeof metadataImageHeader>): boolean {
  return !!header && !!header.width && !!header.height && header.width <= 8192 && header.height <= 8192 && header.width * header.height <= 20_000_000;
}
