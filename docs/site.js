// Все внешние адреса сайта – только здесь. Остальная страница берёт их отсюда.
const CONFIG = {
  // Владелец/имя репозитория на GitHub. ПРЕДПОЛОЖЕНИЕ: поправить, когда репозиторий появится.
  REPO: 'Forecastych/DeskPartner',
  // Google Форма отзывов «DeskPartner feedback». Пустая строка – на странице заглушка
  // «форма скоро появится». Как получить ссылку – docs/FORM.md.
  FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLScPQ4Ev1Kb2O0BNKfnxvDiSIq8gd5M6oQsoTsA054a6erONsA/viewform?embedded=true',
};

const gh = `https://github.com/${CONFIG.REPO}`;
const LINKS = {
  repo: gh,
  download: `${gh}/releases/latest`,
  issues: `${gh}/issues/new/choose`,
  license: `${gh}/blob/main/LICENSE`,
};

// Русский текст по ключам data-t; английский лежит в самой разметке.
// Внутри только своя разметка (<b>, <br>, <a data-link>), поэтому innerHTML.
const RU = {
  title: 'DeskPartner – пиксельная кошка для рабочего стола',
  description: 'Пиксельная кошка для рабочего стола Windows: живёт на краях экрана и рамках окон и не мешает работать.',
  bar: 'Пиксельный питомец',
  catAlt: 'Пиксельная серая кошка сидит и машет хвостом',
  lead: 'Пиксельная кошка для рабочего стола Windows. Живёт на краях экрана и рамках окон и не мешает работать.',
  intro: 'Гуляет по окнам, ест, спит и обижается, если её будить. Смотрит с вами кино, а на созвонах прячется. Гоняется за пиксельной мышью и играет с клубком.',
  download: 'Скачать',
  free: 'Windows 10 и 11 · бесплатно для некоммерческого использования',
  does: 'Что она делает',
  eat: 'Ест',
  eatText: 'Проголодается – ждёт у миски. Не покормите – уйдёт искать еду сама.',
  sleep: 'Спит',
  sleepText: 'Устала – сворачивается калачиком. Отошли от компьютера – уснёт сразу.',
  sulk: 'Обижается',
  sulkText: 'Разбудили недоспавшую – сначала вялая, потом шипит, а там и уйдёт за край экрана.',
  film: 'Смотрит кино',
  filmText: 'Включили фильм – садится в угол и смотрит с вами. На созвонах прячется.',
  hunt: 'Охотится',
  huntText: 'По окнам бегает нарисованная мышь, кошка гонится за ней до самого края экрана.',
  yarn: 'Играет с клубком',
  yarnText: 'Иногда выкатывает клубок из-за края экрана и гоняет его по полу.',
  privacy: 'Приватность',
  frames: 'Видит только рамки окон, <b>заголовки и содержимое не читает</b>.',
  calls: 'О созвоне узнаёт по занятому микрофону или камере, но <b>звук не записывает</b>.',
  net: 'Из ваших данных в сеть уходят <b>только дата и язык</b>. Ни счётчиков, ни аналитики – и на этом сайте тоже.',
  reviews: 'Отзывы',
  ask: 'Что понравилось, что мешает, чего не хватает – напишите, это читают. Аккаунт не нужен.',
  soon: '<b>Форма скоро появится.</b><br>А пока кошка просто ждёт, когда её погладят.',
  bug: 'Нашли баг? Есть аккаунт GitHub – <a data-link="issues">напишите в Issues</a>.',
  foot: 'DeskPartner · автор Forecastych · <a data-link="license">лицензия PolyForm Noncommercial 1.0.0</a> · <a data-link="repo">исходники на GitHub</a>',
  formTitle: 'Форма отзыва',
};

const meta = document.querySelector('meta[name="description"]');
// английский оригинал каждого места запоминаем, чтобы переключение работало в обе стороны
const EN = {
  title: document.title,
  description: meta.content,
  formTitle: 'Feedback form',
};
for (const el of document.querySelectorAll('[data-t]')) EN[el.dataset.t] = el.innerHTML;
for (const el of document.querySelectorAll('[data-t-alt]')) EN[el.dataset.tAlt] = el.alt;

const KEY = 'lang';

// ?lang=ru в адресе, потом прошлый выбор, потом язык браузера
function initial() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'ru' || asked === 'en') return asked;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    // без хранилища (приватный режим) просто не помним выбор
  }
  const first = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return first.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

let lang = initial();
const text = (key) => (lang === 'ru' ? RU : EN)[key];

function links() {
  for (const a of document.querySelectorAll('a[data-link]')) {
    const href = LINKS[a.dataset.link];
    if (href) a.href = href;
  }
}

function render() {
  document.documentElement.lang = lang;
  document.title = text('title');
  meta.content = text('description');
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = text(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-alt]')) el.alt = text(el.dataset.tAlt);
  const frame = document.querySelector('#form iframe');
  if (frame) frame.title = text('formTitle');
  for (const b of document.querySelectorAll('button[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  // ссылки внутри переведённых мест пересоздаются вместе с текстом
  links();
}

for (const b of document.querySelectorAll('button[data-lang]')) {
  b.addEventListener('click', () => {
    lang = b.dataset.lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // см. initial()
    }
    render();
  });
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
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  box.replaceChildren(frame);
  box.classList.add('has-form');
}

render();
