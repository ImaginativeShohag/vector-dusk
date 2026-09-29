/* Small ZIP32 writer using the uncompressed STORE method. No dependencies. */
window.VectorStudioZip = (files) => {
  const encoder = new TextEncoder();
  const chunks = [],
    directory = [];
  let offset = 0;
  const record = (size) => {
    const bytes = new Uint8Array(size);
    return { bytes, view: new DataView(bytes.buffer) };
  };
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  if (files.length > 65535) throw new Error('Too many files for a ZIP archive.');
  for (const file of files) {
    const name = encoder.encode(file.name),
      data = encoder.encode(file.text),
      crc = crc32(data);
    if (name.length > 65535 || offset + data.length > 0xffffffff)
      throw new Error('ZIP archive is too large.');
    const local = record(30);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x0800, true); // UTF-8 names.
    local.view.setUint16(12, 33, true); // 1980-01-01, deterministic archive metadata.
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    chunks.push(local.bytes, name, data);
    const central = record(46);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, 0x0800, true);
    central.view.setUint16(14, 33, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, data.length, true);
    central.view.setUint32(24, data.length, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint32(42, offset, true);
    directory.push(central.bytes, name);
    offset += 30 + name.length + data.length;
  }
  const size = directory.reduce((n, bytes) => n + bytes.length, 0);
  const end = record(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, size, true);
  end.view.setUint32(16, offset, true);
  const all = [...chunks, ...directory, end.bytes];
  const bytes = new Uint8Array(offset + size + 22);
  let cursor = 0;
  for (const chunk of all) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return bytes;
};
