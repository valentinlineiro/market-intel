import { describe, it, expect } from "vitest";
import {
  computeOpportunityScore,
  dolorScore,
  incomeTierScore,
  urgencyScore,
  volumeScore,
  applyRules,
  shouldAlert,
  formatAlert,
} from "../../domain/scoring.js";
import {
  KILL_SCORE_THRESHOLD,
  SCALE_SCORE_THRESHOLD,
  ALERT_SCORE_THRESHOLD,
  SCORE_WEIGHTS,
} from "../../domain/rules.js";
import type { Signal, Opportunity, SegmentConfig } from "../../domain/types.js";

// ---------------------------------------------------------------------------
// computeOpportunityScore
// ---------------------------------------------------------------------------

describe("computeOpportunityScore", () => {
  it("returns 0 for empty breakdown (all fields default to 0)", () => {
    const result = computeOpportunityScore({
      dolor: 0,
      capacidad_pago: 0,
      volumen: 0,
      competencia: 0,
      urgencia: 0,
    });
    expect(result).toBe(0);
  });

  it("applies weights correctly: all 10s yields 10", () => {
    const breakdown = {
      dolor: 10,
      capacidad_pago: 10,
      volumen: 10,
      competencia: 10,
      urgencia: 10,
    };
    // sum of weights = 0.30+0.25+0.20+0.15+0.10 = 1.0, so 10*1.0 = 10
    expect(computeOpportunityScore(breakdown)).toBe(10);
  });

  it("weighs dolor at 0.30", () => {
    const breakdown = {
      dolor: 10,
      capacidad_pago: 0,
      volumen: 0,
      competencia: 0,
      urgencia: 0,
    };
    expect(computeOpportunityScore(breakdown)).toBe(
      Math.round(10 * SCORE_WEIGHTS.dolor * 100) / 100
    );
  });

  it("rounds to 2 decimal places", () => {
    const breakdown = {
      dolor: 1,
      capacidad_pago: 1,
      volumen: 1,
      competencia: 1,
      urgencia: 1,
    };
    const result = computeOpportunityScore(breakdown);
    expect(result).toBe(1); // 1 * (0.30+0.25+0.20+0.15+0.10) = 1.00
  });
});

// ---------------------------------------------------------------------------
// dolorScore
// ---------------------------------------------------------------------------

