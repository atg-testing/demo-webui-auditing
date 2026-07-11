import type { AuditRule } from './RuleEvaluator';
import { DataStrategyPayloads } from './DataStrategyPayloads';
export class DataStrategyEngine {
  /**
   * Returns the exact payload string for a Behavioral rule based on its
   * dataStrategyPayload key. Returns null for Declarative rules or missing keys.
   */
  public resolvePayload(_field: { inferredCategory: string }, rule: AuditRule): string | null {
    if (rule.type !== 'Behavioral' || !rule.dataStrategyPayload) return null;
    const payload = DataStrategyPayloads[rule.dataStrategyPayload];
    if (payload === undefined) {
      console.warn(`[DataStrategyEngine] Missing payload key: ${rule.dataStrategyPayload}`);
      return null;
    }
    return payload;
  }
}
