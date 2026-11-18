<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { t } from './lib/i18n';
  import { Button, Dialog, Hint, Section } from './ui';

  const win = getCurrentWindow();
  const hasReleaseNotes = win.label === 'whats-new';
  let notes = $state(hasReleaseNotes);
</script>

<Dialog title={notes ? t('Что нового', "What's new") : t('Быстрый гайд', 'Quick guide')} minimizable={false}>
  {#if notes}
    <Section title={t('Что нового в DeskPartner 1.1.1', "What's new in DeskPartner 1.1.1")}>
      <ul class="updates">
        <li>{t('Масштаб кошки и предметов можно менять в настройках.', 'You can change the size of the cat and her items in Settings.')}</li>
        <li>{t('Shift помогает подхватить кошку на ходу. Кошка остаётся над панелью задач, когда открыт «Пуск».', 'Hold Shift to pick up the cat while she moves. She stays above the taskbar when Start is open.')}</li>
        <li>{t('Кошка прячется в полноэкранных играх. Автозапуск можно включить в настройках.', 'The cat hides during fullscreen games. You can turn on startup at sign-in in Settings.')}</li>
        <li>{t('Новости по выбранным темам чаще попадают в обычные реплики.', 'News from your chosen topics now appears in regular speech bubbles.')}</li>
        <li>{t('Длину фокуса можно выбрать от минуты до трёх часов. Мышку-трофей можно спрятать или вернуть.', 'Set a focus timer from one minute to three hours. Hide or show the trophy mouse from Stats.')}</li>
      </ul>
      <Hint>{t('Гайд можно снова открыть в настройках.', 'You can reopen this guide from Settings.')}</Hint>
    </Section>
  {:else}
    <Section title={t('Управление', 'Controls')}>
      <dl>
        <dt>{t('ПКМ', 'Right-click')}</dt><dd>{t('Меню кошки или значка в трее', 'Open the cat or tray menu')}</dd>
        <dt>{t('Shift + ЛКМ', 'Shift + drag')}</dt><dd>{t('Подхватить кошку на ходу и перетащить', 'Pick up and move the cat while she walks')}</dd>
        <dt>{t('Alt + клик', 'Alt + click')}</dt><dd>{t('Кликнуть сквозь кошку', 'Click through the cat')}</dd>
        <dt>Ctrl / Esc</dt><dd>{t('Удерживать Ctrl для лазера, нажать Esc, чтобы выключить', 'Hold Ctrl for the laser, press Esc to turn it off')}</dd>
        <dt>Ctrl + Alt + H</dt><dd>{t('Спрятать или вернуть питомца и предметы', 'Hide or show the pet and items')}</dd>
      </dl>
    </Section>
    <Section title={t('Где что найти', 'Where to find things')} rule>
      <ul class="updates">
        <li>{t('Настройки в трее — масштаб, темы новостей, разговорчивость и автозапуск.', 'Settings in the tray has size, news topics, chat frequency and startup.')}</li>
        <li>{t('«Расскажи новость» в меню кошки — новость по выбранным темам по запросу.', 'Choose “Tell me some news” in the cat menu to ask for a headline from your topics.')}</li>
        <li>{t('Фокус в меню или трее — таймер для работы. В статистике — дневник и наряды.', 'Use the cat or tray menu for the focus timer. Find the diary and outfits in Stats.')}</li>
      </ul>
    </Section>
  {/if}

  {#snippet footer()}
    {#if hasReleaseNotes}
      <Button onclick={() => (notes = !notes)}>
        {notes ? t('Хоткеи и функции', 'Shortcuts and features') : t('Что нового', "What's new")}
      </Button>
    {/if}
    <Button variant="primary" onclick={() => win.close().catch(console.error)}>{t('Готово', 'Done')}</Button>
  {/snippet}
</Dialog>

<style>
  .updates {
    margin: 0;
    padding-left: 1.2rem;
  }
  .updates li + li { margin-top: var(--ui-s2); }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--ui-s2) var(--ui-s3);
    margin: 0;
  }
  dt { font-family: var(--ui-mono); font-weight: 700; }
  dd { margin: 0; }
</style>
