/**
 * Отзывы без ключа: что известно о фильме (его скачивает Rust, команда film_reviews — оценки
 * из Wikidata и раздел об отзывах из Википедии) → скучный ли он. На скучном кошка засыпает раньше
 * («Кино вместе» в плане).
 *
 * Средняя оценка говорит больше всего. Слова «затянуто», «скучно» в разделе об отзывах решают,
 * только если оценка не высокая: у хвалёного фильма критик тоже может поворчать на хронометраж.
 * Текст раздела в облачко не идёт — только счёт слов, поэтому подпись CC BY-SA здесь не нужна.
 */

/** Ответ film_reviews; null — такого фильма Wikidata не знает. */
export interface Film {
  label: string;
  /** Оценки критиков и зрителей, приведённые к 0..1. */
  scores: number[];
  /** Язык раздела об отзывах: 'ru', 'en' или '', если раздела нет. */
  lang: string;
  reception: string;
}

export type Verdict = 'dull' | 'fine' | 'unknown';

/** Ниже — скучный, что бы ни писали. 0.55 — это 5.5 из 10 у зрителей, 55% у критиков. */
export const LOW = 0.55;
/** Выше — хороший, даже если кто-то назвал его затянутым. */
export const GOOD = 0.7;
/** Столько «скучных» слов в разделе — уже не случайность одного критика. */
export const DULL_WORDS = 2;

/** Основа слова с начала слова, как в wiki.ts: «скучн» ловит «скучный», но не «наскучн». */
const stems = (...list: string[]) => new RegExp(`(?:^|[^\\p{L}])(?:${list.join('|')})`, 'giu');

const DULL: Record<string, RegExp> = {
  ru: stems('затянут', 'растянут', 'затяжн', 'скучн', 'скука', 'нудн', 'занудн', 'утомит', 'монотонн', 'вял', 'тягомот'),
  en: stems('overlong', 'tedious', 'boring', 'bored', 'dull', 'plodding', 'sluggish', 'slow-paced', 'bloated', 'meandering', 'tiresome', 'interminable'),
};

/** Сколько раз в разделе об отзывах фильм назвали скучным или затянутым. */
export function dullWords(f: Film): number {
  const re = DULL[f.lang];
  return re ? (f.reception.match(re)?.length ?? 0) : 0;
}

/** Средняя оценка или null, если оценок нет. */
export function average(scores: readonly number[]): number | null {
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

export function verdict(f: Film | null): Verdict {
  if (!f) return 'unknown';
  const avg = average(f.scores);
  if (avg !== null && avg < LOW) return 'dull';
  if (dullWords(f) >= DULL_WORDS && (avg === null || avg < GOOD)) return 'dull';
  return avg === null && !f.reception ? 'unknown' : 'fine';
}
