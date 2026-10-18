// Field names that look like credentials: password, passwd, passphrase, api_key / apiKey, secret, token.
// Deliberately NOT a bare "key": get_domain_verification_key returns a public `key` field.
const SENSITIVE_KEY = /pass(word|wd|phrase)|api[_-]?key|secret|token/i;

/**
 * Defence in depth: masks credential-looking string fields in an API payload
 * before it is handed to the model. The documented responses contain none, but
 * an unexpected echo of a credential should not reach the LLM context.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const masked = SENSITIVE_KEY.test(key) && typeof v === "string" ? "[redacted]" : redact(v, depth + 1);
      // defineProperty so an own "__proto__" key stays a plain property
      Object.defineProperty(out, key, { value: masked, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}
