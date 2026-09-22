export interface FitRecord {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  iso: string;
  timestamp: number;
  weight: number;
  bmi?: number | null;
  bodyFat?: number | null;
  skeletalMuscle?: number | null;
  fatFreeWeight?: number | null;
  subcutaneousFat?: number | null;
  visceralFat?: number | null;
  bodyWater?: number | null;
  muscleMass?: number | null;
  boneMass?: number | null;
  protein?: number | null;
  bmr?: number | null;
  metabolicAge?: number | null;
  fatMassKg?: number | null;
  leanMassKg?: number | null;
}

export interface Profile {
  name: string;
  height: number; // meters
  targetWeight: number;
  targetBodyFat: number;
}

export type RangeKey = "7d" | "30d" | "90d" | "all";
export type ChartMetric = "weight" | "bodyFat" | "skeletalMuscle" | "composition";
export type ViewKey = "resumen" | "tendencias" | "historial";
export type Tone = "positive" | "negative" | "warning" | "neutral";
export type SyncState = "idle" | "syncing" | "synced" | "local" | "error" | "demo";
