import type { CheckPointAudit } from './CPGenerator';
import type { Finding } from './RuleEvaluator';

export interface AuditExecutiveSummary {
  totalFields: number;
  passedFields: number;
  failedFields: number;
  warnFields: number;
  globalSMI: number;
  avgFQI: number;
  maturityDistribution: Record<string, number>;
  grade: string;
  // Set when an anti-bot challenge (Cloudflare Turnstile/reCAPTCHA/hCaptcha) was detected on
  // the audited page — inconclusiveCount is how many SUBMIT CPs were reclassified because of it
  // (excluded from FQI/SMI, but still visible per-field in the report).
  challengeDetected: boolean;
  inconclusiveCount: number;
}

const SEV_COLOR: Record<string, string> = {
  Critical: '#ef4444',
  Error:    '#f97316',
  Warning:  '#eab308',
  Info:     '#94a3b8',
};

const MATURITY_LABEL: Record<string, string> = {
  ROBUST_FULL_STACK: 'Robust Full Stack',
  FRONTEND_ONLY:     'Frontend Only',
  BACKEND_ONLY:      'Backend Only',
  WEAK_VALIDATION:   'Weak Validation',
  ABSENT:            'Absent',
  FALSE_POSITIVE:    'False Positive',
};

export class ReportBuilder {
  public buildExecutiveSummary(
    checkpoints: CheckPointAudit[],
    precomputedSMI?: number,
    challengeDetected: boolean = false,
    inconclusiveCount: number = 0,
  ): AuditExecutiveSummary {
    const total = checkpoints.length;
    const passed = checkpoints.filter(c => c.status === 'PASS').length;
    const failed = checkpoints.filter(c => c.status === 'FAIL').length;
    const warn   = checkpoints.filter(c => c.status === 'WARN').length;
    const avgFQI = total > 0
      ? Math.round(checkpoints.reduce((s, c) => s + (c.metadata?.fqi ?? 50), 0) / total)
      : 0;
    // Use precomputed SMI (which includes ContextPenalty) when available.
    // Fallback to avgFQI only when called without it (e.g. unit tests).
    const globalSMI = precomputedSMI !== undefined ? precomputedSMI : avgFQI;
    const dist: Record<string, number> = {};
    checkpoints.forEach(c => {
      const state = c.metadata?.maturityState || 'UNKNOWN';
      dist[state] = (dist[state] || 0) + 1;
    });
    let grade = 'F';
    if (globalSMI >= 90) grade = 'A';
    else if (globalSMI >= 80) grade = 'B';
    else if (globalSMI >= 70) grade = 'C';
    else if (globalSMI >= 60) grade = 'D';
    return { totalFields: total, passedFields: passed, failedFields: failed, warnFields: warn, globalSMI, avgFQI, maturityDistribution: dist, grade, challengeDetected, inconclusiveCount };
  }

