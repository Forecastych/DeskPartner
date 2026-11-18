const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (phone) {
  document.documentElement.dataset.phone = '';
  const share = document.getElementById('share');
  const address = document.getElementById('gift-url');
  const status = document.getElementById('share-status');
  if (navigator.share || navigator.clipboard?.writeText) {
    share.hidden = false;
    if (!navigator.share) share.textContent = 'Скопировать ссылку';
    share.addEventListener('click', async () => {
      try {
        if (navigator.share) {
          await navigator.share({ title: document.title, url: address.value });
        } else {
          await navigator.clipboard.writeText(address.value);
          status.textContent = 'Ссылка скопирована.';
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          address.focus();
          address.select();
          status.textContent = 'Скопируйте ссылку из поля.';
        }
      }
    });
  }
}