describe("dolorScore", () => {
  const FIXED_NOW = 1_700_000_000_000; // fixed timestamp for deterministic tests

  it("returns 0 for empty signals array", () => {
    const [score, summary] = dolorScore([], FIXED_NOW);
    expect(score).toBe(0);
    expect(summary).toBe("");
  });

  it("returns 0 for signals older than 30 days", () => {
    const old = new Date(FIXED_NOW - 31 * 86400000).toISOString();
    const signal: Signal = {
      id: "s1",
      source: "gnews",
      collected_at: old,
      segment: "test",
      location: null,
      raw_text: "old text",
      url: "http://example.com",
      pain_keywords: ["pain"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 0.8,
      has_deadline: false,
    };
    const [score] = dolorScore([signal], FIXED_NOW);
    expect(score).toBe(0);
  });

  it("returns score > 0 for recent signals", () => {
    const recentTs = new Date(FIXED_NOW - 86400000).toISOString(); // 1 day ago
    const signals: Signal[] = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      source: "gnews" as const,
      collected_at: recentTs,
      segment: "test",
      location: null,
      raw_text: "text",
      url: "http://example.com",
      pain_keywords: ["burocracia", "multa"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 0.8,
      has_deadline: false,
    }));
    const [score, summary] = dolorScore(signals, FIXED_NOW);
    expect(score).toBeGreaterThan(0);
    expect(summary).toMatch(/burocracia|multa|señales/);
  });

  it("never exceeds 10", () => {
    const recentTs = new Date(FIXED_NOW - 86400000).toISOString(); // 1 day ago
    const signals: Signal[] = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      source: "gnews" as const,
      collected_at: recentTs,
      segment: "test",
      location: null,
      raw_text: "text",
      url: "http://example.com",
      pain_keywords: ["pain"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 1.0,
      has_deadline: false,
    }));
    const [score] = dolorScore(signals, FIXED_NOW);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("high-quality low-volume beats low-quality high-volume", () => {
    const now = FIXED_NOW;
    const recentTs = new Date(now - 86400000).toISOString();
    // 20 weak signals (ss 0.3) — generic noise
    const weak: Signal[] = Array.from({ length: 20 }, (_, i) => ({
      id: `weak-${i}`, source: "gnews" as const, collected_at: recentTs,
      segment: "test", location: null, raw_text: "generic news", url: `http://ex.com/${i}`,
      pain_keywords: ["generic"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.3, has_deadline: false,
    }));
    // 5 strong signals (ss 0.9) — specific complaints
    const strong: Signal[] = Array.from({ length: 5 }, (_, i) => ({
      id: `str-${i}`, source: "gnews" as const, collected_at: recentTs,
      segment: "test", location: null, raw_text: "specific complaint about X", url: `http://ex.com/s${i}`,
      pain_keywords: ["specific", "pain"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.9, has_deadline: false,
    }));
    const [strongScore] = dolorScore(strong, now);
    const [weakScore] = dolorScore(weak, now);
    expect(strongScore).toBeGreaterThan(weakScore);
  });

  it("specific complaint (ss=0.8, n=3) beats generic volume (ss=0.3, n=30)", () => {
    const now = FIXED_NOW;
    const ts = new Date(now - 86400000).toISOString();
    const specific: Signal[] = Array.from({ length: 3 }, (_, i) => ({
      id: `sp-${i}`, source: "gnews" as const, collected_at: ts,
      segment: "test", location: null, raw_text: "real complaint", url: `http://ex.com/sp${i}`,
      pain_keywords: ["dolor", "problema"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.8, has_deadline: false,
    }));
    const generic: Signal[] = Array.from({ length: 30 }, (_, i) => ({
      id: `gn-${i}`, source: "gnews" as const, collected_at: ts,
      segment: "test", location: null, raw_text: "generic news article", url: `http://ex.com/gn${i}`,
      pain_keywords: ["news"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.3, has_deadline: false,
    }));
    const [specScore] = dolorScore(specific, now);
    const [genScore] = dolorScore(generic, now);
    expect(specScore).toBeGreaterThan(genScore);
  });

  it('duplicate signals cluster into one topic — volume bonus capped at unique topics', () => {
    const now = FIXED_NOW;
    const ts = new Date(now - 86400000).toISOString();
    // 20 identical signals — only 1 unique topic
    const dupes: Signal[] = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`, source: 'gnews' as const, collected_at: ts,
      segment: 'test', location: null, raw_text: 'same', url: `http://ex.com/${i}`,
      pain_keywords: ['verifactu', 'hacienda'], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.8, has_deadline: false,
    }));
    // 4 signals on 4 distinct topics
    const diverse: Signal[] = [
      { id: 't1', source: 'gnews', collected_at: ts, segment: 'test', location: null, raw_text: 'a', url: 'u1', pain_keywords: ['aneca', 'sexenio'], sentiment_score: null, salary_mean: null, income_tier: null, signal_strength: 0.8, has_deadline: false },
      { id: 't2', source: 'gnews', collected_at: ts, segment: 'test', location: null, raw_text: 'b', url: 'u2', pain_keywords: ['lexnet', 'irpf'], sentiment_score: null, salary_mean: null, income_tier: null, signal_strength: 0.8, has_deadline: false },
      { id: 't3', source: 'gnews', collected_at: ts, segment: 'test', location: null, raw_text: 'c', url: 'u3', pain_keywords: ['multa', 'burocracia'], sentiment_score: null, salary_mean: null, income_tier: null, signal_strength: 0.8, has_deadline: false },
      { id: 't4', source: 'gnews', collected_at: ts, segment: 'test', location: null, raw_text: 'd', url: 'u4', pain_keywords: ['licencia', 'obras'], sentiment_score: null, salary_mean: null, income_tier: null, signal_strength: 0.8, has_deadline: false },
    ];
    const [dupeScore] = dolorScore(dupes, now);
    const [diverseScore] = dolorScore(diverse, now);
    // 4 unique topics should outscore 20 duplicate signals at same signal_strength
    expect(diverseScore).toBeGreaterThan(dupeScore);
  });
});

