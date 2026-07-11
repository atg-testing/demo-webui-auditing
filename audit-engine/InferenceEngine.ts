import type { Finding } from './RuleEvaluator';
import type { RawInteractionResult } from './FieldExperimentRunner';
import type { AuditRule } from './RuleEvaluator';

export type ValidationMaturityState =
  | 'ROBUST_FULL_STACK' | 'FRONTEND_ONLY' | 'BACKEND_ONLY'
  | 'WEAK_VALIDATION'   | 'ABSENT'        | 'FALSE_POSITIVE';

/** Finding extended with behavioral interaction evidence. */
interface BehavioralFinding extends Finding {
  interactionEvidence: RawInteractionResult;
}

function isBehavioralFinding(f: Finding): f is BehavioralFinding {
  return f.interactionEvidence !== undefined;
}

export class InferenceEngine {
  public determineMaturityState(
    _field: unknown,
    declarativeFindings: Finding[],
    behavioralFindings: Finding[]
  ): ValidationMaturityState {
    const hasDeclarativeErrors = declarativeFindings.some(f => f.severity === 'Critical' || f.severity === 'Error');
    const hasBehavioralErrors  = behavioralFindings.some(f => f.severity === 'Critical');

    if (hasDeclarativeErrors && hasBehavioralErrors) return 'ABSENT';
    if (!hasDeclarativeErrors && hasBehavioralErrors) return 'WEAK_VALIDATION';

    const failedBehavioral = behavioralFindings.filter(
      (f): f is BehavioralFinding => f.severity === 'Critical' && isBehavioralFinding(f)
    );
    for (const fb of failedBehavioral) {
      const ev = fb.interactionEvidence;
      if (ev.wasAbortedByFrontend) return hasDeclarativeErrors ? 'WEAK_VALIDATION' : 'FRONTEND_ONLY';
      if (ev.requestAttempted && ev.backendErrorReturned && !ev.domErrorClassDetected) return 'BACKEND_ONLY';
      if (ev.requestAttempted && ev.httpStatusReceived !== null && ev.httpStatusReceived < 400) return 'ABSENT';
    }

    if (!hasDeclarativeErrors) return 'FRONTEND_ONLY';
    return 'FALSE_POSITIVE';
  }

  /**
   * Converts a RawInteractionResult into a Finding (always — passed or failed).
   */
  public generateBehavioralFinding(rule: AuditRule, result: RawInteractionResult): Finding {
    const isCompliant = this.evaluateInteraction(rule.expectedBehavior || [], result);
    return {
      ruleId: rule.id,
      ruleDescription: rule.description,
      severity: rule.severity,
      detectedVia: 'Behavioral',
      passed: isCompliant,
      errorMessage: isCompliant
        ? ''
        : `Behavioral injection yielded an insecure state. Payload: ${this.displaySafePayload(result.payloadInjected)}`,
      interactionEvidence: result,
    };
  }

  // Escapes control/null characters (e.g. the binary-injection payload's \x00) so this string
  // can safely be persisted to a text column — a raw null byte is rejected outright by
  // PostgreSQL's UTF8 encoding and silently fails the entire bulk insert of findings for the run.
  private displaySafePayload(payload: string): string {
    // eslint-disable-next-line no-control-regex
    return payload.replace(/[\x00-\x08\x0E-\x1F\x7F]/g, (c) =>
      `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`
    );
  }

  private evaluateInteraction(expected: string[], result: RawInteractionResult): boolean {
    // BLOCKS_SUBMIT: the frontend must not have sent the request at all.
    // If the rule also declares BACKEND_REJECTS, server-side rejection is an acceptable
    // alternative — some invalid formats pass HTML5 validation (e.g. RFC-edge cases like
    // dot-start local parts) but a well-implemented server must still reject them.
    const hasBackendRejects = expected.includes('BACKEND_REJECTS');
    if (expected.includes('BLOCKS_SUBMIT')) {
      const frontendBlocked = !result.requestAttempted || result.wasAbortedByFrontend;
      const backendRejected = hasBackendRejects && result.requestAttempted && result.backendErrorReturned;
      if (!frontendBlocked && !backendRejected) return false;
    }

    // BACKEND_REJECTS standalone (without BLOCKS_SUBMIT): the request must reach the server
    // AND the server must return a 4xx/5xx response.
    if (hasBackendRejects && !expected.includes('BLOCKS_SUBMIT')) {
      if (!result.requestAttempted || !result.backendErrorReturned) return false;
    }

    // SHOWS_ERROR_CLASS: only a standalone assertion — skip if BLOCKS_SUBMIT already confirmed blocking.
    // Many frameworks (Tailwind, shadcn, etc.) use custom CSS classes or aria attributes instead of
    // error/invalid/danger, so absence of those classes does not mean the field lacks protection.
    const submitWasBlocked = expected.includes('BLOCKS_SUBMIT') && result.wasAbortedByFrontend;
    if (expected.includes('SHOWS_ERROR_CLASS') && !submitWasBlocked && !result.domErrorClassDetected) return false;

    // ALLOWS_SUBMIT: the payload is a VALID acceptance case (e.g. a well-formed email) — the
    // request must actually have been attempted (not silently blocked by an overly strict
    // frontend) and must not have been aborted or rejected by the backend as invalid.
    if (expected.includes('ALLOWS_SUBMIT')) {
      const wasIncorrectlyBlocked = !result.requestAttempted || result.wasAbortedByFrontend;
      const wasIncorrectlyRejected = result.requestAttempted && result.backendErrorReturned;
      if (wasIncorrectlyBlocked || wasIncorrectlyRejected) return false;
    }

    // TRUNCATES_INPUT: overflow rules accept EITHER a full block (BLOCKS_SUBMIT already
    // satisfied above) OR real evidence that the field silently truncated the payload
    // before it could be submitted. Fail-closed when we couldn't measure the final value —
    // an unmeasured field is not evidence of protection.
    if (expected.includes('TRUNCATES_INPUT')) {
      const submitWasBlocked = expected.includes('BLOCKS_SUBMIT') && (!result.requestAttempted || result.wasAbortedByFrontend);
      if (!submitWasBlocked) {
        const truncated = result.finalValueLength !== null && result.finalValueLength < result.payloadInjected.length;
        if (!truncated) return false;
      }
    }

    return true;
  }
}
