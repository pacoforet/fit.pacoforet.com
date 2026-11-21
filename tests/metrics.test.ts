import { describe, expect, it } from "vitest";
import { DAY, ffmi, milestones, recomposition, slopePerWeek, summarize, toneOf, trendSeries, weeklyBreakdown } from "../src/lib/metrics";
import type { FitRecord, Profile } from "../src/lib/types";

const BASE_TS = new Date("2026-08-01T08:00:00").getTime();

function rec(dayOffset: number, weight: number, extra: Partial<FitRecord> = {}): FitRecord {
  const ts = BASE_TS + dayOffset * DAY;
  const d = new Date(ts);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    id: `${date}_08:00:00`,
    date,
    time: "08:00:00",
    iso: `${date}T08:00:00`,
    timestamp: ts,
    weight,
    ...extra,
  };
}

const profile: Profile = {
  name: "Test",
  height: 1.8,
  targetWeight: 75,
  targetBodyFat: 18,
};

describe("metrics", () => {
  it("computes 7-day moving average trendSeries", () => {
    const records = [rec(0, 82), rec(1, 80), rec(2, 81), rec(10, 79)];
    const trend = trendSeries(records, "weight");
    expect(trend[0]).toBeCloseTo(82, 5);
    expect(trend[1]).toBeCloseTo(81, 5);
    expect(trend[2]).toBeCloseTo(81, 5);
    // Day 10 is >7 days after day 2, so only day 10 is in window
    expect(trend[3]).toBeCloseTo(79, 5);
  });

  it("computes weekly least-squares slope", () => {
    const records = Array.from({ length: 15 }, (_, i) => rec(i, 82 - i * 0.1));
    const slope = slopePerWeek(records, "weight");
    expect(slope).not.toBeNull();
    expect(slope!).toBeCloseTo(-0.7, 2);
  });

  it("summarizes healthy weight loss with ETA and milestones", () => {
    const records = Array.from({ length: 22 }, (_, i) => rec(i, 82 - i * 0.08));
    const s = summarize(records, profile)!;
    expect(s.goalDirection).toBe(-1);
    expect(s.pace).toBe("healthy");
    expect(s.goalReached).toBe(false);
    expect(s.goalProgress).toBeGreaterThan(0);
    expect(s.goalProgress).toBeLessThan(1);
    expect(s.etaTs).not.toBeNull();

    const weeks = weeklyBreakdown(records);
    expect(weeks.length).toBeGreaterThanOrEqual(3);
    const ms = milestones(records, profile, s, weeks);
    expect(ms.some((m) => m.kind === "start")).toBe(true);
    expect(ms.some((m) => m.kind === "goal")).toBe(true);
  });

  it("detects goal reached and recomposition quality", () => {
    const records = [
      rec(0, 80, { bodyFat: 25 }), // 20 kg fat, 60 kg lean
      rec(14, 75, { bodyFat: 20 }), // 15 kg fat, 60 kg lean (100% fat lost)
    ];
    const s = summarize(records, profile)!;
    expect(s.goalReached).toBe(true);
    expect(s.goalRemaining).toBe(0);

    const rc = recomposition(records)!;
    expect(rc.weightLost).toBeCloseTo(5, 2);
    expect(rc.fatLost).toBeCloseTo(5, 2);
    expect(rc.leanLost).toBeCloseTo(0, 2);
    expect(rc.fatShare).toBeCloseTo(1, 2);
    expect(rc.quality?.tone).toBe("positive");
  });

  it("computes FFMI and metric tones", () => {
    const records = [rec(0, 80, { leanMassKg: 65 })];
    const f = ffmi(records, 1.8)!;
    expect(f.value).toBeCloseTo(20.06, 2);
    expect(f.normalized).toBeCloseTo(20.06, 2);
    expect(f.label).toBe("Excelente");

    expect(toneOf("weight", -0.5, -1)).toBe("positive");
    expect(toneOf("weight", 0.5, -1)).toBe("negative");
    expect(toneOf("weight", 0.5, 1)).toBe("positive");
    expect(toneOf("bmi", 1, -1)).toBe("neutral");
  });
});