// ---------------------------------------------------------------------------
// incomeTierScore
// ---------------------------------------------------------------------------

describe("incomeTierScore", () => {
  it("returns correct value for high", () => expect(incomeTierScore("high")).toBe(10));
  it("returns correct value for medium_high", () => expect(incomeTierScore("medium_high")).toBe(7));
  it("returns correct value for medium", () => expect(incomeTierScore("medium")).toBe(5));
  it("returns correct value for low", () => expect(incomeTierScore("low")).toBe(2));
  it("returns fallback for unknown tier", () => expect(incomeTierScore("unknown")).toBe(2));
  it("returns fallback for null", () => expect(incomeTierScore(null)).toBe(2));
});

// ---------------------------------------------------------------------------
// urgencyScore
// ---------------------------------------------------------------------------

describe("urgencyScore", () => {
  it("returns 10 when has deadline", () => expect(urgencyScore(true)).toBe(10));
  it("returns 0 when no deadline", () => expect(urgencyScore(false)).toBe(0));
});

// ---------------------------------------------------------------------------
// volumeScore
// ---------------------------------------------------------------------------

describe("volumeScore", () => {
  it("caps at 10", () => expect(volumeScore(999)).toBe(10));
  it("normalises: discovery_score 20 → 10", () => expect(volumeScore(20)).toBe(10));
  it("normalises: discovery_score 10 → 5", () => expect(volumeScore(10)).toBe(5));
  it("returns 0 for 0", () => expect(volumeScore(0)).toBe(0));
});

// ---------------------------------------------------------------------------
// applyRules
// ---------------------------------------------------------------------------

