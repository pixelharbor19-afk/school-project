// lib/encrypt.ts

const keyBytes = Uint8Array.from(
  process.env.AES_KEY!.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
);

const cryptoKeyPromise = crypto.subtle.importKey(
  "raw",
  keyBytes,
  "AES-GCM",
  false,
  ["encrypt"],
);

export async function encryptUrl(url: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await cryptoKeyPromise;

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(url),
  );

  const out = new Uint8Array(iv.length + encrypted.byteLength);

  out.set(iv, 0);
  out.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(out)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
