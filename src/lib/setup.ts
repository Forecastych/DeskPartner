// Мелочи окон первого запуска и настроек, вынесенные из компонентов, чтобы их можно было проверить тестами.

/** Имя папки, которую предлагаем создать, если человек выбрал корень диска. */
export const APP_FOLDER = 'DeskPartner';

/** «D:», «D:\» или «D:/» — корень диска. Сыпать файлы прямо в корень неряшливо. */
export function isDriveRoot(path: string): boolean {
  return /^[a-z]:[\\/]?$/i.test(path.trim());
}

/** Для корня диска — `X:\DeskPartner`, для обычной папки — null: её человек выбрал сам. */
export function appFolderFor(path: string): string | null {
  if (!isDriveRoot(path)) return null;
  return `${path.trim().slice(0, 2).toUpperCase()}\\${APP_FOLDER}`;
}

/** Буква диска в виде «D:», если путь с неё начинается. */
export function driveOf(path: string): string | null {
  const m = /^([a-z]):/i.exec(path.trim());
  return m ? `${m[1].toUpperCase()}:` : null;
}

/**
 * Выбор папки: корень диска заменяем подпапкой, если человек от неё ещё не отказался (`keepRoot`).
 * `root` — корень, вместо которого подставили подпапку: его показываем, чтобы можно было отказаться.
 */
export function pickDir(path: string, keepRoot: string | null): { dir: string; root: string | null } {
  const sub = path !== keepRoot ? appFolderFor(path) : null;
  return { dir: sub ?? path, root: sub ? path.trim() : null };
}

/** Подпись к предложенной папке. Последняя у Rust — всегда папка пользователя на системном диске. */
export function dirHint(i: number, count: number, path: string): string {
  if (i === count - 1) return 'в папке пользователя, на системном диске';
  const d = driveOf(path);
  return d ? `отдельный диск ${d}` : 'отдельный диск';
}

/**
 * Тот же ли это путь с точностью до регистра и слэшей. Только по тексту: настоящую сверку
 * (`..`, ссылки) делает Rust, а здесь — чтобы не перезапускать питомца ради той же папки.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * Текст ошибки для человека. Rust отдаёт строку по-русски; всё прочее (нет Tauri, упал плагин)
 * сводим к сообщению, а не к «[object Object]».
 */
export function errorText(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return 'Что-то пошло не так. Попробуй ещё раз.';
}
