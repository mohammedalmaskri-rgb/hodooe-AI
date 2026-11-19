// Local PIN for the admin dashboard. This separates the admin UI from the teacher UI on a
// shared device; it is NOT real security (a static site has no server to enforce access).

export const PIN_PATTERN = /^\d{4,8}$/;

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/** SHA-256(salt:pin) as hex. Requires a secure context (HTTPS or localhost). */
export async function hashPin(pin: string, salt: string): Promise<string> {
  if (!crypto?.subtle) throw new Error('insecureContext');
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}
