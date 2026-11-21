// RENPHO CSV import/export and JSON backup restore.
// Header detection is accent- and language-insensitive (ES/EN exports).
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

/** RFC 4180 quote-aware CSV line splitter (handles commas inside quoted fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseTime(timeStr: string | undefined): { hh: string; mm: string; ss: string } | null {
  const raw = (timeStr || "08:00:00").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  const meridiem = match[4]?.toUpperCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return {
    hh: String(hour).padStart(2, "0"),
    mm: String(minute).padStart(2, "0"),
    ss: String(second).padStart(2, "0"),
  };
}

function detectDateOrder(rows: string[][], dateCol: number, preferMdy: boolean): "dmy" | "mdy" {
  for (const cols of rows) {
    const raw = (dateCol !== -1 ? cols[dateCol] : cols[0]) || "";
    const datePart = raw.trim().split(/\s+/)[0] || "";
    const parts = datePart.split(/[/\-.]/);
    if (parts.length !== 3 || parts[0].length === 4) continue;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a > 12) return "dmy";
    if (b > 12) return "mdy";
  }
  return preferMdy ? "mdy" : "dmy";
}

function parseDate(dateStr: string | undefined, timeStr: string | undefined, order: "dmy" | "mdy" = "dmy") {
  const raw = (dateStr || "").trim();
  // Support combined "YYYY-MM-DD HH:MM:SS" or "MM/DD/YYYY 08:30:00 AM" in a single column
  const spaceIdx = raw.indexOf(" ");
  const dateOnly = spaceIdx !== -1 && !timeStr ? raw.slice(0, spaceIdx) : raw.split(/\s+/)[0];
  const embeddedTime = spaceIdx !== -1 && !timeStr ? raw.slice(spaceIdx + 1).trim() : undefined;

  const parts = dateOnly.split(/[/\-.]/);
  if (parts.length !== 3) return null;
  let day: string;
  let month: string;
  let year: string;
  if (parts[0].length === 4) {
    [year, month, day] = parts;
  } else {
    [day, month, year] = order === "mdy" ? [parts[1], parts[0], parts[2]] : parts;
    if (year.length === 2) year = `20${year}`;
  }
  day = day.padStart(2, "0");
  month = month.padStart(2, "0");
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  const mNum = Number(month);
  const dNum = Number(day);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31) return null;

  const t = parseTime(timeStr || embeddedTime);
  if (!t) return null;

  const iso = `${year}-${month}-${day}T${t.hh}:${t.mm}:${t.ss}`;
  const dObj = new Date(iso);
  const timestamp = dObj.getTime();
  if (Number.isNaN(timestamp) || dObj.getMonth() + 1 !== mNum || dObj.getDate() !== dNum) return null;
  return { date: `${year}-${month}-${day}`, time: `${t.hh}:${t.mm}:${t.ss}`, iso, timestamp };
}

export function parseRenphoCsv(csvText: string): { items: FitRecord[]; error?: string } {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { items: [], error: "El archivo no contiene filas de datos." };

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
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
  const isEnglishHeader = headers.some((h) => h.includes("weight") || h.includes("timeofmeasurement"));
  const rows = lines.slice(1).map(splitCsvLine);
  const dateOrder = detectDateOrder(rows, c.date, isEnglishHeader);

  const items: FitRecord[] = [];
  for (const cols of rows) {
    if (cols.length < 2) continue;

    const rawDate = c.date !== -1 ? cols[c.date] : cols[0];
    const rawTime = c.time !== -1 && c.time !== c.date ? cols[c.time] : c.date === -1 ? cols[1] : undefined;
    const d = parseDate(rawDate, rawTime, dateOrder);
    if (!d) continue;
    const weight = c.weight !== -1 ? parseNum(cols[c.weight]) : parseNum(cols[2]);
    if (!weight || weight < 20 || weight > 400) continue;

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

const OPT_NUM_KEYS = [
  "bmi",
  "bodyFat",
  "skeletalMuscle",
  "fatFreeWeight",
  "subcutaneousFat",
  "visceralFat",
  "bodyWater",
  "muscleMass",
  "boneMass",
  "protein",
  "bmr",
  "metabolicAge",
  "fatMassKg",
  "leanMassKg",
] as const;

/** Parses a JSON backup exported by the app (FitRecord[] or { records: FitRecord[] }). */
export function parseJsonBackup(text: string): { items: FitRecord[]; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { items: [], error: "El archivo JSON no es válido." };
  }
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : null;
  if (!rawList) return { items: [], error: "El JSON no contiene una lista de pesajes." };

  const items: FitRecord[] = [];
  for (const r of rawList) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const weight = typeof rec.weight === "number" && Number.isFinite(rec.weight) ? rec.weight : null;
    if (!weight || weight < 20 || weight > 400) continue;
    if (typeof rec.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) continue;
    const time = typeof rec.time === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(rec.time) ? (rec.time.length === 5 ? `${rec.time}:00` : rec.time) : "08:00:00";
    const iso = typeof rec.iso === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(rec.iso) ? rec.iso : `${rec.date}T${time}`;
    const ts = typeof rec.timestamp === "number" && Number.isFinite(rec.timestamp) ? rec.timestamp : new Date(iso).getTime();
    if (!Number.isFinite(ts)) continue;

    const item: FitRecord = {
      id: typeof rec.id === "string" && /^[0-9A-Za-z_:.\-]{1,64}$/.test(rec.id) ? rec.id : `${rec.date}_${time}`,
      date: rec.date,
      time,
      iso,
      timestamp: ts,
      weight,
    };
    for (const k of OPT_NUM_KEYS) {
      const v = rec[k];
      item[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    items.push(item);
  }
  if (!items.length) return { items, error: "No se encontró ningún pesaje válido en el JSON." };
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

/** Local YYYY-MM-DD date string (avoids UTC off-by-one near midnight). */
export const today = (now = new Date()): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
