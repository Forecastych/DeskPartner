import { describe, expect, it } from 'vitest';
import { appFolderFor, driveOf, errorText, isDriveRoot } from './setup';

describe('isDriveRoot', () => {
  it('узнаёт корень в любом написании', () => {
    for (const p of ['D:', 'D:\\', 'd:/', ' E:\\ ']) expect(isDriveRoot(p)).toBe(true);
  });
  it('обычная папка — не корень', () => {
    for (const p of ['D:\\Games', 'C:\\Users\\vlad', '', '\\\\server\\share', 'DD:\\']) expect(isDriveRoot(p)).toBe(false);
  });
});

describe('appFolderFor', () => {
  it('к корню диска добавляет папку программы', () => {
    expect(appFolderFor('d:\\')).toBe('D:\\DeskPartner');
    expect(appFolderFor('E:')).toBe('E:\\DeskPartner');
  });
  it('выбранную папку не трогает', () => {
    expect(appFolderFor('D:\\Мои\\Питомец')).toBeNull();
  });
});

describe('driveOf', () => {
  it('достаёт букву диска', () => {
    expect(driveOf('d:\\DeskPartner')).toBe('D:');
    expect(driveOf('C:\\Users\\vlad\\DeskPartner')).toBe('C:');
  });
  it('без буквы — null', () => {
    expect(driveOf('\\\\server\\share')).toBeNull();
    expect(driveOf('')).toBeNull();
  });
});

describe('errorText', () => {
  it('строку от Rust отдаёт как есть', () => {
    expect(errorText('В эту папку нельзя писать')).toBe('В эту папку нельзя писать');
  });
  it('у Error берёт сообщение', () => {
    expect(errorText(new Error('нет Tauri'))).toBe('нет Tauri');
  });
  it('прочее — общей фразой', () => {
    for (const e of [undefined, null, {}, '', '  ', new Error('')]) expect(errorText(e)).toMatch(/не так/);
  });
});
