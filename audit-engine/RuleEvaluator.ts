import * as fs from 'fs';
import * as path from 'path';
import type { FieldDefinition } from './DOMAnalyzer';

export interface AuditRule {
  id: string;
  type: string;          // 'Declarative' | 'Behavioral' (catalog uses Pascal-case)
  description: string;
  severity: string;      // 'Critical' | 'Error' | 'Warning' | 'Info'
  declarativeCondition?: string;   // JS expression evaluated against `field`
  dataStrategyPayload?: string;    // Key into DataStrategyPayloads dictionary
  requiredInteractionType?: string; // 'SUBMIT' | 'BLUR'
  expectedBehavior?: string[];
}

export interface Finding {
  ruleId: string;
  ruleDescription: string;
  severity: string;
  detectedVia: string;   // 'Declarative' | 'Behavioral'
  passed: boolean;       // true = rule compliant, false = violation found
  errorMessage: string;
  interactionEvidence?: unknown; // set by InferenceEngine for Behavioral findings
  // Set by the audit spec (not InferenceEngine) when a SUBMIT finding failed because a
  // detected anti-bot challenge (Cloudflare Turnstile/reCAPTCHA/hCaptcha) blocked the
  // form submit before it could reach the network — the payload's actual validity was
  // never observable. Excluded from FQI/SMI scoring; persisted with its own DB status.
  isInconclusive?: boolean;
}

export class RuleEvaluator {
  private catalog: Record<string, AuditRule[]> = {};

  constructor() {
    try {
      const p = path.resolve(process.cwd(), 'config/AuditingRuleCatalog.json');
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data.categories && typeof data.categories === 'object') {
        this.catalog = data.categories;
      }
    } catch (e) {
      console.error('[RuleEvaluator] Failed to load AuditingRuleCatalog.json', e);
    }
  }

  /** Returns all rules for the field's category plus baseline UNKNOWN rules. */
  public getRulesForField(field: { inferredCategory: string }): AuditRule[] {
    const specific = this.catalog[field.inferredCategory] || [];
    const generic  = this.catalog['UNKNOWN'] || [];
    return [...specific, ...generic];
  }

  /** Evaluates all Declarative rules — emits a Finding for every rule (passed or failed). */
  public evaluateDeclarative(field: FieldDefinition, rules: AuditRule[]): Finding[] {
    const findings: Finding[] = [];
    for (const rule of rules.filter(r => r.type === 'Declarative' && r.declarativeCondition)) {
      try {
        // eslint-disable-next-line no-new-func
        const evaluator = new Function('field', `return ${rule.declarativeCondition};`);
        const isCompliant = evaluator(field);
        findings.push({
          ruleId: rule.id,
          ruleDescription: rule.description,
          severity: rule.severity,
          detectedVia: 'Declarative',
          passed: !!isCompliant,
          errorMessage: isCompliant
            ? ''
            : `Declarative constraint failed: ${rule.declarativeCondition}`,
        });
      } catch (e) {
        console.error(`[RuleEvaluator] Failed to evaluate ${rule.id}`, e);
      }
    }
    return findings;
  }
}
