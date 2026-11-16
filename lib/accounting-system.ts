/**
 * The accounting programs a merchant can name in Settings (2026-11-16).
 *
 * Only Centas and Rivilė have an API we read, so only those two get a key
 * field. Every other program is served by a file the bookkeeper imports -
 * and each program has its own import format, written from that program's
 * real template, never from memory. Until a program's format is in,
 * the export falls back to the generic accounting file.
 */
export const ACCOUNTING_SYSTEMS = ['centas', 'rivile', 'dineta', 'b1', 'other'] as const;
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number];

/** Programs we connect to with a key rather than a file. */
export const HAS_API: ReadonlySet<AccountingSystem> = new Set(['centas', 'rivile']);

/** Display names - proper nouns, the same in both languages. */
export const SYSTEM_NAMES: Record<Exclude<AccountingSystem, 'other'>, string> = {
  centas: 'Centas',
  rivile: 'Rivilė ERP',
  dineta: 'DINETA.web',
  b1: 'B1.lt',
};
