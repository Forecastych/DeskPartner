// Мелочи окна первого запуска, вынесенные из компонента, чтобы их можно было проверить тестами.

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
 * Текст ошибки для человека. Rust отдаёт строку по-русски; всё прочее (нет Tauri, упал плагин)
 * сводим к сообщению, а не к «[object Object]».
 */
export function errorText(e: unknown): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return 'Что-то пошло не так. Попробуй ещё раз.';
}