describe("applyRules", () => {
  const baseOpp: Opportunity = {
    id: "abc",
    segment: "test",
    pain_summary: "",
    score: 6.0,
    score_breakdown: { dolor: 6, capacidad_pago: 6, volumen: 6, competencia: 6, urgencia: 6 },
    signal_ids: [],
    signal_count: 5,
    first_seen: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: "watching",
    landing_url: null,
    emails_captured: 0,
    validation_deadline: null,
    telegram_alerted_at: null,
  };

  it("does not change an already-killed opportunity", () => {
    const opp: Opportunity = { ...baseOpp, status: "killed" };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("does not change an already-scaling opportunity", () => {
    const opp: Opportunity = { ...baseOpp, status: "scaling" };
    expect(applyRules(opp).status).toBe("scaling");
  });

  it("kills opp with no signals after threshold days and low score", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp: Opportunity = {
      ...baseOpp,
      signal_count: 0,
      score: KILL_SCORE_THRESHOLD - 0.1,
      first_seen: old,
    };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("does not kill if score is at or above kill threshold", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp: Opportunity = {
      ...baseOpp,
      signal_count: 0,
      score: KILL_SCORE_THRESHOLD + 1,
      first_seen: old,
    };
    expect(applyRules(opp).status).toBe("watching");
  });

  it("scales opp with high score and enough emails", () => {
    const opp: Opportunity = {
      ...baseOpp,
      score: SCALE_SCORE_THRESHOLD + 0.1,
      emails_captured: 30,
    };
    expect(applyRules(opp).status).toBe("scaling");
  });

  it("keeps watching status when conditions not met", () => {
    expect(applyRules(baseOpp).status).toBe("watching");
  });
});

// ---------------------------------------------------------------------------
// shouldAlert
// ---------------------------------------------------------------------------

describe("shouldAlert", () => {
  it("returns true when telegram_alerted_at is null", () => {
    const opp: Opportunity = {
      id: "x",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD + 1,
      score_breakdown: { dolor: 8, capacidad_pago: 8, volumen: 8, competencia: 8, urgencia: 8 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: null,
    };
    expect(shouldAlert(opp)).toBe(true);
  });

  it("returns false when already alerted (telegram_alerted_at is set)", () => {
    const opp: Opportunity = {
      id: "x",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD + 1,
      score_breakdown: { dolor: 8, capacidad_pago: 8, volumen: 8, competencia: 8, urgencia: 8 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: new Date().toISOString(),
    };
    expect(shouldAlert(opp)).toBe(false);
  });

  it("returns false when score is below threshold even if telegram_alerted_at is null", () => {
    const opp: Opportunity = {
      id: "x",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD - 0.1,
      score_breakdown: { dolor: 5, capacidad_pago: 5, volumen: 5, competencia: 5, urgencia: 5 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: null,
    };
    expect(shouldAlert(opp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatAlert
// ---------------------------------------------------------------------------

describe("formatAlert", () => {
  const baseOpp: Opportunity = {
    id: "opp1",
    segment: "test_segment",
    pain_summary: "Test pain summary",
    score: 7.5,
    score_breakdown: { dolor: 8, capacidad_pago: 7, volumen: 6, competencia: 5, urgencia: 9 },
    signal_ids: ["s1", "s2"],
    signal_count: 2,
    first_seen: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: "watching",
    landing_url: null,
    emails_captured: 5,
    validation_deadline: null,
    telegram_alerted_at: null,
  };

  const baseSegment: SegmentConfig = {
    key: "test_segment",
    label: "Test Segment Label",
    keywords: ["test"],
    income_tier: "high",
    has_deadline: false,
    discovery_score: 10,
  };

  it("returns an object with subject, html, and text fields", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result).toHaveProperty("subject");
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
  });

  it("subject contains the segment label", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.subject).toContain("Test Segment Label");
  });

  it("subject contains the opportunity score", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.subject).toContain("7.5/10");
  });

  it("html is a non-empty string", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(typeof result.html).toBe("string");
    expect(result.html.length).toBeGreaterThan(0);
  });

  it("text is a non-empty string", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("html contains HTML tags", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.html).toMatch(/<h2>|<p>|<\/p>|<\/h2>/);
  });

  it("text does not contain HTML tags", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.text).not.toMatch(/<[^>]+>/);
  });

  it("includes pain summary in both formats", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.html).toContain("Test pain summary");
    expect(result.text).toContain("Test pain summary");
  });

  it("includes signal count in both formats", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.html).toContain("2");
    expect(result.text).toContain("2");
  });

  it("includes deadline note when segment has_deadline is true", () => {
    const segmentWithDeadline: SegmentConfig = { ...baseSegment, has_deadline: true };
    const result = formatAlert(baseOpp, segmentWithDeadline);
    expect(result.html).toContain("Deadline activo");
    expect(result.text).toContain("Deadline activo");
  });

  it("does not include deadline note when segment has_deadline is false", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.html).not.toContain("Deadline activo");
    expect(result.text).not.toContain("Deadline activo");
  });

  it("includes score breakdown values in both formats", () => {
    const result = formatAlert(baseOpp, baseSegment);
    expect(result.html).toContain("8"); // dolor
    expect(result.text).toContain("8");
  });
});

// ---------------------------------------------------------------------------
// Ported from deleted score.test.js (JS migration coverage)
// ---------------------------------------------------------------------------

