import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  authTag: string;
}

function decodeKey(encoded: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    throw new Error("invalid envelope key");
  }
  if (key.length !== 32) throw new Error("invalid envelope key: expected 256 bits");
  return key;
}

export function connectionEnvelopeKey(): string {
  const value = process.env.HARMONIA_CONNECTION_ENVELOPE_KEY;
  if (!value) throw new Error("connection envelope key is not configured");
  return value;
}

export function encryptSecret(plaintext: string, encodedKey: string, associatedData: string): SecretEnvelope {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(envelope: SecretEnvelope, encodedKey: string, associatedData: string): string {
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new Error("unsupported secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", decodeKey(encodedKey), Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
