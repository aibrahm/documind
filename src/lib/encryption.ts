// src/lib/encryption.ts
//
// AES-256-GCM encryption for PRIVATE document content at rest. This
// replaces the previous crypto-js AES implementation, which was:
//
//   (a) not AEAD — ciphertexts were malleable because there was no
//       authentication tag, so an attacker with write access to the
//       database could silently flip bytes and we'd never notice
//   (b) based on an unmaintained library flagged by security audits
//   (c) un-versioned — every payload was the same opaque blob, with
//       no way to roll the key or migrate to a new algorithm without
//       a full re-encrypt pass
//
// The new format is AEAD (GCM) with a versioned envelope so future
// migrations are additive:
//
//   {
//     "v": 2,
//     "iv":  "<base64 12-byte nonce>",
//     "tag": "<base64 16-byte auth tag>",
//     "ct":  "<base64 ciphertext>"
//   }
//
// Key derivation: ENCRYPTION_KEY is treated as a passphrase and
// run through scrypt once at module load to produce a 32-byte key.
// The scrypt salt is fixed (see KEY_SALT below) because we need
// deterministic derivation from the same passphrase — rotating keys
// means rotating the env var itself and re-encrypting. If we later
// need full key rotation we'll add a `keyId` field to the envelope
// and support multiple derived keys; see CONCERNS.md.
//
// Version 1 ciphertexts (produced by the old crypto-js path) are NOT
// readable by this module. The product never reads `encrypted_content`
// back from the database today — it's write-only storage for audit —
// so existing rows are effectively archival and don't need migration.
// If a call site is added that needs to read legacy rows, we'll add
// a v1 reader that shells out to crypto-js once and re-encrypts the
// plaintext as v2.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit nonce — the GCM standard
const TAG_LENGTH = 16;  // 128-bit auth tag
const KEY_LENGTH = 32;  // 256-bit key
const VERSION = 2;

// A fixed salt means the same passphrase always produces the same key.
// That is intentional here — we are not protecting against offline
// dictionary attack on the passphrase (an attacker with the DB also
// usually has the env var); we are using scrypt as a consistent KDF
// so the 32-byte key is well-distributed regardless of passphrase
// shape (length, entropy, characters used).
const KEY_SALT = Buffer.from("gtez-intelligence-encryption-key-v2");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local or your deployment environment.`,
    );
  }
  return value;
}

// Derive the key once at first use and cache it. scryptSync is intentionally
// slow; we never want to pay that cost per-encryption.
let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const passphrase = requireEnv("ENCRYPTION_KEY");
  cachedKey = scryptSync(passphrase, KEY_SALT, KEY_LENGTH);
  return cachedKey;
}

interface EnvelopeV2 {
  v: 2;
  iv: string;
  tag: string;
  ct: string;
}

/**
 * Encrypt text content using AES-256-GCM.
 * Output is a JSON string containing a versioned envelope. Safe to store
 * in a text column.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope: EnvelopeV2 = {
    v: VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an AES-256-GCM envelope produced by `encrypt`.
 *
 * Throws loudly if the envelope is missing, the version is unknown, or
 * the auth tag does not verify. Per CLAUDE.md "Fail Loud, Never Fake":
 * we do not silently return the ciphertext as plaintext, and we do not
 * swallow tampering into a blank string.
 */
export function decrypt(ciphertext: string): string {
  let envelope: EnvelopeV2;
  try {
    envelope = JSON.parse(ciphertext) as EnvelopeV2;
  } catch {
    throw new Error(
      "decrypt: payload is not a valid JSON envelope — this may be " +
        "legacy crypto-js v1 data that the v2 reader cannot parse",
    );
  }
  if (envelope?.v !== VERSION) {
    throw new Error(
      `decrypt: unsupported envelope version (${envelope?.v ?? "undefined"}). ` +
        `Expected ${VERSION}.`,
    );
  }
  if (!envelope.iv || !envelope.tag || !envelope.ct) {
    throw new Error("decrypt: envelope is missing iv/tag/ct fields");
  }
  const key = getKey();
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  if (iv.length !== IV_LENGTH) {
    throw new Error(`decrypt: unexpected IV length ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`decrypt: unexpected auth tag length ${tag.length}`);
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}
