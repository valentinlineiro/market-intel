import { describe, it, expect } from "vitest";
import {
  computeOpportunityScore,
  incomeTierScore,
  urgencyScore,
  volumeScore,
  dolorScore,
  applyRules,
  shouldAlert,
  ALERT_SCORE_THRESHOLD,
  KILL_SCORE_THRESHOLD,
  SCALE_SCORE_THRESHOLD,
} from "../score.js";

describe("computeOpportunityScore", () => {
  it("returns 0 for empty breakdown", () => {
    expect(computeOpportunityScore({})).toBe(0);
  });

  it("applies weights correctly", () => {
    const breakdown = { dolor: 10, capacidad_pago: 10, volumen: 10, competencia: 10, urgencia: 10 };
    expect(computeOpportunityScore(breakdown)).toBe(10);
  });

  it("uses partial breakdown without crashing", () => {
    expect(computeOpportunityScore({ dolor: 10 })).toBe(3);
  });
});

describe("incomeTierScore", () => {
  it("returns 10 for high", () => expect(incomeTierScore("high")).toBe(10));
  it("returns 7 for medium_high", () => expect(incomeTierScore("medium_high")).toBe(7));
  it("returns 5 for medium", () => expect(incomeTierScore("medium")).toBe(5));
  it("returns 2 for low", () => expect(incomeTierScore("low")).toBe(2));
  it("returns 2 for unknown tier", () => expect(incomeTierScore("unknown")).toBe(2));
});

describe("urgencyScore", () => {
  it("returns 10 when has deadline", () => expect(urgencyScore(true)).toBe(10));
  it("returns 0 when no deadline", () => expect(urgencyScore(false)).toBe(0));
});

describe("volumeScore", () => {
  it("caps at 10", () => expect(volumeScore(999)).toBe(10));
  it("normalises: discovery_score 20 → 10", () => expect(volumeScore(20)).toBe(10));
  it("normalises: discovery_score 10 → 5", () => expect(volumeScore(10)).toBe(5));
  it("returns 0 for 0", () => expect(volumeScore(0)).toBe(0));
});

describe("dolorScore", () => {
  it("returns [0, ''] for empty signals", () => {
    const [score, summary] = dolorScore([]);
    expect(score).toBe(0);
    expect(summary).toBe("");
  });

  it("returns [0, ''] for signals older than 30 days", () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    const [score] = dolorScore([{ collected_at: old, signal_strength: 1.0, pain_keywords: "[]" }]);
    expect(score).toBe(0);
  });

  it("scores recent signals > 0", () => {
    const now = new Date().toISOString();
    const signals = Array.from({ length: 10 }, (_, i) => ({
      collected_at: now,
      signal_strength: 0.8,
      pain_keywords: JSON.stringify(["burocracia", "multa"]),
    }));
    const [score, summary] = dolorScore(signals);
    expect(score).toBeGreaterThan(0);
    expect(summary).toMatch(/burocracia|multa|señales/);
  });

  it("never exceeds 10", () => {
    const now = new Date().toISOString();
    const signals = Array.from({ length: 100 }, () => ({
      collected_at: now,
      signal_strength: 1.0,
      pain_keywords: JSON.stringify(["pain"]),
    }));
    const [score] = dolorScore(signals);
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe("applyRules", () => {
  const baseOpp = {
    id: "abc",
    segment: "test",
    score: 6.0,
    signal_count: 5,
    status: "watching",
    emails_captured: 0,
    first_seen: new Date().toISOString(),
    kill_threshold_days: 7,
    scale_threshold_emails: 30,
  };

  it("does not change already-killed opp", () => {
    const opp = { ...baseOpp, status: "killed" };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("kills opp with no signals after threshold days", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp = { ...baseOpp, signal_count: 0, score: 4.0, first_seen: old };
    expect(applyRules(opp).status).toBe("killed");
  });

  it("does not kill if score is above kill threshold", () => {
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const opp = { ...baseOpp, signal_count: 0, score: KILL_SCORE_THRESHOLD + 1, first_seen: old };
    expect(applyRules(opp).status).toBe("watching");
  });

  it("scales opp with high score and enough emails", () => {
    const opp = { ...baseOpp, score: SCALE_SCORE_THRESHOLD + 0.1, emails_captured: 30 };
    expect(applyRules(opp).status).toBe("scaling");
  });
});

describe("shouldAlert", () => {
  it("returns true when never alerted", () => {
    expect(shouldAlert({ telegram_alerted_at: null })).toBe(true);
  });

  it("returns false when alerted less than 24h ago", () => {
    const recent = new Date(Date.now() - 12 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: recent })).toBe(false);
  });

  it("returns true when alerted more than 24h ago", () => {
    const old = new Date(Date.now() - 25 * 3600000).toISOString();
    expect(shouldAlert({ telegram_alerted_at: old })).toBe(true);
  });
});
