import fs from "fs";
import path from "path";
import zlib from "zlib";

// Pre-computed CRC-32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function dosDateTime(d = new Date()) {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Builds a standard PKZIP buffer from a list of files.
 * @param {Array<{ name: string, content: Buffer | string, date?: Date }>} files
 * @returns {Buffer}
 */
export function buildZipBuffer(files) {
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const file of files) {
    let cleanName = file.name.replace(/\\/g, "/");
    while (cleanName.startsWith("./") || cleanName.startsWith("/")) {
      cleanName = cleanName.replace(/^(\.\/|\/)+/, "");
    }

    const nameBuf = Buffer.from(cleanName, "utf8");
    const dataBuf = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content || "", "utf8");
    const compressed = zlib.deflateRawSync(dataBuf, { level: 6 });
    const crc = crc32(dataBuf);
    const { time, date } = dosDateTime(file.date || new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // Flags: UTF-8 encoding
    localHeader.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);         // Extra field length

    localParts.push(localHeader, nameBuf, compressed);

    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);    // Central directory header signature
    cdHeader.writeUInt16LE(20, 4);            // Version made by (2.0 DOS)
    cdHeader.writeUInt16LE(20, 6);            // Version needed to extract (2.0)
    cdHeader.writeUInt16LE(0x0800, 8);        // Flags: UTF-8
    cdHeader.writeUInt16LE(8, 10);            // Deflate
    cdHeader.writeUInt16LE(time, 12);
    cdHeader.writeUInt16LE(date, 14);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(compressed.length, 20);
    cdHeader.writeUInt32LE(dataBuf.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);            // Extra field length
    cdHeader.writeUInt16LE(0, 32);            // Comment length
    cdHeader.writeUInt16LE(0, 34);            // Disk number start
    cdHeader.writeUInt16LE(0, 36);            // Internal file attributes
    cdHeader.writeUInt32LE(0x81a40000, 38);   // External attributes (-rw-r--r--)
    cdHeader.writeUInt32LE(offset, 42);       // Relative offset of local header

    cdParts.push(cdHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // End of central directory signature
  eocd.writeUInt16LE(0, 4);                   // Number of this disk
  eocd.writeUInt16LE(0, 6);                   // Disk where central directory starts
  eocd.writeUInt16LE(files.length, 8);        // Number of central dir records on this disk
  eocd.writeUInt16LE(files.length, 10);       // Total number of central dir records
  eocd.writeUInt32LE(cdBuf.length, 12);       // Size of central directory
  eocd.writeUInt32LE(offset, 16);             // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                  // Zip file comment length

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

/**
 * Recursively scans directory and compiles it into a standard zip file.
 * @param {string} sourceDir
 * @param {string} targetZipPath
 */
export async function zipDirectory(sourceDir, targetZipPath) {
  const fileEntries = [];

  function scan(dir, baseRel = "") {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const full = path.join(dir, item);
      const rel = baseRel ? `${baseRel}/${item}` : item;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scan(full, rel);
      } else if (stat.isFile()) {
        fileEntries.push({
          name: rel,
          content: fs.readFileSync(full),
          date: stat.mtime,
        });
      }
    }
  }

  scan(sourceDir);

  const destDir = path.dirname(targetZipPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const zipBuf = buildZipBuffer(fileEntries);
  fs.writeFileSync(targetZipPath, zipBuf);
  return zipBuf.length;
}
