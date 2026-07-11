import type { Finding } from './RuleEvaluator';

// Penalty weights per severity — matches ATG SeverityWeight enum
const SEVERITY_WEIGHT: Record<string, number> = {
  Critical: 35,
  Error:    20,
  Warning:   5,
  Info:      0,
};

export class ScoringEngine {
  private readonly BASE_SCORE = 100;

  /** FQI = Max(0, 100 - SUM(penalties for FAILED findings only)) */
  public calculateFQI(findings: Finding[]): number {
    let penalty = 0;
    for (const f of findings.filter(f => !f.passed)) {
      penalty += SEVERITY_WEIGHT[f.severity] ?? 0;
    }
    return Math.max(0, this.BASE_SCORE - penalty);
  }

  /** SMI = average FQI across all fields, minus critical-field penalties */
  public calculateSMI(results: Array<{ fqi: number; inferredCategory?: string; maturityState?: string }>): number {
    if (results.length === 0) return 0;
    let total = 0;
    let criticalPenalty = 0;
    for (const r of results) {
      total += r.fqi;
      if ((r.inferredCategory === 'PASSWORD' || r.inferredCategory === 'EMAIL') && r.maturityState === 'ABSENT') {
        criticalPenalty += 20;
      }
    }
    return Math.max(0, Math.round(total / results.length) - criticalPenalty);
  }
}
