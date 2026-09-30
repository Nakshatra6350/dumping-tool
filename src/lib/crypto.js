const crypto = require("crypto");
const config = require("../config");

// AES-256-GCM for database passwords stored at rest. The key is derived from
// ENCRYPTION_KEY so any sufficiently long string can be used.
const key = crypto.createHash("sha256").update(config.encryptionKey).digest();
const VERSION = "v1";

const encrypt = (plain) => {
  if (plain === undefined || plain === null || plain === "") return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
};

const decrypt = (payload) => {
  if (!payload) return "";
  const [version, iv, tag, data] = String(payload).split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Unsupported encrypted payload");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

module.exports = { encrypt, decrypt };
