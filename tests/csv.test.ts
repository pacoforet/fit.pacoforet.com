import { describe, expect, it } from "vitest";
import { parseJsonBackup, parseRenphoCsv, splitCsvLine, toCsv, today } from "../src/lib/csv";

describe("csv & backup parsing", () => {
  it("splits RFC 4180 quoted CSV lines with embedded commas", () => {
    expect(splitCsvLine('"15/08/2026","08:30:00","82,5","22,1%"')).toEqual(["15/08/2026", "08:30:00", "82,5", "22,1%"]);
    expect(splitCsvLine('a,"b, c","d""e",f')).toEqual(["a", "b, c", 'd"e', "f"]);
  });

  it("parses Spanish RENPHO CSV exports including BOM and decimal commas", () => {
    const csv = [
      '\uFEFFFecha,Hora,"Peso(kg)",IMC,"Grasa corporal(%)","Músculo esquelético(%)","Grasa visceral"',
      '"15/08/2026","08:30:00","82,5","24,8","22,5%","49,2%","6"',
      '"16/08/2026","08:15:00","82,1","24,7","22,3%","49,4%","6"',
    ].join("\r\n");

    const { items, error } = parseRenphoCsv(csv);
    expect(error).toBeUndefined();
    expect(items).toHaveLength(2);
    expect(items[0].date).toBe("2026-08-15");
    expect(items[0].time).toBe("08:30:00");
    expect(items[0].weight).toBe(82.5);
    expect(items[0].bodyFat).toBe(22.5);
    expect(items[0].fatMassKg).toBeCloseTo(18.56, 2);
    expect(items[0].leanMassKg).toBeCloseTo(63.94, 2);
  });

  it("parses English US RENPHO CSV exports with MM/DD/YYYY and AM/PM", () => {
    const csv = [
      "Time of Measurement,Weight(kg),BMI,Body Fat(%),Skeletal Muscle(%)",
      "08/15/2026 8:30:00 AM,82.5,24.8,22.5,49.2",
      "08/16/2026 9:05:10 PM,82.0,24.6,22.1,49.6",
    ].join("\n");

    const { items, error } = parseRenphoCsv(csv);
    expect(error).toBeUndefined();
    expect(items).toHaveLength(2);
    expect(items[0].date).toBe("2026-08-15");
    expect(items[0].time).toBe("08:30:00");
    expect(items[1].date).toBe("2026-08-16");
    expect(items[1].time).toBe("21:05:10");
  });

  it("round-trips through toCsv and parseRenphoCsv", () => {
    const csv = toCsv([
      {
        id: "2026-08-15_08:30:00",
        date: "2026-08-15",
        time: "08:30:00",
        iso: "2026-08-15T08:30:00",
        timestamp: new Date("2026-08-15T08:30:00").getTime(),
        weight: 82.5,
        bodyFat: 22.5,
        visceralFat: 6,
      },
    ]);
    const { items, error } = parseRenphoCsv(csv);
    expect(error).toBeUndefined();
    expect(items).toHaveLength(1);
    expect(items[0].weight).toBe(82.5);
    expect(items[0].visceralFat).toBe(6);
  });

  it("parses JSON backups in array and object formats and rejects invalid input", () => {
    const sample = [
      { id: "2026-08-15_08:30:00", date: "2026-08-15", time: "08:30:00", iso: "2026-08-15T08:30:00", timestamp: 1786782600000, weight: 82.5 },
    ];
    expect(parseJsonBackup(JSON.stringify(sample)).items).toHaveLength(1);
    expect(parseJsonBackup(JSON.stringify({ records: sample })).items).toHaveLength(1);
    expect(parseJsonBackup("not json").error).toBeDefined();
    expect(parseJsonBackup(JSON.stringify([{ weight: 5 }])).error).toBeDefined();
  });

  it("formats today() using local calendar date", () => {
    const d = new Date(2026, 7, 5, 0, 30, 0); // 2026-08-05 00:30 local
    expect(today(d)).toBe("2026-08-05");
  });
});
