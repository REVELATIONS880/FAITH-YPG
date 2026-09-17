/**
 * Lightweight Client-Side ZIP Export Helper for SnapShare
 */
(function (global) {
  function ClientZip() {
    this.files = [];
  }

  ClientZip.prototype.add = function (filename, buffer) {
    this.files.push({ filename, buffer });
  };

  ClientZip.prototype.generateBlob = function () {
    // Standard PKzip store zip builder in client JS
    const localHeaders = [];
    const centralDirs = [];
    let offset = 0;

    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[i] = c;
    }

    function calcCRC32(uint8arr) {
      let crc = -1;
      for (let i = 0; i < uint8arr.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ uint8arr[i]) & 0xFF];
      }
      return (crc ^ (-1)) >>> 0;
    }

    const encoder = new TextEncoder();

    for (const file of this.files) {
      const filenameBuf = encoder.encode(file.filename);
      const fileBuf = file.buffer instanceof Uint8Array ? file.buffer : new Uint8Array(file.buffer);
      const crc = calcCRC32(fileBuf);
      const size = fileBuf.length;

      // Local Header (30 bytes + filename.length)
      const lh = new Uint8Array(30 + filenameBuf.length);
      const viewLh = new DataView(lh.buffer);
      viewLh.setUint32(0, 0x04034b50, true);
      viewLh.setUint16(4, 20, true);
      viewLh.setUint16(6, 0, true);
      viewLh.setUint16(8, 0, true);
      viewLh.setUint16(10, 0, true);
      viewLh.setUint16(12, 0, true);
      viewLh.setUint32(14, crc, true);
      viewLh.setUint32(18, size, true);
      viewLh.setUint32(22, size, true);
      viewLh.setUint16(26, filenameBuf.length, true);
      viewLh.setUint16(28, 0, true);
      lh.set(filenameBuf, 30);

      localHeaders.push(lh);
      localHeaders.push(fileBuf);

      // Central Directory Record (46 bytes + filename.length)
      const cd = new Uint8Array(46 + filenameBuf.length);
      const viewCd = new DataView(cd.buffer);
      viewCd.setUint32(0, 0x02014b50, true);
      viewCd.setUint16(4, 20, true);
      viewCd.setUint16(6, 20, true);
      viewCd.setUint16(8, 0, true);
      viewCd.setUint16(10, 0, true);
      viewCd.setUint16(12, 0, true);
      viewCd.setUint16(14, 0, true);
      viewCd.setUint32(16, crc, true);
      viewCd.setUint32(20, size, true);
      viewCd.setUint32(24, size, true);
      viewCd.setUint16(28, filenameBuf.length, true);
      viewCd.setUint16(30, 0, true);
      viewCd.setUint16(32, 0, true);
      viewCd.setUint16(34, 0, true);
      viewCd.setUint16(36, 0, true);
      viewCd.setUint32(38, 0, true);
      viewCd.setUint32(42, offset, true);
      cd.set(filenameBuf, 46);

      centralDirs.push(cd);
      offset += lh.length + fileBuf.length;
    }

    const cdStartOffset = offset;
    let cdSize = 0;
    for (const cd of centralDirs) cdSize += cd.length;

    const eocd = new Uint8Array(22);
    const viewEocd = new DataView(eocd.buffer);
    viewEocd.setUint32(0, 0x06054b50, true);
    viewEocd.setUint16(4, 0, true);
    viewEocd.setUint16(6, 0, true);
    viewEocd.setUint16(8, this.files.length, true);
    viewEocd.setUint16(10, this.files.length, true);
    viewEocd.setUint32(12, cdSize, true);
    viewEocd.setUint32(16, cdStartOffset, true);
    viewEocd.setUint16(20, 0, true);

    const blobParts = [...localHeaders, ...centralDirs, eocd];
    return new Blob(blobParts, { type: 'application/zip' });
  };

  global.ClientZip = ClientZip;
})(window);
