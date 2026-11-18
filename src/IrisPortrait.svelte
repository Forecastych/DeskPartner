<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { t } from './lib/i18n';
  import { Button, Check, Dialog } from './ui';

  const win = getCurrentWebviewWindow();
  const thumbnail = win.label === 'iris-frame';
  const caption = t('Макросъёмка — IRIS', 'Macro photography by IRIS');
  let picker = $state<HTMLInputElement>();
  let photo = $state('');
  let busy = $state(false);
  let error = $state('');
  let frameEnabled = $state<boolean | null>(null);
  let disposed = false;

  function setPhoto(blob: Blob | null) {
    if (photo) URL.revokeObjectURL(photo);
    photo = blob ? URL.createObjectURL(blob) : '';
  }

  async function refreshPhoto() {
    try {
      const bytes = await invoke<ArrayBuffer>('iris_portrait');
      if (!disposed) setPhoto(bytes.byteLength ? new Blob([bytes], { type: 'image/jpeg' }) : null);
    } catch {
      error = t('Не удалось открыть снимок.', 'Could not open the photo.');
    }
  }

  async function selectPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    busy = true;
    error = '';
    try {
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if ((!png && !jpeg) || file.size > 40 * 1024 * 1024) {
        error = t('Выбери PNG или JPEG размером до 40 МБ.', 'Choose a PNG or JPEG up to 40 MB.');
        return;
      }
      const image = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      try {
        const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d', { alpha: false })!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        image.close();
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
      if (!blob) throw new Error('JPEG encoding failed');
      await invoke('save_iris_portrait', new Uint8Array(await blob.arrayBuffer()));
      if (!disposed) setPhoto(blob);
      await emitTo('pet', 'iris-photo-saved');
    } catch {
      error = t('Не удалось сохранить снимок. Попробуй другой файл PNG или JPEG.', 'Could not save the photo. Try another PNG or JPEG.');
    } finally {
      busy = false;
    }
  }

  async function removePhoto() {
    busy = true;
    error = '';
    try {
      await invoke('remove_iris_portrait');
      setPhoto(null);
      await emitTo('pet', 'iris-photo-removed');
    } catch {
      error = t('Не удалось убрать снимок.', 'Could not remove the photo.');
    } finally {
      busy = false;
    }
  }

  async function toggleFrame(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || busy) return;
    const enabled = target.checked;
    busy = true;
    error = '';
    try {
      await invoke('set_iris_frame_enabled', { enabled });
      frameEnabled = enabled;
    } catch {
      target.checked = !enabled;
      error = t('Не удалось изменить видимость рамки.', 'Could not change frame visibility.');
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    const off = thumbnail ? win.listen('iris-photo-changed', refreshPhoto) : null;
    if (off) void off.then(refreshPhoto, refreshPhoto);
    else {
      void refreshPhoto();
      void invoke<boolean>('iris_frame_enabled').then((enabled) => { frameEnabled = enabled; }).catch(console.error);
    }
    return () => {
      disposed = true;
      if (photo) URL.revokeObjectURL(photo);
      void off?.then((unlisten) => unlisten());
    };
  });
</script>

{#if thumbnail}
  <button class="frame" type="button" title={caption} aria-label={t('Открыть портрет от IRIS', 'Open portrait from IRIS')} onclick={() => invoke('show_iris_portrait').catch(console.error)}>
    {#if photo}<img src={photo} alt="" />{/if}
  </button>
{:else}
  <Dialog title={t('Портрет от IRIS', 'Portrait from IRIS')} {busy}>
    {#if photo}
      <figure>
        <img src={photo} alt={t('Снимок с фотосессии IRIS', 'Your photo from the IRIS session')} />
        <figcaption>
          <Button variant="link" onclick={() => invoke('open_iris_studio').catch(() => {
            error = t('Не удалось открыть сайт студии.', 'Could not open the studio website.');
          })}>{caption}</Button>
        </figcaption>
      </figure>
      <div onchange={toggleFrame}>
        <Check checked={frameEnabled ?? false} disabled={busy || frameEnabled === null}>
          {t('Оставить рамку на экране', 'Keep frame on the desktop')}
        </Check>
      </div>
    {:else}
      <p>{t('Выбери снимок с фотосессии, и питомец поставит его в рамку. Копия снимка хранится на этом ПК.', 'Choose a photo from your session and your pet will frame it. A copy stays on this PC.')}</p>
    {/if}
    {#if error}<p role="alert">{error}</p>{/if}
    <input bind:this={picker} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onchange={selectPhoto} />
    {#snippet footer()}
      <Button variant="primary" disabled={busy} onclick={() => picker?.click()}>
        {photo ? t('Заменить фото', 'Replace photo') : t('Выбрать фото', 'Choose a photo')}
      </Button>
      {#if photo}<Button disabled={busy} onclick={removePhoto}>{t('Убрать фото', 'Remove photo')}</Button>{/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .frame {
    display: block;
    width: 100vw;
    height: 100vh;
    padding: 4px;
    border: 3px solid var(--ui-ink);
    background: var(--ui-accent);
    box-shadow: inset 0 3px var(--ui-accent-hi), inset 0 -3px var(--ui-accent-lo);
    cursor: pointer;
  }
  .frame img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
    background: var(--ui-ink);
  }
  figure {
    display: grid;
    gap: 8px;
    margin: 16px 0 8px;
    text-align: center;
    color: var(--ui-muted);
  }
  figure img {
    display: block;
    max-width: 100%;
    max-height: calc(100vh - 125px);
    margin-inline: auto;
    border: 3px solid var(--ui-ink);
  }
</style>
