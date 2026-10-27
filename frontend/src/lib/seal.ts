// Mirrors generator/src/spot_the_forgery/seal.py: a SHA-256 chain keystream XORed
// over UTF-8 JSON, then base64. Obfuscation only; fixtures/sealed-sample.json keeps
// the two implementations in step.
import type { SealedPayload } from "./types";

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

async function keystream(date: string, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  let block = await sha256(new TextEncoder().encode(`${date}:spot-the-forgery`));
  for (let offset = 0; offset < length; offset += block.length) {
    out.set(block.subarray(0, length - offset), offset);
    block = await sha256(block);
  }
  return out;
}

export async function unseal(sealed: string, date: string): Promise<SealedPayload> {
  const data = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
  const key = await keystream(date, data.length);
  const raw = data.map((b, i) => b ^ key[i]);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as SealedPayload;
}