describe("computeOpportunityScore (ported)", () => {
  it("returns 0 for empty breakdown", () => {
    expect(computeOpportunityScore({ dolor: 0, capacidad_pago: 0, volumen: 0, competencia: 0, urgencia: 0 })).toBe(0);
  });

  it("applies weights correctly (all dimensions = 10 → score = 10)", () => {
    const breakdown = { dolor: 10, capacidad_pago: 10, volumen: 10, competencia: 10, urgencia: 10 };
    expect(computeOpportunityScore(breakdown)).toBe(10);
  });

  it("uses partial breakdown (only dolor set)", () => {
    // dolor weight = 0.35, so 10 * 0.35 = 3.5
    expect(computeOpportunityScore({ dolor: 10, capacidad_pago: 0, volumen: 0, competencia: 0, urgencia: 0 })).toBe(3.5);
  });
});

describe("incomeTierScore (ported)", () => {
  it("returns 10 for high", () => expect(incomeTierScore("high")).toBe(10));
  it("returns 7 for medium_high", () => expect(incomeTierScore("medium_high")).toBe(7));
  it("returns 5 for medium", () => expect(incomeTierScore("medium")).toBe(5));
  it("returns 2 for low", () => expect(incomeTierScore("low")).toBe(2));
  it("returns 2 for unknown tier", () => expect(incomeTierScore("unknown")).toBe(2));
});

describe("urgencyScore (ported)", () => {
  it("returns 10 when has deadline", () => expect(urgencyScore(true)).toBe(10));
  it("returns 0 when no deadline", () => expect(urgencyScore(false)).toBe(0));
});

describe("volumeScore (ported)", () => {
  it("caps at 10", () => expect(volumeScore(999)).toBe(10));
  it("normalises: discovery_score 20 → 10", () => expect(volumeScore(20)).toBe(10));
  it("normalises: discovery_score 10 → 5", () => expect(volumeScore(10)).toBe(5));
  it("returns 0 for 0", () => expect(volumeScore(0)).toBe(0));
});

describe("dolorScore (ported)", () => {
  it("returns [0, ''] for empty signals", () => {
    const [score, summary] = dolorScore([]);
    expect(score).toBe(0);
    expect(summary).toBe("");
  });

  it("returns 0 for signals older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const signal: Signal = {
      id: "s-old",
      source: "gnews",
      collected_at: old,
      segment: "test",
      location: null,
      raw_text: "old text",
      url: "http://example.com/old",
      pain_keywords: ["pain"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 1.0,
      has_deadline: false,
    };
    const [score] = dolorScore([signal]);
    expect(score).toBe(0);
  });

  it("scores recent signals > 0", () => {
    const now = Date.now();
    const recentTs = new Date(now - 86400000).toISOString();
    const signals: Signal[] = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      source: "gnews" as const,
      collected_at: recentTs,
      segment: "test",
      location: null,
      raw_text: "text",
      url: `http://example.com/${i}`,
      pain_keywords: ["burocracia", "multa"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 0.8,
      has_deadline: false,
    }));
    const [score, summary] = dolorScore(signals, now);
    expect(score).toBeGreaterThan(0);
    expect(summary).toMatch(/burocracia|multa|señales/);
  });

  it("never exceeds 10", () => {
    const now = Date.now();
    const recentTs = new Date(now - 86400000).toISOString();
    const signals: Signal[] = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      source: "gnews" as const,
      collected_at: recentTs,
      segment: "test",
      location: null,
      raw_text: "text",
      url: `http://example.com/bulk-${i}`,
      pain_keywords: ["pain"],
      sentiment_score: null,
      salary_mean: null,
      income_tier: null,
      signal_strength: 1.0,
      has_deadline: false,
    }));
    const [score] = dolorScore(signals, now);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("high-quality low-volume beats low-quality high-volume (ported)", () => {
    const now = Date.now();
    const ts = new Date(now - 86400000).toISOString();
    const specific: Signal[] = Array.from({ length: 3 }, (_, i) => ({
      id: `sp-${i}`, source: "gnews" as const, collected_at: ts,
      segment: "test", location: null, raw_text: "real complaint", url: `http://ex.com/sp${i}`,
      pain_keywords: ["dolor"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.8, has_deadline: false,
    }));
    const generic: Signal[] = Array.from({ length: 30 }, (_, i) => ({
      id: `gn-${i}`, source: "gnews" as const, collected_at: ts,
      segment: "test", location: null, raw_text: "generic news", url: `http://ex.com/gn${i}`,
      pain_keywords: ["news"], sentiment_score: null, salary_mean: null,
      income_tier: null, signal_strength: 0.3, has_deadline: false,
    }));
    const [specScore] = dolorScore(specific, now);
    const [genScore] = dolorScore(generic, now);
    expect(specScore).toBeGreaterThan(genScore);
  });
});

