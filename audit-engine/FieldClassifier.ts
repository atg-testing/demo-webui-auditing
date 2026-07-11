import type { FieldDefinition } from './DOMAnalyzer';

// Category keys must match AuditingRuleCatalog.json categories exactly
export type FieldCategory = 'EMAIL' | 'PASSWORD' | 'PHONE' | 'DATE' | 'NUMBER' | 'TEXTAREA' | 'TEXT' | 'CHECKBOX' | 'RADIO' | 'SELECT' | 'FILE' | 'URL' | 'UNKNOWN';

export class FieldClassifier {
  public classify(field: FieldDefinition): FieldCategory {
    // tagName takes absolute precedence — structural elements are classified by tag first,
    // before any semantic heuristics based on name/id/class.
    if (field.element.tagName === 'textarea') return 'TEXTAREA';
    if (field.element.tagName === 'select') return 'SELECT';

    const t = (field.element.type || '').toLowerCase();

    // input type takes second precedence for unambiguous HTML types
    if (t === 'checkbox') return 'CHECKBOX';
    if (t === 'radio') return 'RADIO';
    if (t === 'file') return 'FILE';
    if (t === 'url') return 'URL';
    if (t === 'date' || t === 'datetime-local' || t === 'month' || t === 'week') return 'DATE';
    if (t === 'number' || t === 'range') return 'NUMBER';
    if (t === 'email') return 'EMAIL';
    if (t === 'password') return 'PASSWORD';
    if (t === 'tel') return 'PHONE';

    // Semantic heuristics on name/id/class for ambiguous types (text, search, hidden, etc.)
    const signals = [t, field.element.name || '', field.element.id || '', field.element.classNames || ''].join(' ').toLowerCase();

    if (this.containsAny(signals, ['email', 'mail', 'correo', 'e-mail'])) return 'EMAIL';
    if (this.containsAny(signals, ['password', 'pwd', 'pass', 'contraseña', 'clave'])) return 'PASSWORD';
    if (this.containsAny(signals, ['phone', 'mobile', 'celular', 'telefono'])) return 'PHONE';
    if (this.containsAny(signals, ['date', 'fecha', 'dob'])) return 'DATE';
    if (this.containsAny(signals, ['amount', 'quantity', 'monto', 'cantidad', 'age', 'edad'])) return 'NUMBER';
    if (this.containsAny(signals, ['url', 'website', 'sitio', 'enlace', 'link', 'href'])) return 'URL';
    return 'TEXT';
  }

  private containsAny(source: string, candidates: string[]): boolean {
    return candidates.some(c => source.includes(c));
  }
}
