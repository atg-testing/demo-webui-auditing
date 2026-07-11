import { Page, Request, Response } from '@playwright/test';
import type { AuditRule } from './RuleEvaluator';

export interface RawInteractionResult {
  payloadInjected: string;
  requestAttempted: boolean;
  requestUrl: string | null;
  requestMethod: string | null;
  wasAbortedByFrontend: boolean;
  httpStatusReceived: number | null;
  backendErrorReturned: boolean;
  domErrorClassDetected: boolean;
  /** Field's value.length right after the interaction — null if it could not be measured.
   *  Used to verify TRUNCATES_INPUT with real evidence (finalValueLength < payloadInjected.length). */
  finalValueLength: number | null;
}

export class FieldExperimentRunner {
  private readonly customErrorTokens: string[];

  constructor(customErrorTokens: string[] = []) {
    this.customErrorTokens = customErrorTokens;
  }

  public async runExperiment(
    page: Page,
    field: { element: { locator: string } },
    rule: AuditRule,
    payload: string
  ): Promise<RawInteractionResult> {
    const result: RawInteractionResult = {
      payloadInjected: payload,
      requestAttempted: false,
      requestUrl: null,
      requestMethod: null,
      wasAbortedByFrontend: false,
      httpStatusReceived: null,
      backendErrorReturned: false,
      domErrorClassDetected: false,
      finalValueLength: null,
    };

    // Sanitize payload: replace non-BMP / surrogate code points that crash Chromium's renderer
    const safePayload = payload.replace(/[\uD800-\uDFFF]|[\x00-\x08\x0E-\x1F\x7F]/g, (c) =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    );

    const locator = page.locator(field.element.locator).first();
    try {
      // Wait for the field to become visible — React/SPA apps may not have hydrated yet.
      // page.goto({ waitUntil: 'domcontentloaded' }) has already completed before experiments
      // start, so heavy SPA hydration is mostly done. 3000 ms covers the slowest realistic
      // post-load hydration phase without wasting 2 extra idle seconds per experiment.
      await locator.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      if (!(await locator.isVisible()) || !(await locator.isEditable())) return result;

      const type = await locator.getAttribute('type');
      const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase());

      if (tagName === 'select') {
        await locator.selectOption({ value: payload }, { timeout: 1500 }).catch(() => {/* invalid option — expected */ });
      } else if (type === 'checkbox' || type === 'radio') {
        const shouldCheck = payload.toLowerCase() === 'true' || payload === '1';
        await locator.setChecked(shouldCheck, { timeout: 1500 }).catch(() => {});
      } else if (type === 'file') {
        await locator.setInputFiles({
          name: payload.includes('INVALID') ? 'evil.exe' : 'test.pdf',
          mimeType: payload.includes('INVALID') ? 'application/x-msdownload' : 'application/pdf',
          buffer: Buffer.from('dummy file content for auditing'),
        }, { timeout: 1500 }).catch(() => {});
      } else {
        await locator.fill(safePayload, { timeout: 1500 }).catch(() => {});
      }

      // Capture the field's actual value length right after the interaction — evidence
      // for TRUNCATES_INPUT (e.g. a maxlength attribute silently truncating an overflow
      // payload). Only meaningful for text-like fields; left null for select/checkbox/file.
      if (tagName !== 'select' && type !== 'checkbox' && type !== 'radio' && type !== 'file') {
        result.finalValueLength = await locator.inputValue({ timeout: 1000 })
          .then((v) => v.length)
          .catch(() => null);
      }
    } catch (e) {
      console.error(`[FieldExperimentRunner] Failed to interact with ${field.element.locator}`, e);
      return result;
    }

    // Give the framework's controlled-input cycle (React onChange -> setState -> re-render)
    // a chance to commit the just-filled value before we submit. Playwright's fill() resolves
    // as soon as the DOM value + input event are dispatched, not once React's state catches
    // up — submitting immediately after races with that commit and intermittently submits a
    // stale controlled value (e.g. empty or the previous experiment's payload), which HTML5
    // required/pattern validation then blocks for no reason related to the current payload.
    // This produced non-deterministic pass/fail flips between identical Re-runs.
    await page.waitForTimeout(50).catch(() => {});

