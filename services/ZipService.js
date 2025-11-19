const JSZip = require("jszip");

const isBufferLike = (value) => Buffer.isBuffer(value) || value instanceof Uint8Array;

const createZipFromEntries = async (entries, options = {}) => {
  if (!Array.isArray(entries)) {
    throw new TypeError("entries must be an array");
  }

  const zip = new JSZip();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new TypeError("Each entry must be an object with path and contents");
    }
    const { path, contents, fileOptions } = entry;
    if (typeof path !== "string" || path.trim().length === 0) {
      throw new TypeError("Each entry must provide a non-empty string path");
    }
    if (!isBufferLike(contents) && typeof contents !== "string") {
      throw new TypeError(`Unsupported contents type for ${path}. Use string or Buffer.`);
    }
    zip.file(path, contents, fileOptions);
  });

  const compression = options.compression ?? "DEFLATE";
  const compressionOptions = options.compressionOptions ?? { level: 9 };

  return zip.generateAsync({
    type: "nodebuffer",
    compression,
    compressionOptions,
    streamFiles: true,
  });
};

module.exports = {
  createZipFromEntries,
};
