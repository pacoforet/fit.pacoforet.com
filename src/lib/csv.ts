// RENPHO CSV import/export. Header detection is accent- and language-insensitive (ES/EN exports).
import type { FitRecord } from "./types";

const normalizeHeader = (h: string) =>
  (h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

const parseNum = (val: string | undefined): number | null => {
  if (!val || val.trim() === "--" || val.trim() === "") return null;
  const num = parseFloat(val.trim().replace("%", "").replace(",", "."));
  return Number.isNaN(num) ? null : num;
};

function parseDate(dateStr: string | undefined, timeStr: string | undefined) {
  const parts = (dateStr || "").trim().split(/[/\-.]/);
  if (parts.length !== 3) return null;
  let [day, month, year] = parts;
  if (day.length === 4) {
    [year, month, day] = parts;
  } else if (year.length === 2) {
    year = `20${year}`;
  }
  day = day.padStart(2, "0");
  month = month.padStart(2, "0");
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;

  const t = (timeStr || "08:00:00").trim().split(":");
  const hh = (t[0] || "08").padStart(2, "0");
  const mm = (t[1] || "00").padStart(2, "0");
  const ss = (t[2] || "00").slice(0, 2).padStart(2, "0");
  if (!/^\d{2}$/.test(hh) || !/^\d{2}$/.test(mm) || !/^\d{2}$/.test(ss)) return null;

  const iso = `${year}-${month}-${day}T${hh}:${mm}:${ss}`;
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return null;
  return { date: `${year}-${month}-${day}`, time: `${hh}:${mm}:${ss}`, iso, timestamp };
}

export function parseRenphoCsv(csvText: string): { items: FitRecord[]; error?: string } {
  const lines = csvText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { items: [], error: "El archivo no contiene filas de datos." };

  const headers = lines[0].split(",").map((c) => normalizeHeader(c.trim().replace(/^"|"$/g, "")));
  const col = (keywords: string[]) => {
    for (const kw of keywords) {
      const idx = headers.findIndex((h) => h === kw || h.includes(kw));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const c = {
    date: col(["fecha", "date", "timeofmeasurement"]),
    time: col(["hora", "time"]),
    weight: col(["pesokg", "peso", "weightkg", "weight"]),
    bmi: col(["imc", "bmi"]),
    bodyFat: col(["porcentajedegrasacorporal", "grasacorporal", "bodyfat"]),
    fatMass: col(["masagrasacorporal", "masagrasa", "fatmass"]),
    skeletal: col(["porcentajedemusculoesqueletico", "musculoesqueletico", "skeletalmuscle"]),
    fatFree: col(["pesocorporalsingrasa", "fatfreeweight", "fatfreebodyweight"]),
    subcut: col(["grasasubcutanea", "subcutaneousfat"]),
    visceral: col(["grasavisceral", "visceralfeat", "visceralfat"]),
    water: col(["porcentajedeaguacorporal", "aguacorporal", "bodywater"]),
    muscleMass: col(["masamuscular", "musclemass"]),
    bone: col(["masaoseakg", "masaosea", "porcentajeoseo", "bonemass"]),
    protein: col(["porcentajedeproteina", "proteina", "protein"]),
    bmr: col(["tasametabolicabasal", "bmr"]),
    age: col(["edadmetabolica", "metabolicage"]),
  };
  const at = (cols: string[], idx: number) => (idx !== -1 ? parseNum(cols[idx]) : null);

  const items: FitRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;

    const d = parseDate(c.date !== -1 ? cols[c.date] : cols[0], c.time !== -1 ? cols[c.time] : cols[1]);
    if (!d) continue;
    const weight = c.weight !== -1 ? parseNum(cols[c.weight]) : parseNum(cols[2]);
    if (!weight) continue;

    const bodyFat = at(cols, c.bodyFat);
    const fatFreeWeight = at(cols, c.fatFree);
    const fatMassKg = at(cols, c.fatMass) ?? (bodyFat ? +(weight * (bodyFat / 100)).toFixed(2) : null);
    const leanMassKg = fatMassKg ? +(weight - fatMassKg).toFixed(2) : fatFreeWeight;

    items.push({
      id: `${d.date}_${d.time}`,
      ...d,
      weight,
      bmi: at(cols, c.bmi),
      bodyFat,
      skeletalMuscle: at(cols, c.skeletal),
      fatFreeWeight,
      subcutaneousFat: at(cols, c.subcut),
      visceralFat: at(cols, c.visceral),
      bodyWater: at(cols, c.water),
      muscleMass: at(cols, c.muscleMass),
      boneMass: at(cols, c.bone),
      protein: at(cols, c.protein),
      bmr: at(cols, c.bmr),
      metabolicAge: at(cols, c.age),
      fatMassKg,
      leanMassKg,
    });
  }
  if (!items.length) return { items, error: "No se reconoció ningún pesaje en ese formato." };
  return { items };
}

export function toCsv(records: FitRecord[]): string {
  const header =
    "Fecha,Hora,Peso(kg),IMC,Grasa corporal(%),Músculo esquelético(%),Peso corporal sin grasa(kg),Grasa subcutánea(%),Grasa visceral,Agua corporal(%),Masa muscular(kg),Masa ósea(kg),Proteína (%),Tasa Metabólica Basal(kcal),Edad metabólica";
  const v = (x: number | null | undefined) => (x ?? "").toString();
  const rows = records.map((r) =>
    [
      r.date,
      r.time,
      r.weight,
      v(r.bmi),
      v(r.bodyFat),
      v(r.skeletalMuscle),
      v(r.fatFreeWeight),
      v(r.subcutaneousFat),
      v(r.visceralFat),
      v(r.bodyWater),
      v(r.muscleMass),
      v(r.boneMass),
      v(r.protein),
      v(r.bmr),
      v(r.metabolicAge),
    ].join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const today = () => new Date().toISOString().split("T")[0];