    if (rule.requiredInteractionType === 'SUBMIT') {
      // ── SUBMIT path ──────────────────────────────────────────────────────────
      // Goal: trigger a real form submission so we can observe whether the frontend
      // blocks it or lets the request reach the server.
      // Sibling fields are temporarily filled with valid placeholders so that their
      // own HTML5 required/constraint validation does not mask the audited field's
      // failure (false negatives). They are restored after the attempt.

      // Patterns that indicate analytics/telemetry/third-party challenge platforms — NOT the
      // audited form's own submission. Cloudflare Turnstile/Challenge in particular issues its
      // own async POSTs to challenges.cloudflare.com/cdn-cgi/* that can land well after the real
      // form submit — without this exclusion those were being mistaken for the login POST,
      // producing requestAttempted:true (and a false "backend accepted the invalid payload")
      // for CPs the real form never actually submitted.
      const TRACKING_PATTERNS = ['/track', '/analytics', '/beacon', '/pixel', '/collect', '/log', '/event', '/metric', '/telemetry', 'google-analytics', 'googletagmanager', 'segment.io', 'amplitude', 'mixpanel', 'hotjar', 'fullstory', 'sentry', 'cloudflare.com', 'cdn-cgi', 'recaptcha', 'hcaptcha.com'];
      const isTrackingRequest = (url: string): boolean =>
        TRACKING_PATTERNS.some(p => url.toLowerCase().includes(p));

      // Only requests to the audited page's own origin can be the form's submission —
      // third-party origins (CDNs, challenge platforms, analytics) are never the target.
      const auditOrigin = new URL(page.url()).origin;

      const requestListener = (request: Request) => {
        const method = request.method();
        const t = request.resourceType();
        const url = request.url();
        let sameOrigin = false;
        try { sameOrigin = new URL(url).origin === auditOrigin; } catch { /* malformed URL — not same-origin */ }
        if (sameOrigin && ['POST', 'PUT', 'PATCH'].includes(method) && !isTrackingRequest(url)) {
          if (['fetch', 'xhr', 'document'].includes(t)) {
            result.requestAttempted = true;
            result.requestUrl = url;
            result.requestMethod = method;
          }
        }
      };
      const responseListener = (response: Response) => {
        if (response.request().url() === result.requestUrl) {
          const intercepted = response.headers()['x-atg-intercepted'];
          if (intercepted === 'document') {
            // The audit route interceptor fulfilled this document navigation with a synthetic 200.
            // The request reached the send point — treat as backend-observable, same semantics
            // as the old abort('blockedbyclient') + requestfailed path.
            result.backendErrorReturned = true;
            result.httpStatusReceived = 422;
          } else {
            result.httpStatusReceived = response.status();
            result.backendErrorReturned = response.status() >= 400;
          }
        }
      };
      const requestFailedListener = (request: Request) => {
        const t = request.resourceType();
        if (request.url() !== result.requestUrl) return;
        if (['fetch', 'xhr'].includes(t)) {
          // fetch/xhr failure = the system under test blocked the request
          result.wasAbortedByFrontend = true;
        } else if (t === 'document') {
          // Defensive fallback: document navigation failed for a reason other than the audit
          // route interceptor (e.g. network error). Treat as backend-observable.
          result.backendErrorReturned = true;
          result.httpStatusReceived = 422;
        }
      };

      page.on('request', requestListener);
      page.on('requestfailed', requestFailedListener);
      page.on('response', responseListener);

      try {
        const formLocator = locator.locator('xpath=ancestor::form');
        if (await formLocator.count() > 0 && await formLocator.isVisible().catch(() => false)) {
          const auditedLocator = field.element.locator;
          const filledSiblings: Array<{ selector: string }> = [];
          const siblings = await formLocator.locator('input[required], textarea[required], select[required]').all();
          for (const sibling of siblings) {
            const siblingLocator = await sibling.evaluate((el: Element) => {
              const e = el as HTMLInputElement;
              if (e.id) return `#${e.id}`;
              if (e.name) return `[name="${e.name}"]`;
              return null;
            });
            if (!siblingLocator || siblingLocator === auditedLocator) continue;
            const sibType = await sibling.getAttribute('type') ?? 'text';
            // Always overwrite siblings with a known-valid placeholder — a previous experiment
            // may have left an invalid payload in the field, which would cause HTML5 validation
            // to block the submit and mask this experiment's result (false negative).
            const placeholder =
              sibType === 'email'    ? 'audit@placeholder.dev' :
              sibType === 'password' ? 'Audit_Placeholder1!' :
              sibType === 'number'   ? '1' :
              sibType === 'url'      ? 'https://audit.placeholder.dev' :
              sibType === 'tel'      ? '+10000000000' :
              sibType === 'date'     ? '2000-01-01' :
              sibType === 'checkbox' ? '' : // handled separately
              'audit-placeholder';
            if (sibType === 'checkbox') {
              await sibling.setChecked(true, { timeout: 1000 }).catch(() => {});
              filledSiblings.push({ selector: siblingLocator });
            } else if (sibType !== 'radio') {
              await sibling.fill(placeholder, { timeout: 1000 }).catch(() => {});
              filledSiblings.push({ selector: siblingLocator });
            }
          }

          // requestSubmit() triggers native HTML5 required/constraint validation; fall back if unsupported
          await formLocator.evaluate((form: Element) => {
            const f = form as HTMLFormElement;
            if (typeof f.requestSubmit === 'function') {
              try { f.requestSubmit(); return; } catch { /* validation blocked — expected */ }
            }
            f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }).catch(() => {});

          // Wait for the request to fire OR for DOM error feedback to settle. A React onSubmit
          // handler is frequently async (e.g. it awaits a validation step before calling fetch) —
          // a fixed short wait races with that and intermittently misses the request entirely,
          // producing requestAttempted:false for a payload that would otherwise have been
          // submitted (observed as non-deterministic pass/fail on the exact same CP/payload
          // across identical Re-runs). Poll for up to 1200ms but return as soon as the request
          // already landed, so the common case (frontend validation caught it fast) isn't slowed.
          const deadline = Date.now() + 1200;
          while (!result.requestAttempted && Date.now() < deadline) {
            await page.waitForTimeout(50).catch(() => {});
          }
          // Give DOM error-class feedback a little more time to settle after the request
          // resolved (or after we gave up waiting for one).
          await page.waitForTimeout(150).catch(() => {});

          // Guard: settle the page before restoring siblings.
          await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});

          // Restore sibling fields to empty after submit attempt
          for (const s of filledSiblings) {
            const sib = page.locator(s.selector).first();
            const sibType = await sib.getAttribute('type').catch(() => 'text');
            if (sibType === 'checkbox') {
              await sib.setChecked(false, { timeout: 1000 }).catch(() => {});
            } else {
              await sib.fill('', { timeout: 1000 }).catch(() => {});
            }
          }
        } else {
          // No ancestor form found — fall back to blur to at least trigger field-level validation
          await locator.blur().catch(() => {});
          await page.waitForTimeout(300).catch(() => {});
        }
      } catch { /* safe catch */ }

      page.off('request', requestListener);
      page.off('response', responseListener);
      page.off('requestfailed', requestFailedListener);

    } else {
      // ── BLUR path ─────────────────────────────────────────────────────────────
      // Goal: trigger field-level (on-blur) validation without submitting the form.
      // No sibling filling, no network listeners — we only care about DOM error feedback
      // shown while the user is still filling the form, before any submit.
      // A field that only validates on submit (no blur feedback) is a UX/security gap:
      // the user gets no inline guidance and all validation burden falls on the backend.
      await locator.blur().catch(() => {});
      // Wait for CSS blur-validation feedback to appear (inline error classes, aria-invalid).
      // CSS transitions and SPA nextTick cycles settle within 300 ms.
      await page.waitForTimeout(300).catch(() => {});
    }

    // Guard: after any SUBMIT experiment, ensure the frame is settled before the DOM check.
    // Resolves instantly when the page is already loaded; covers the fallback-blur sub-path
    // (no-ancestor-form) where the inner waitForLoadState is not reached.
    if (rule.requiredInteractionType === 'SUBMIT') {
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    }

    // DOM mutation check — detects frontend validation error display.
    // Checks both the input itself AND its surrounding DOM (parent container, siblings).
    // Many modern frameworks (React, Vue, Angular, custom components) render error messages
    // in a sibling <span>/<div> or parent wrapper — not as a class on the <input> itself.
    // Custom tokens (from the ATG wizard) are merged with the built-in standard set and passed
    // as an argument so they are available inside the browser execution context.
    try {
      const mergedErrorTokens = [
        'error', 'invalid', 'danger', 'is-invalid', 'has-error', 'field-error',
        'input-error', 'form-error', 'text-red-', 'text-danger-', 'text-destructive',
        ...this.customErrorTokens,
      ];
      const domErrorDetected = await locator.evaluate((el: Element, tokens: string[]): boolean => {
        // 1. Check aria-invalid on the input
        if (el.getAttribute('aria-invalid') === 'true') return true;

        // 2. Check CSS error classes on the input itself (token-level to avoid Tailwind false positives)
        // text-red-* / text-danger-* are Tailwind utility classes used by many frameworks (shadcn, etc.)
        // to render inline error messages in sibling <p>/<span>/<small> elements.
        const inputClasses = (el.getAttribute('class') || '').split(/\s+/);
        if (inputClasses.some(cls => tokens.some(t => cls.toLowerCase().startsWith(t)))) return true;

        // 3. Check parent container for error indicator classes
        const parent = el.parentElement;
        if (parent) {
          const parentClasses = (parent.getAttribute('class') || '').split(/\s+/);
          if (parentClasses.some(cls => tokens.some(t => cls.toLowerCase().startsWith(t)))) return true;

          // 4. Check sibling/child elements for visible error text or error role/aria
          const nearbyEls = Array.from(parent.querySelectorAll('span, div, p, small, label'));
          for (const near of nearbyEls) {
            if (near === el) continue;
            const nearClasses = (near.getAttribute('class') || '').split(/\s+/);
            if (nearClasses.some(cls => tokens.some(t => cls.toLowerCase().startsWith(t)))) return true;
            // aria-live or role="alert" sibling with text = error message rendered by framework
            const role = near.getAttribute('role');
            const ariaLive = near.getAttribute('aria-live');
            if ((role === 'alert' || ariaLive === 'polite' || ariaLive === 'assertive') && (near.textContent || '').trim().length > 0) return true;
          }

          // 5. Check grandparent container (some frameworks wrap field+error in a 2-level wrapper)
          const grandParent = parent.parentElement;
          if (grandParent) {
            const gpClasses = (grandParent.getAttribute('class') || '').split(/\s+/);
            if (gpClasses.some(cls => tokens.some(t => cls.toLowerCase().startsWith(t)))) return true;
            const gpNearby = Array.from(grandParent.querySelectorAll('span, div, p, small'));
            for (const near of gpNearby) {
              if (near === el || near === parent) continue;
              const nearClasses = (near.getAttribute('class') || '').split(/\s+/);
              if (nearClasses.some(cls => tokens.some(t => cls.toLowerCase().startsWith(t)))) return true;
              const role2 = near.getAttribute('role');
              const ariaLive2 = near.getAttribute('aria-live');
              if ((role2 === 'alert' || ariaLive2 === 'polite' || ariaLive2 === 'assertive') && (near.textContent || '').trim().length > 0) return true;
            }
          }
        }

        return false;
      }, mergedErrorTokens).catch(() => false);

      result.domErrorClassDetected = domErrorDetected;
      // wasAbortedByFrontend: if the network listener already flagged an abort, keep it.
      // Otherwise, only fall back to "no request attempted" as evidence of a frontend block.
      // A detected DOM error class must NOT by itself flip this to true when the request DID
      // reach the wire — an unrelated error class elsewhere in the DOM (leftover from a
      // previous field, a helper-text token match, etc.) is not proof that THIS submit was
      // blocked; the network evidence (requestAttempted/backendErrorReturned) is the ground
      // truth once we know the request was actually sent.
      if (!result.wasAbortedByFrontend) {
        result.wasAbortedByFrontend = !result.requestAttempted;
      }
    } catch { /* field may have changed after interaction */ }

    return result;
  }
}
