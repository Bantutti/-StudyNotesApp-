/**
 * FSRS scheduler wrapper (ts-fsrs v6, FSRS-7 model).
 * Fuzz is off so the same review log always rebuilds the same card,
 * on every device. That is the core of "review logs merge by union".
 */
import { DefaultScheduler, Rating } from 'ts-fsrs';

export const SCHEDULER_CONFIG = {
  version: 'FSRS-7',
  desiredRetention: 0.9,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  enableFuzz: false,
  maximumInterval: 36_500,
} as const;

export type Grade = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export const GRADE_LABEL: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

export const toRating = (g: Grade) =>
  g === 1 ? Rating.Again : g === 2 ? Rating.Hard : g === 3 ? Rating.Good : Rating.Easy;

export type Scheduler = Awaited<ReturnType<typeof createScheduler>>;
export type Card = ReturnType<Scheduler['newCard']>;

export function createScheduler() {
  return DefaultScheduler({ ...SCHEDULER_CONFIG, learningSteps: [...SCHEDULER_CONFIG.learningSteps], relearningSteps: [...SCHEDULER_CONFIG.relearningSteps] });
}

/** The subset of card state we compare across devices. */
export interface CardSnapshot {
  state: number;
  reps: number;
  lapses: number;
  stability: number;
  difficulty: number;
  dueAt: string;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function snapshot(card: Card): CardSnapshot {
  return {
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    stability: r6(card.stability),
    difficulty: r6(card.difficulty),
    dueAt: new Date(card.dueAt).toISOString(),
  };
}
