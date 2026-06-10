import type { Signal } from '../../domain/types.js';

const INE_URL = 'https://servicios.ine.es/wstempus/js/ES/DATOS_TABLA/4247?nult=4';
const HEADERS: HeadersInit = { 'User-Agent': 'Mozilla/5.0 (compatible; market-intel/0.1)' };

export async function collectINE(keywords: string[], segment: string): Promise<Signal[]> {
  let rows: Array<{ Nombre: string; Data: Array<{ Valor: number; Fecha: string }> }> = [];
  try {
    const res = await fetch(INE_URL, { headers: HEADERS });
    if (!res.ok) return [];
    rows = await res.json() as typeof rows;
  } catch { return []; }

  return rows
    .filter(row => keywords.some(kw => row.Nombre.toLowerCase().includes(kw.toLowerCase())))
    .slice(0, 5)
    .map(row => {
      const latest = row.Data[row.Data.length - 1];
      return {
        id:              crypto.randomUUID(),
        source:          'local_news' as const,
        collected_at:    new Date().toISOString(),
        segment,
        location:        'ES',
        raw_text:        `INE ${row.Nombre}: ${latest?.Valor ?? 'N/A'} (${latest?.Fecha ?? ''})`,
        url:             'https://www.ine.es/jaxiT3/Tabla.htm?t=4247',
        pain_keywords:   keywords.filter(kw => row.Nombre.toLowerCase().includes(kw.toLowerCase())),
        sentiment_score: null,
        salary_mean:     null,
        income_tier:     null,
        signal_strength: 0.3,
        has_deadline:    false,
        friction_analysis: null,
      } satisfies Signal;
    });
}
