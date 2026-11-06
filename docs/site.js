// Все внешние адреса сайта – только здесь. Остальная страница берёт их отсюда.
const CONFIG = {
  // Владелец/имя репозитория на GitHub. ПРЕДПОЛОЖЕНИЕ: поправить, когда репозиторий появится.
  REPO: 'Forecastych/DeskPartner',
  // Ссылка на Google Форму отзывов, вида https://docs.google.com/forms/d/e/.../viewform?embedded=true
  // Пока пусто – на странице заглушка «форма скоро появится». Как получить ссылку – docs/FORM.md.
  FORM_URL: '',
};

const gh = `https://github.com/${CONFIG.REPO}`;
const LINKS = {
  repo: gh,
  download: `${gh}/releases/latest`,
  issues: `${gh}/issues/new/choose`,
  license: `${gh}/blob/main/LICENSE`,
};

for (const a of document.querySelectorAll('a[data-link]')) {
  const href = LINKS[a.dataset.link];
  if (href) a.href = href;
}

// Форма: встраиваем только настоящую Google Форму и всегда в режиме embedded
function formSrc(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/forms/')) {
    return null;
  }
  url.searchParams.set('embedded', 'true');
  return url.href;
}

const src = formSrc(CONFIG.FORM_URL.trim());
if (src) {
  const box = document.getElementById('form');
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = 'Форма отзыва';
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  box.replaceChildren(frame);
  box.classList.add('has-form');
}