  public generateReport(summary: AuditExecutiveSummary, checkpoints: CheckPointAudit[]): string {
    const gradeColor = ({ A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' } as Record<string, string>)[summary.grade] ?? '#6b7280';
    const contextPenalty = summary.avgFQI - summary.globalSMI;
    const contextPenaltyCard = contextPenalty > 0
      ? `<div class="card card-penalty">
           <div class="card-label">⚠️ Context Penalty</div>
           <div class="card-value" style="color:#f97316">−${contextPenalty}</div>
           <div class="card-penalty-note">Identity field breach (EMAIL/PASSWORD ABSENT) reduces page score</div>
         </div>`
      : '';
    const challengeBanner = summary.challengeDetected
      ? `<div class="challenge-banner">
           ⚠ <strong>${summary.inconclusiveCount} de ${summary.totalFields > 0 ? checkpoints.reduce((s, c) => s + (c.metadata?.findingsCount ?? 0), 0) : 0} CPs no concluyentes</strong>
           — se detectó un challenge anti-bot (Cloudflare Turnstile / reCAPTCHA / hCaptcha) en la página.
           Estos CPs no pudieron verificarse porque el challenge bloqueó el envío del formulario antes de
           que la validación real (frontend o backend) pudiera observarse, y no afectan el puntaje SMI/FQI.
         </div>`
      : '';

    const maturityBars = Object.entries(summary.maturityDistribution).map(([state, count]) => {
      const pct = summary.totalFields > 0 ? Math.round((count / summary.totalFields) * 100) : 0;
      const color = state === 'ROBUST_FULL_STACK' ? '#22c55e'
        : state === 'FRONTEND_ONLY' ? '#eab308'
        : state === 'BACKEND_ONLY'  ? '#f97316'
        : '#ef4444';
      return `<div class="dist-item">
        <span class="dist-label">${MATURITY_LABEL[state] ?? state}</span>
        <div class="dist-bar-track"><div class="dist-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="dist-count">${count}</span>
      </div>`;
    }).join('');

    const fieldSections = checkpoints.map((cp, idx) => {
      const statusColor = cp.status === 'PASS' ? '#22c55e' : cp.status === 'WARN' ? '#eab308' : '#ef4444';
      const findings: Finding[] = cp.metadata?.findings ?? [];

      const failedFindings = findings.filter(f => !f.passed);
      const passedFindings = findings.filter(f => f.passed);
      const totalF  = findings.length;
      const failedF = failedFindings.length;
      const passedF = passedFindings.length;

      const failedRows = failedFindings.map(f => {
        const detectedVia = f.detectedVia || 'Declarative';
        const typeBadge = detectedVia === 'Behavioral'
          ? `<span class="badge badge-beh">Behavioral</span>`
          : `<span class="badge badge-decl">Declarative</span>`;
        const sevColor = SEV_COLOR[f.severity] ?? '#94a3b8';
        return `<tr class="finding-fail">
          <td><code>${f.ruleId ?? '—'}</code></td>
          <td>${typeBadge}</td>
          <td>${f.ruleDescription ?? f.errorMessage ?? '—'}</td>
          <td><span style="color:${sevColor};font-weight:600">${f.severity ?? '—'}</span></td>
          <td style="text-align:center;font-size:1.1rem">❌</td>
        </tr>`;
      }).join('');

      const passedRows = passedFindings.map(f => {
        const detectedVia = f.detectedVia || 'Declarative';
        const typeBadge = detectedVia === 'Behavioral'
          ? `<span class="badge badge-beh">Behavioral</span>`
          : `<span class="badge badge-decl">Declarative</span>`;
        return `<tr class="finding-pass passed-row-${idx}" style="display:none">
          <td><code>${f.ruleId ?? '—'}</code></td>
          <td>${typeBadge}</td>
          <td>${f.ruleDescription ?? '—'}</td>
          <td><span style="color:#22c55e;font-weight:600">${f.severity ?? '—'}</span></td>
          <td style="text-align:center;font-size:1.1rem">✅</td>
        </tr>`;
      }).join('');

      const noFailedRow = failedF === 0 && totalF > 0
        ? `<tr class="no-failed-row-${idx}"><td colspan="5" style="color:#22c55e;text-align:center;padding:1.25rem;font-size:0.85rem">✅ All rules passed for this field</td></tr>`
        : '';

      const noRulesRow = totalF === 0
        ? `<tr><td colspan="5" style="color:#475569;text-align:center;padding:1.5rem">No rules evaluated for this field</td></tr>`
        : '';

      const toggleBtn = passedF > 0
        ? `<button class="toggle-passed-btn" onclick="togglePassed(${idx})" data-idx="${idx}">
            Show ${passedF} passing rule${passedF !== 1 ? 's' : ''}
           </button>`
        : '';

      return `<div class="field-section">
        <div class="field-header">
          <div class="field-header-left">
            <span class="field-status-dot" style="background:${statusColor}"></span>
            <div>
              <div class="field-locator"><code>${cp.targetElement}</code></div>
              <div class="field-meta">
                <span class="badge badge-category">${cp.metadata?.fieldCategory ?? '—'}</span>
                <span class="field-maturity">${MATURITY_LABEL[cp.metadata?.maturityState] ?? cp.metadata?.maturityState ?? '—'}</span>
              </div>
            </div>
          </div>
          <div class="field-header-right">
            <div class="field-score-block">
              <span class="score-label">FQI</span>
              <span class="score-value" style="color:${cp.metadata?.fqi >= 80 ? '#22c55e' : cp.metadata?.fqi >= 60 ? '#eab308' : '#ef4444'}">${cp.metadata?.fqi ?? '—'}</span>
            </div>
            <div class="field-score-block">
              <span class="score-label">Rules</span>
              <span class="score-value">${totalF}</span>
            </div>
            <div class="field-score-block">
              <span class="score-label">Passed</span>
              <span class="score-value" style="color:#22c55e">${passedF}</span>
            </div>
            <div class="field-score-block">
              <span class="score-label">Failed</span>
              <span class="score-value" style="color:#ef4444">${failedF}</span>
            </div>
            <span class="field-status-badge" style="border-color:${statusColor};color:${statusColor}">${cp.status}</span>
          </div>
        </div>
        <div class="findings-table-wrap">
          <table class="findings-table">
            <thead>
              <tr>
                <th style="width:180px">Rule ID</th>
                <th style="width:120px">Type</th>
                <th>Description</th>
                <th style="width:100px">Severity</th>
                <th style="width:70px;text-align:center">Result</th>
              </tr>
            </thead>
            <tbody>${failedRows}${passedRows}${noFailedRow}${noRulesRow}</tbody>
          </table>
          ${toggleBtn}
        </div>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Audit Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; line-height: 1.5; }
    code { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 0.85em; background: #1e293b; padding: 0.15em 0.4em; border-radius: 4px; }
    .report-header { margin-bottom: 2rem; }
    .report-header h1 { font-size: 1.875rem; color: #38bdf8; }
    .report-header .subtitle { color: #64748b; font-size: 0.875rem; margin-top: 0.25rem; }
    .cards { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; min-width: 120px; flex: 1; }
    .card-penalty { border-color: #f9731644; background: #f9731608; }
    .card-penalty-note { font-size: 0.65rem; color: #94a3b8; margin-top: 0.4rem; line-height: 1.4; }
    .challenge-banner {
      background: #f9731608; border: 1px solid #f9731644; border-radius: 12px;
      padding: 1rem 1.25rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #fdba74; line-height: 1.5;
    }
    .card-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
    .card-value { font-size: 1.875rem; font-weight: 700; margin-top: 0.25rem; }
    .grade-badge { display: inline-flex; align-items: center; justify-content: center;
      background: ${gradeColor}1a; color: ${gradeColor}; border: 2px solid ${gradeColor};
      border-radius: 50%; width: 52px; height: 52px; font-size: 1.5rem; font-weight: 800; margin-top: 0.25rem; }
    .section-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 0.75rem; }
    .dist-wrap { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 2rem; }
    .dist-item { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
    .dist-item:last-child { margin-bottom: 0; }
    .dist-label { font-size: 0.8rem; color: #94a3b8; min-width: 140px; }
    .dist-bar-track { flex: 1; background: #0f172a; border-radius: 99px; height: 8px; overflow: hidden; }
    .dist-bar-fill { height: 100%; border-radius: 99px; transition: width 0.3s; }
    .dist-count { font-size: 0.8rem; color: #64748b; min-width: 24px; text-align: right; }
    .fields-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 0.75rem; }
    .field-section { background: #1e293b; border: 1px solid #334155; border-radius: 12px; margin-bottom: 1rem; overflow: hidden; }
    .field-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; gap: 1rem; flex-wrap: wrap; }
    .field-header-left { display: flex; align-items: center; gap: 0.75rem; }
    .field-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .field-locator { font-size: 0.9rem; font-weight: 600; }
    .field-meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }
    .field-maturity { font-size: 0.75rem; color: #64748b; }
    .field-header-right { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .field-score-block { text-align: center; }
    .score-label { display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
    .score-value { display: block; font-size: 1.25rem; font-weight: 700; }
    .field-status-badge { font-size: 0.75rem; font-weight: 700; border: 1.5px solid; border-radius: 6px; padding: 0.2rem 0.6rem; letter-spacing: 0.05em; }
    .badge { display: inline-block; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.15rem 0.5rem; border-radius: 4px; }
    .badge-category { background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; }
    .badge-decl    { background: #0ea5e922; color: #38bdf8;  border: 1px solid #0ea5e944; }
    .badge-beh     { background: #f9731622; color: #fb923c;  border: 1px solid #f9731644; }
    .findings-table-wrap { border-top: 1px solid #1e3a5f; overflow-x: auto; }
    .findings-table { width: 100%; border-collapse: collapse; }
    .findings-table th { background: #0f172a; color: #475569; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.6rem 1rem; text-align: left; white-space: nowrap; }
    .findings-table td { padding: 0.65rem 1rem; border-top: 1px solid #1e293b; font-size: 0.82rem; vertical-align: top; }
    .findings-table tr:hover td { background: #162032; }
    .finding-fail td { background: #ef444408; }
    .finding-fail:hover td { background: #ef444412; }
    .finding-pass td { background: #22c55e08; }
    .finding-pass:hover td { background: #22c55e12; }
    .toggle-passed-btn {
      display: block; margin: 0.6rem 1rem 0.75rem;
      background: transparent; border: 1px solid #334155; border-radius: 6px;
      color: #64748b; font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; padding: 0.3rem 0.75rem; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .toggle-passed-btn:hover { border-color: #22c55e; color: #22c55e; }
    .toggle-passed-btn.active { border-color: #22c55e44; color: #22c55e; background: #22c55e0a; }
  </style>
</head>
<body>
  <div class="report-header">
    <h1>🔍 Audit Report</h1>
    <p class="subtitle">Generated by ATG – Automation Test Generator</p>
  </div>

  ${challengeBanner}

  <div class="cards">
    <div class="card"><div class="card-label">Grade</div><div class="grade-badge">${summary.grade}</div></div>
    <div class="card"><div class="card-label">Global SMI</div><div class="card-value" style="color:#38bdf8">${summary.globalSMI}</div></div>
    <div class="card"><div class="card-label">Avg FQI</div><div class="card-value">${summary.avgFQI}</div></div>
    ${contextPenaltyCard}
    <div class="card"><div class="card-label">Total Fields</div><div class="card-value">${summary.totalFields}</div></div>
    <div class="card"><div class="card-label">✅ Passed</div><div class="card-value" style="color:#22c55e">${summary.passedFields}</div></div>
    <div class="card"><div class="card-label">⚠️ Warns</div><div class="card-value" style="color:#eab308">${summary.warnFields}</div></div>
    <div class="card"><div class="card-label">❌ Failed</div><div class="card-value" style="color:#ef4444">${summary.failedFields}</div></div>
  </div>

  <div class="dist-wrap">
    <div class="section-title">Maturity Distribution</div>
    ${maturityBars || '<p style="color:#475569;font-size:0.85rem">No data</p>'}
  </div>

  <div class="fields-title">Field Audit Details</div>
  ${fieldSections || '<p style="color:#475569;font-size:0.85rem">No fields audited</p>'}

  <script>
    function togglePassed(idx) {
      var rows = document.querySelectorAll('.passed-row-' + idx);
      var btn = document.querySelector('[data-idx="' + idx + '"]');
      var noFailedRow = document.querySelector('.no-failed-row-' + idx);
      var count = rows.length;
      var showing = btn && btn.classList.contains('active');
      rows.forEach(function(r) { r.style.display = showing ? 'none' : ''; });
      if (noFailedRow) noFailedRow.style.display = showing ? '' : 'none';
      if (btn) {
        btn.classList.toggle('active', !showing);
        btn.textContent = showing
          ? 'Show ' + count + ' passing rule' + (count !== 1 ? 's' : '')
          : 'Hide ' + count + ' passing rule' + (count !== 1 ? 's' : '');
      }
    }
  </script>
</body>
</html>`;
  }
}
