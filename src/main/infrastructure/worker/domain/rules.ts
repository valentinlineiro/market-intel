import type { ScoreBreakdown } from './types.js';

export const SCORE_WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  dolor: 0.30,
  capacidad_pago: 0.25,
  volumen: 0.20,
  competencia: 0.15,
  urgencia: 0.10,
};

export const KILL_SCORE_THRESHOLD = 5.0;
export const SCALE_SCORE_THRESHOLD = 8.0;
export const ALERT_SCORE_THRESHOLD = 7.0;

export const KILL_THRESHOLD_DAYS = 7;
export const SCALE_THRESHOLD_EMAILS = 30;
export const DEFAULT_COMPETENCIA_SCORE = 5.0;
