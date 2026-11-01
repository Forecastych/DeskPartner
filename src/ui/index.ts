// Пиксельный уютный вид всех диалоговых окон: первый запуск, настройки, меню питомца и всё,
// что появится потом. Новое окно делается так:
//
//   1. В Rust окно строится без системной рамки: .decorations(false).shadow(true). Метку окна
//      добавить в capabilities/setup.json (или в свой файл) с правами
//      core:window:allow-start-dragging, allow-minimize, allow-close — их зовёт полоса заголовка.
//   2. Компонент окна берёт всё отсюда: `import { Dialog, Button, Check } from './ui'`.
//      Корень — <Dialog title="…">: полоса заголовка с лапкой, «свернуть» и «закрыть», шапка
//      (snippet header), прокрутка (содержимое) и кнопки внизу (snippet footer). Нужна форма с
//      Enter — передать onsubmit, корнем станет <form>.
//   3. Внутри — Section (раздел с h2), Group (fieldset с подписью), Check, Radio, TextInput,
//      Button, Hint. Своё оформление окна — в его <style> на токенах --ui-* из tokens.css,
//      без новых цветов и размеров «на глаз».
//
// Глобальных стилей здесь нет: CSS у всех окон один, а питомец должен остаться прозрачным.
// Пиксельная рамка — класс .ui-px (цвет контура --edge, тени --drop, высота тени --lift),
// моноширинный текст для путей и ключей — .ui-mono, текст только для диктора — .ui-sr.
import './tokens.css';

export { default as Button } from './Button.svelte';
export { default as Check } from './Check.svelte';
export { default as Dialog } from './Dialog.svelte';
export { default as Group } from './Group.svelte';
export { default as Hint } from './Hint.svelte';
export { default as Icon } from './Icon.svelte';
export { default as Radio } from './Radio.svelte';
export { default as Section } from './Section.svelte';
export { default as TextInput } from './TextInput.svelte';
export { ICONS, type IconName } from './pixels';
