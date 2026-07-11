// Payload dictionary for this project's audited categories (TEXT, PASSWORD, UNKNOWN).
// Keys are referenced by AuditingRuleCatalog.json behavioral rules via dataStrategyPayload field.
// Trimmed from the full ATG payload catalog to only the keys this demo's rule set uses.
export const DataStrategyPayloads: Record<string, string> = {
  // ─── PASSWORD ────────────────────────────────────────────────────────────
  PAYLOAD_PWD_TOO_SHORT: '1234567',
  PAYLOAD_PWD_MIN_VALID: '12345678',
  PAYLOAD_PWD_TYPICAL_VALID: 'Password1',
  PAYLOAD_PWD_EMPTY_STRING: '',
  PAYLOAD_PWD_ONLY_SPACES: '       ',
  PAYLOAD_PWD_128_CHARS: 'A'.repeat(64) + 'b'.repeat(32) + '1'.repeat(16) + '!'.repeat(16),
  PAYLOAD_PWD_129_CHARS: 'A'.repeat(64) + 'b'.repeat(32) + '1'.repeat(17) + '!'.repeat(16),
  PAYLOAD_PWD_SPECIAL_CHARS: 'P@ssw0rd!',
  PAYLOAD_PWD_EXTENDED_LATIN: 'Árbol$2026!',
  PAYLOAD_PWD_UNICODE: '安全Pass123!',
  PAYLOAD_PWD_INTERNAL_SPACES: 'mi clave segura',
  PAYLOAD_PWD_LEADING_SPACE: ' password123',
  PAYLOAD_PWD_ULTRA_SHORT: '123',
  PAYLOAD_PWD_NO_NUMBERS: 'PasswordQwerty',
  PAYLOAD_PWD_NO_SPECIALS: 'Password1234',
  PAYLOAD_PWD_NO_UPPERCASE: 'password1234!',

  // ─── TEXT ────────────────────────────────────────────────────────────────
  PAYLOAD_TEXT_EMPTY: '',
  PAYLOAD_TEXT_ONLY_SPACES: '     ',
  PAYLOAD_TEXT_ALPHANUMERIC: 'Texto123',
  PAYLOAD_TEXT_SPECIAL_CHARS: 'texto.-_#@!',
  PAYLOAD_TEXT_EXTENDED_LATIN: 'Árbol Niño Acción',
  PAYLOAD_TEXT_UNICODE: '安全テキスト',
  PAYLOAD_TEXT_LEADING_SPACE: ' texto',
  PAYLOAD_TEXT_TRAILING_SPACE: 'texto ',
  PAYLOAD_TEXT_MULTIPLE_SPACES: 'texto  interno',
  PAYLOAD_TEXT_HTML_INJECTION: '<script>alert(1)</script>',
  PAYLOAD_TEXT_SQL_LIKE: "' OR 1=1 --",
  PAYLOAD_TEXT_CONTROL_CHAR: 'text\x01value',
  PAYLOAD_TEXT_OVERFLOW_500: 'A'.repeat(500),

  // ─── UNKNOWN (generic fallback) ─────────────────────────────────────────
  PAYLOAD_UNKNOWN_STRING: 'ABC123',
  PAYLOAD_UNKNOWN_NUMERIC: '12345',
  PAYLOAD_UNKNOWN_EXTREME_LENGTH: 'A'.repeat(10000),
  PAYLOAD_UNKNOWN_BINARY: '\x00\x01\x02\x03\xFF\xFE',
  PAYLOAD_UNKNOWN_SQL_INJECTION: "' OR 1=1 --",
  PAYLOAD_UNKNOWN_XSS: '<script>alert(1)</script>',
  PAYLOAD_UNKNOWN_TYPE_CONFUSION: '{"type":"object","value":1}',

  // ─── Shared / generic ────────────────────────────────────────────────────
  PAYLOAD_STRING_5000: 'A'.repeat(5000),
  PAYLOAD_SQL_INJECTION_BASIC: "' OR '1'='1",
  PAYLOAD_XSS_BASIC: "<script>alert('xss')</script>",
};