describe("applyRules (ported)", () => {
  const baseOpp: Opportunity = {
    id: "ported-abc",
    segment: "test",
    pain_summary: "",
    score: 6.0,
    score_breakdown: { dolor: 6, capacidad_pago: 6, volumen: 6, competencia: 6, urgencia: 6 },
    signal_ids: [],
    signal_count: 5,
    first_seen: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    status: "watching",
    landing_url: null,
    emails_captured: 0,
    validation_deadline: null,
    telegram_alerted_at: null,
  };

  it("does not change already-killed opp", () => {
    const opp: Opportunity = { ...baseOpp, status: "killed" };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("kills opp with no signals after threshold days", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp: Opportunity = { ...baseOpp, signal_count: 0, score: 4.0, first_seen: old };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("does not kill if score is above kill threshold", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp: Opportunity = { ...baseOpp, signal_count: 0, score: KILL_SCORE_THRESHOLD + 1, first_seen: old };
    expect(applyRules(opp).status).toBe("watching");
  });

  it("scales opp with high score and enough emails", () => {
    const opp: Opportunity = { ...baseOpp, score: SCALE_SCORE_THRESHOLD + 0.1, emails_captured: 30 };
    expect(applyRules(opp).status).toBe("scaling");
  });
});

describe("shouldAlert (ported)", () => {
  it("returns true when never alerted and score above threshold", () => {
    const opp: Opportunity = {
      id: "p1",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD + 1,
      score_breakdown: { dolor: 8, capacidad_pago: 8, volumen: 8, competencia: 8, urgencia: 8 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: null,
    };
    expect(shouldAlert(opp)).toBe(true);
  });

  it("returns false when already alerted", () => {
    const recent = new Date(Date.now() - 12 * 3600000).toISOString();
    const opp: Opportunity = {
      id: "p2",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD + 1,
      score_breakdown: { dolor: 8, capacidad_pago: 8, volumen: 8, competencia: 8, urgencia: 8 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: recent,
    };
    expect(shouldAlert(opp)).toBe(false);
  });

  it("returns false when score below alert threshold", () => {
    const opp: Opportunity = {
      id: "p3",
      segment: "s",
      pain_summary: "",
      score: ALERT_SCORE_THRESHOLD - 1,
      score_breakdown: { dolor: 5, capacidad_pago: 5, volumen: 5, competencia: 5, urgencia: 5 },
      signal_ids: [],
      signal_count: 0,
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      status: "watching",
      landing_url: null,
      emails_captured: 0,
      validation_deadline: null,
      telegram_alerted_at: null,
    };
    expect(shouldAlert(opp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constants exported from rules.ts
// ---------------------------------------------------------------------------

describe("rules constants", () => {
  it("SCORE_WEIGHTS sum to 1.0", () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 100) / 100).toBe(1.0);
  });

  it("KILL_SCORE_THRESHOLD is a positive number", () => {
    expect(KILL_SCORE_THRESHOLD).toBeGreaterThan(0);
  });

  it("SCALE_SCORE_THRESHOLD > KILL_SCORE_THRESHOLD", () => {
    expect(SCALE_SCORE_THRESHOLD).toBeGreaterThan(KILL_SCORE_THRESHOLD);
  });

  it("ALERT_SCORE_THRESHOLD is a positive number", () => {
    expect(ALERT_SCORE_THRESHOLD).toBeGreaterThan(0);
  });
});
