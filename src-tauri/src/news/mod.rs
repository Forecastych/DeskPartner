//! Новости по увлечениям: «Пишут: …» в облачке кошки.
//!
//! Фоновый поток раз в несколько часов качает публичные RSS/Atom-ленты выбранных тем
//! (список — feeds.rs), берёт из записей только заголовок, ссылку и дату, отсеивает
//! тяжёлое, рекламу и кликбейт (filter.rs) и копит свежее в `news.json` в папке данных.
//! Фронт берёт по одной новости командой `news_pick`; лайк/диз под новостью (`news_vote`)
//! делает источник чаще или реже; настройки показывают статус лент (`news_status`).
//!
//! Приватность: наружу уходят только GET к адресам лент — без куки, без идентификаторов,
//! темы пользователя в запросы не попадают (ленты качаются целиком, выбор — локально).
//! Нет сети — новостей просто нет, без ошибок.

mod feeds;
mod filter;
mod parse;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use feeds::{Feed, FEEDS, TOPICS};
use parse::Entry;

/// Лента, скачанная успешно, — снова не раньше чем через 2,5 часа.
const TTL_OK: i64 = 150 * 60;
/// Не скачалась — повторить через полчаса.
const TTL_FAIL: i64 = 30 * 60;
/// Новости старше трёх дней кошке неинтересны.
const MAX_AGE: i64 = 3 * 24 * 3600;
/// Сколько новостей держать на тему.
const PER_TOPIC: usize = 30;
/// Как часто поток проверяет сроки лент.
const TICK: Duration = Duration::from_secs(10 * 60);
const TIMEOUT: Duration = Duration::from_secs(20);
/// Самая тяжёлая из лент весит ~700 КБ; больше 4 МБ — это уже не лента.
const BODY_LIMIT: u64 = 4 * 1024 * 1024;
const USER_AGENT: &str = concat!("DeskPartner/", env!("CARGO_PKG_VERSION"));
const FILE: &str = "news.json";
/// «Больше такого» умножает вес источника, «меньше» делит; ноль нельзя — источник просто реже.
const VOTE_UP: f64 = 1.5;
const VOTE_DOWN: f64 = 0.5;
const VOTE_MIN: f64 = 0.25;
const VOTE_MAX: f64 = 4.0;
/// Русский источник весит вчетверо: английские добирают, когда русских нет или их не любят.
const RU_BONUS: f64 = 4.0;
/// «Обновить сейчас» не качает ленту чаще раза в 5 минут.
const REFRESH_GAP: i64 = 5 * 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewsItem {
    pub topic: String,
    pub title: String,
    pub link: String,
    /// Короткое имя источника: «Чемпионат», «N + 1».
    pub source: String,
    /// "ru" или "en".
    pub lang: String,
    /// Unix-время публикации, секунды.
    pub date: i64,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(default)]
struct Cache {
    /// Выбранные темы — только локально, чтобы при старте сразу знать, что качать.
    topics: Vec<String>,
    /// Когда ленту можно качать снова: url -> unix-время.
    next: BTreeMap<String, i64>,
    items: Vec<NewsItem>,
    /// Уже показанные ссылки -> когда показали.
    shown: BTreeMap<String, i64>,
    /// Голоса «больше/меньше такого»: источник -> вес; нет записи — 1.
    sources: BTreeMap<String, f64>,
    /// Последняя попытка скачать ленту: url -> когда и удачно ли. Для статуса в настройках.
    fetched: BTreeMap<String, Fetched>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
struct Fetched {
    at: i64,
    ok: bool,
}

/// Строка статуса лент в настройках: одна на адрес, общая лента — одна на все свои темы.
#[derive(Serialize, Debug, PartialEq)]
pub struct FeedStatus {
    source: String,
    lang: String,
    topics: Vec<String>,
    /// Последняя попытка: когда и удачно ли; `None` — ещё не качалась.
    at: Option<i64>,
    ok: Option<bool>,
    /// Когда снова; `None` — при первом же проходе потока.
    next: Option<i64>,
    /// Сколько новостей источника по этим темам лежит в кэше.
    items: usize,
    /// Вес источника по голосам: больше 1 — чаще, меньше — реже.
    weight: f64,
}

#[derive(Serialize, Debug)]
pub struct NewsStatus {
    /// Поток прямо сейчас качает ленты.
    busy: bool,
    now: i64,
    feeds: Vec<FeedStatus>,
}

/// Ленты выбранных тем, у которых подошёл срок. Общая лента — один раз на всех.
fn due(cache: &Cache, now: i64) -> Vec<&'static str> {
    let mut seen = HashSet::new();
    FEEDS
        .iter()
        .filter(|f| cache.topics.iter().any(|t| t == f.topic))
        .map(|f| f.url)
        .filter(|url| seen.insert(*url))
        .filter(|url| cache.next.get(*url).is_none_or(|t| *t <= now))
        .collect()
}

/// Разложить записи скачанной ленты по выбранным темам. `None` — ленту скачать не удалось.
fn merge(cache: &mut Cache, url: &str, entries: Option<&[Entry]>, now: i64) {
    let ttl = if entries.is_some() { TTL_OK } else { TTL_FAIL };
    cache.next.insert(url.to_owned(), now + ttl);
    cache.fetched.insert(url.to_owned(), Fetched { at: now, ok: entries.is_some() });
    let Some(entries) = entries else { return };
    let feeds: Vec<&Feed> =
        FEEDS.iter().filter(|f| f.url == url && cache.topics.iter().any(|t| t == f.topic)).collect();
    for feed in feeds {
        for e in entries {
            if !filter::ok(&e.title) || (feed.words && !filter::fits(&e.title, feeds::topic_words(feed.topic))) {
                continue;
            }
            // без даты — считаем, что вышла сейчас; дата из будущего — тоже сейчас
            let date = e.date.unwrap_or(now).min(now);
            let dup = cache.items.iter().any(|i| i.topic == feed.topic && i.link == e.link);
            if now - date > MAX_AGE || dup {
                continue;
            }
            cache.items.push(NewsItem {
                topic: feed.topic.to_owned(),
                title: e.title.clone(),
                link: e.link.clone(),
                source: feed.source.to_owned(),
                lang: feed.lang.to_owned(),
                date,
            });
        }
    }
    prune(cache, now);
}

/// Выкинуть старое и лишнее: возраст, лимит на тему, невыбранные темы, забытые сроки.
fn prune(cache: &mut Cache, now: i64) {
    let topics = &cache.topics;
    cache.items.retain(|i| now - i.date <= MAX_AGE && topics.contains(&i.topic));
    // под лимит первыми попадают русские, из них — свежие: так же, как их выбирает pick
    cache.items.sort_by_key(|i| (i.lang != "ru", -i.date));
    let mut per: BTreeMap<String, usize> = BTreeMap::new();
    cache.items.retain(|i| {
        let n = per.entry(i.topic.clone()).or_default();
        *n += 1;
        *n <= PER_TOPIC
    });
    let chosen = |url: &String| FEEDS.iter().any(|f| f.url == url && topics.iter().any(|t| t == f.topic));
    cache.next.retain(|url, _| chosen(url));
    cache.fetched.retain(|url, _| chosen(url));
    // запись не старше показа, а старше трёх дней в кэш не попадает — дольше помнить незачем
    cache.shown.retain(|_, t| now - *t <= MAX_AGE);
}

/// Оставить известные темы в порядке settings.ts. true — набор изменился.
fn set_topics(cache: &mut Cache, topics: &[String], now: i64) -> bool {
    let known: Vec<String> =
        TOPICS.iter().filter(|t| topics.iter().any(|x| x == *t)).map(|t| (*t).to_owned()).collect();
    if known == cache.topics {
        return false;
    }
    cache.topics = known;
    prune(cache, now);
    true
}

/// Новость для облачка. Тема — случайная по весам `topic_w` (их ведёт chatter) из тех, где
/// есть непоказанное; источник — случайный по голосам, русские с бонусом; от источника —
/// его самая свежая (у одного источника сначала русские). Выбранная запоминается как показанная.
fn pick(cache: &mut Cache, now: i64, seed: u64, topic_w: &BTreeMap<String, f64>) -> Option<NewsItem> {
    let mut rng = seed;
    let fresh = |i: &&NewsItem| !cache.shown.contains_key(&i.link);
    let topics: Vec<(&String, f64)> = cache
        .topics
        .iter()
        .filter(|t| cache.items.iter().filter(fresh).any(|i| &i.topic == *t))
        .map(|t| (t, weight(topic_w, t)))
        .collect();
    let topic = draw(&topics, &mut rng)?;
    let mut best: BTreeMap<&str, &NewsItem> = BTreeMap::new();
    for i in cache.items.iter().filter(fresh).filter(|i| &i.topic == topic) {
        let b = best.entry(&i.source).or_insert(i);
        if (i.lang != "ru", -i.date) < (b.lang != "ru", -b.date) {
            *b = i;
        }
    }
    let bonus = |i: &NewsItem| if i.lang == "ru" { RU_BONUS } else { 1.0 };
    let sources: Vec<(&NewsItem, f64)> =
        best.values().map(|i| (*i, weight(&cache.sources, &i.source) * bonus(i))).collect();
    let item = draw(&sources, &mut rng)?.clone();
    cache.shown.insert(item.link.clone(), now);
    Some(item)
}

/// Вес из таблицы голосов в пределах; нет записи или мусор — 1.
fn weight(w: &BTreeMap<String, f64>, key: &str) -> f64 {
    w.get(key).copied().filter(|v| v.is_finite() && *v > 0.0).unwrap_or(1.0).clamp(VOTE_MIN, VOTE_MAX)
}

/// Голос за источник: «больше такого» или «меньше».
fn vote(cache: &mut Cache, source: &str, up: bool) {
    let w = weight(&cache.sources, source) * if up { VOTE_UP } else { VOTE_DOWN };
    cache.sources.insert(source.to_owned(), w.clamp(VOTE_MIN, VOTE_MAX));
}

/// Случайный по весам. Случайность — splitmix64 от зерна, чтобы тесты задавали исход.
fn draw<T: Copy>(list: &[(T, f64)], rng: &mut u64) -> Option<T> {
    let total: f64 = list.iter().map(|(_, w)| w).sum();
    let mut r = next01(rng) * total;
    for (x, w) in list {
        if r < *w {
            return Some(*x);
        }
        r -= w;
    }
    list.last().map(|(x, _)| *x)
}

fn next01(s: &mut u64) -> f64 {
    *s = s.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *s;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// Статус лент выбранных тем — в порядке feeds.rs.
fn status(cache: &Cache) -> Vec<FeedStatus> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for f in FEEDS.iter().filter(|f| cache.topics.iter().any(|t| t == f.topic)) {
        if !seen.insert(f.url) {
            continue;
        }
        let topics: Vec<String> = FEEDS
            .iter()
            .filter(|g| g.url == f.url && cache.topics.iter().any(|t| t == g.topic))
            .map(|g| g.topic.to_owned())
            .collect();
        let last = cache.fetched.get(f.url);
        out.push(FeedStatus {
            source: f.source.to_owned(),
            lang: f.lang.to_owned(),
            items: cache.items.iter().filter(|i| i.source == f.source && topics.contains(&i.topic)).count(),
            topics,
            at: last.map(|l| l.at),
            ok: last.map(|l| l.ok),
            next: cache.next.get(f.url).copied(),
            weight: weight(&cache.sources, f.source),
        });
    }
    out
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn seed() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
}

// ---------- состояние и диск ----------

static STATE: Mutex<Option<Cache>> = Mutex::new(None);
/// Будильник потока: true — темы поменялись, пора качать, не дожидаясь срока.
static WAKE: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());
/// Поток сейчас качает — для статуса в настройках.
static BUSY: AtomicBool = AtomicBool::new(false);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn path() -> Option<PathBuf> {
    crate::store::data_dir().map(|d| PathBuf::from(d).join(FILE))
}

/// Кэш в памяти; при первом обращении — с диска. Папки данных нет — живём в памяти.
fn with_cache<R>(f: impl FnOnce(&mut Cache) -> R) -> R {
    let mut guard = lock(&STATE);
    let cache = guard.get_or_insert_with(|| {
        let mut c: Cache = path()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        prune(&mut c, now());
        c
    });
    f(cache)
}

/// Запись через временный файл: оборванная запись не портит прежний news.json.
fn save(cache: &Cache) {
    let Some(p) = path() else { return };
    let Ok(json) = serde_json::to_string(cache) else { return };
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, &p).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

// ---------- сеть ----------

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .user_agent(USER_AGENT)
        .accept("application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8")
        .https_only(true)
        .max_redirects(3)
        .build()
        .into()
}

/// Скачать и разобрать ленту. Любая ошибка — `None`.
fn fetch(agent: &ureq::Agent, url: &str) -> Option<Vec<Entry>> {
    let mut resp = agent.get(url).call().ok()?;
    let body = resp.body_mut().with_config().limit(BODY_LIMIT).read_to_vec().ok()?;
    let xml = String::from_utf8_lossy(&body);
    Some(parse::parse(xml.trim_start_matches('\u{feff}')))
}

/// Скачать ленты, у которых подошёл срок. Пока качаем, кэш не заперт.
fn refresh() {
    let urls = with_cache(|c| due(c, now()));
    if urls.is_empty() {
        return;
    }
    BUSY.store(true, Ordering::Relaxed);
    let agent = agent();
    for url in urls {
        let entries = fetch(&agent, url);
        with_cache(|c| merge(c, url, entries.as_deref(), now()));
    }
    with_cache(|c| save(c));
    BUSY.store(false, Ordering::Relaxed);
}

fn wake() {
    let (m, cv) = &WAKE;
    *lock(m) = true;
    cv.notify_one();
}

/// Фоновый поток: качает при старте, потом по сроку и при смене тем.
pub fn start() {
    let _ = std::thread::Builder::new().name("news".into()).spawn(|| loop {
        refresh();
        let (m, cv) = &WAKE;
        let mut woke = lock(m);
        if !*woke {
            woke = cv.wait_timeout(woke, TICK).map(|r| r.0).unwrap_or_else(|e| e.into_inner().0);
        }
        *woke = false;
    });
}

/// Запомнить темы; поменялись — сохранить и разбудить поток.
fn topics_changed(c: &mut Cache, topics: &[String], t: i64) -> bool {
    let changed = set_topics(c, topics, t);
    if changed {
        save(c);
    }
    changed
}

/// Новость для облачка по увлечениям пользователя или `None`, если рассказать нечего.
/// Темы запоминаются локально: по ним фоновый поток решает, какие ленты качать.
/// `weights` — веса тем из chatter: «больше такого» по теме.
#[tauri::command]
pub fn news_pick(topics: Vec<String>, weights: Option<BTreeMap<String, f64>>) -> Option<NewsItem> {
    let (item, changed) = with_cache(|c| {
        let t = now();
        let changed = topics_changed(c, &topics, t);
        let item = pick(c, t, seed(), &weights.unwrap_or_default());
        if item.is_some() {
            save(c);
        }
        (item, changed)
    });
    if changed {
        wake();
    }
    item
}

/// Темы поменялись в настройках — качать новые ленты сразу, не дожидаясь облачка.
#[tauri::command]
pub fn news_topics(topics: Vec<String>) {
    if with_cache(|c| topics_changed(c, &topics, now())) {
        wake();
    }
}

/// Лайк или диз на новость: источник станет чаще или реже.
#[tauri::command]
pub fn news_vote(source: String, up: bool) {
    with_cache(|c| {
        vote(c, &source, up);
        save(c);
    });
}

/// Статус лент для настроек.
#[tauri::command]
pub fn news_status() -> NewsStatus {
    let feeds = with_cache(|c| status(c));
    NewsStatus { busy: BUSY.load(Ordering::Relaxed), now: now(), feeds }
}

/// «Обновить сейчас»: снять сроки с лент, которые не трогали последние минуты, и разбудить поток.
#[tauri::command]
pub fn news_refresh() {
    with_cache(|c| force(c, now()));
    wake();
}

/// Сроки долой — кроме лент, скачанных только что: кнопку можно жать сколько угодно,
/// а сайт получит не больше запроса в REFRESH_GAP.
fn force(cache: &mut Cache, now: i64) {
    let fetched = &cache.fetched;
    cache.next.retain(|url, _| fetched.get(url).is_some_and(|f| now - f.at < REFRESH_GAP));
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_793_900_000;
    const KINONEWS: &str = "https://www.kinonews.ru/rss/";

    fn cache(topics: &[&str]) -> Cache {
        Cache { topics: topics.iter().map(|t| (*t).to_owned()).collect(), ..Default::default() }
    }

    fn entry(title: &str, link: &str, date: Option<i64>) -> Entry {
        Entry { title: title.into(), link: link.into(), date }
    }

    fn item(topic: &str, lang: &str, link: &str, date: i64) -> NewsItem {
        NewsItem {
            topic: topic.into(),
            title: format!("Заголовок новости про {topic}"),
            link: link.into(),
            source: "Тест".into(),
            lang: lang.into(),
            date,
        }
    }

    #[test]
    fn due_lists_feeds_of_chosen_topics_once() {
        let mut c = cache(&["кино", "сериалы"]);
        let urls = due(&c, NOW);
        assert_eq!(urls.iter().filter(|u| **u == KINONEWS).count(), 1, "общая лента — один раз");
        assert!(urls.contains(&"https://tvline.com/feed/"));
        assert!(!urls.iter().any(|u| u.contains("championat")), "футбол не выбран");
        assert!(due(&cache(&[]), NOW).is_empty(), "без тем — ни одного запроса");

        merge(&mut c, KINONEWS, Some(&[]), NOW);
        assert!(!due(&c, NOW).contains(&KINONEWS));
        assert!(!due(&c, NOW + TTL_OK - 1).contains(&KINONEWS));
        assert!(due(&c, NOW + TTL_OK).contains(&KINONEWS));

        merge(&mut c, KINONEWS, None, NOW);
        assert_eq!(c.next[KINONEWS], NOW + TTL_FAIL, "неудача — повтор раньше");
    }

    #[test]
    fn merge_filters_and_sorts_into_topics() {
        let mut c = cache(&["кино", "сериалы"]);
        let hour = 3600;
        let entries = [
            entry("Стартовали съёмки сериала о подвиге ополчения", "https://k/1", Some(NOW - hour)),
            entry("Ари Астер начал съёмки «Козла отпущения»", "https://k/2", Some(NOW - 2 * hour)),
            entry("Звезда комедии признан виновным в изнасиловании", "https://k/3", Some(NOW)),
            entry("Старая премьера недели в кинотеатрах страны", "https://k/4", Some(NOW - MAX_AGE - 1)),
            entry("Без даты: режиссёр показал первый кадр фильма", "https://k/5", None),
            entry("Из будущего: студия объявила дату премьеры", "https://k/6", Some(NOW + 9 * hour)),
        ];
        merge(&mut c, KINONEWS, Some(&entries), NOW);
        let links = |topic: &str| -> Vec<&str> {
            c.items.iter().filter(|i| i.topic == topic).map(|i| i.link.as_str()).collect()
        };
        assert_eq!(links("кино"), ["https://k/5", "https://k/6", "https://k/1", "https://k/2"]);
        assert_eq!(links("сериалы"), ["https://k/1"], "в сериалы — только со словами темы");
        assert!(c.items.iter().all(|i| i.date <= NOW));
        let it = c.items.iter().find(|i| i.link == "https://k/2").unwrap();
        assert_eq!((it.source.as_str(), it.lang.as_str()), ("KinoNews", "ru"));

        let before = c.items.len();
        merge(&mut c, KINONEWS, Some(&entries), NOW + 60);
        assert_eq!(c.items.len(), before, "повторная загрузка не плодит дублей");
    }

    #[test]
    fn prune_keeps_limit_age_and_topics() {
        let mut c = cache(&["футбол"]);
        for n in 0..40 {
            c.items.push(item("футбол", "ru", &format!("https://f/{n}"), NOW - n * 60));
        }
        c.items.push(item("футбол", "ru", "https://f/old", NOW - MAX_AGE - 1));
        c.items.push(item("футбол", "en", "https://f/en-newest", NOW + 1));
        c.items.push(item("хоккей", "ru", "https://h/1", NOW));
        c.next.insert("https://www.championat.com/rss/news/hockey/".into(), NOW);
        c.next.insert("https://www.championat.com/rss/news/football/".into(), NOW);
        c.shown.insert("https://f/0".into(), NOW - MAX_AGE - 1);
        c.shown.insert("https://f/1".into(), NOW);
        prune(&mut c, NOW);
        assert_eq!(c.items.len(), PER_TOPIC);
        assert_eq!(c.items[0].link, "https://f/0", "самые свежие остаются");
        assert!(c.items.iter().all(|i| i.topic == "футбол" && i.lang == "ru"), "русские важнее английских");
        assert_eq!(c.next.keys().collect::<Vec<_>>(), ["https://www.championat.com/rss/news/football/"]);
        assert_eq!(c.shown.keys().collect::<Vec<_>>(), ["https://f/1"]);
    }

    #[test]
    fn pick_prefers_russian_and_never_repeats() {
        let mut c = cache(&["аниме"]);
        c.items.push(item("аниме", "en", "https://a/en-new", NOW));
        c.items.push(item("аниме", "ru", "https://a/ru-old", NOW - 7200));
        c.items.push(item("аниме", "ru", "https://a/ru-new", NOW - 3600));
        // один источник — внутри него порядок строгий при любом зерне
        let none = BTreeMap::new();
        let order: Vec<String> = (0..3).map(|s| pick(&mut c, NOW, s, &none).unwrap().link).collect();
        assert_eq!(order, ["https://a/ru-new", "https://a/ru-old", "https://a/en-new"]);
        assert_eq!(pick(&mut c, NOW, 0, &none), None, "всё показано — молчим");
    }

    #[test]
    fn pick_skips_shared_links() {
        for seed in 0..20 {
            let mut c = cache(&["наука", "животные"]);
            c.items.push(item("наука", "ru", "https://n/whale", NOW));
            c.items.push(item("животные", "ru", "https://n/whale", NOW));
            c.items.push(item("наука", "ru", "https://n/atom", NOW - 60));
            let mut links: Vec<String> =
                std::iter::from_fn(|| pick(&mut c, NOW, seed, &BTreeMap::new())).map(|i| i.link).collect();
            links.sort();
            assert_eq!(links, ["https://n/atom", "https://n/whale"], "кит — один раз на обе темы");
        }
        assert_eq!(pick(&mut cache(&[]), NOW, 0, &BTreeMap::new()), None);
    }

    /// Сколько раз из 1000 зёрен первой выпадет новость источника `source`.
    fn wins(setup: impl Fn() -> Cache, topic_w: &BTreeMap<String, f64>, source: &str) -> usize {
        (0..1000).filter(|s| pick(&mut setup(), NOW, *s, topic_w).unwrap().source == source).count()
    }

    #[test]
    fn votes_shift_sources() {
        let two = |votes: &[(&str, bool)]| {
            let mut c = cache(&["космос"]);
            c.items.push(NewsItem { source: "Наш".into(), ..item("космос", "ru", "https://s/ru", NOW - 60) });
            c.items.push(NewsItem { source: "Их".into(), ..item("космос", "en", "https://s/en", NOW) });
            for (s, up) in votes {
                vote(&mut c, s, *up);
            }
            c
        };
        let none = BTreeMap::new();
        let ru = wins(|| two(&[]), &none, "Наш");
        assert!((750..850).contains(&ru), "русский вчетверо чаще: {ru}");
        let even = wins(|| two(&[("Наш", false), ("Наш", false)]), &none, "Наш");
        assert!((430..570).contains(&even), "два диза — наравне с английским: {even}");
        let liked = wins(|| two(&[("Их", true), ("Их", true), ("Их", true), ("Их", true)]), &none, "Их");
        assert!(liked > 400, "лайки поднимают английский: {liked}");

        let mut c = cache(&[]);
        for _ in 0..10 {
            vote(&mut c, "Шум", false);
        }
        assert_eq!(c.sources["Шум"], VOTE_MIN, "дизы не выключают источник совсем");
        for _ in 0..20 {
            vote(&mut c, "Шум", true);
        }
        assert_eq!(c.sources["Шум"], VOTE_MAX);
    }

    #[test]
    fn topic_weights_shift_topics() {
        let setup = || {
            let mut c = cache(&["космос", "кино"]);
            c.items.push(NewsItem { source: "Космос".into(), ..item("космос", "ru", "https://t/1", NOW) });
            c.items.push(NewsItem { source: "Кино".into(), ..item("кино", "ru", "https://t/2", NOW) });
            c
        };
        let even = wins(setup, &BTreeMap::new(), "Космос");
        assert!((430..570).contains(&even), "без весов — поровну: {even}");
        let w = BTreeMap::from([("космос".to_owned(), 4.0), ("кино".to_owned(), 0.25)]);
        assert!(wins(setup, &w, "Космос") > 900);
        let junk = BTreeMap::from([("космос".to_owned(), f64::NAN), ("кино".to_owned(), -3.0)]);
        assert!((430..570).contains(&wins(setup, &junk, "Космос")), "мусор в весах не ломает выбор");
    }

    #[test]
    fn status_groups_shared_feeds() {
        let mut c = cache(&["кино", "сериалы"]);
        assert!(status(&cache(&[])).is_empty());
        let kino = |c: &Cache| status(c).into_iter().find(|f| f.source == "KinoNews").unwrap();
        let fresh = kino(&c);
        assert_eq!(fresh.topics, ["кино", "сериалы"], "общая лента — одна строка на обе темы");
        assert_eq!((fresh.at, fresh.ok, fresh.next, fresh.items), (None, None, None, 0));

        let entries = [entry("Стартовали съёмки сериала о подвиге ополчения", "https://k/1", Some(NOW))];
        merge(&mut c, KINONEWS, Some(&entries), NOW);
        let ok = kino(&c);
        assert_eq!((ok.at, ok.ok, ok.next, ok.items), (Some(NOW), Some(true), Some(NOW + TTL_OK), 2));
        merge(&mut c, KINONEWS, None, NOW + 60);
        assert_eq!(kino(&c).ok, Some(false));
        assert_eq!(kino(&c).items, 2, "неудача не стирает накопленное");
        assert_eq!(status(&c).len(), due(&cache(&["кино", "сериалы"]), NOW).len(), "строка на каждую ленту");
    }

    #[test]
    fn refresh_button_respects_gap() {
        let mut c = cache(&["кино"]);
        merge(&mut c, KINONEWS, Some(&[]), NOW);
        force(&mut c, NOW + 60);
        assert!(!due(&c, NOW + 60).contains(&KINONEWS), "только что качали — не дёргаем сайт");
        force(&mut c, NOW + REFRESH_GAP);
        assert!(due(&c, NOW + REFRESH_GAP).contains(&KINONEWS));
    }

    #[test]
    fn topics_are_filtered_and_ordered() {
        let mut c = cache(&[]);
        let input = ["кино".to_owned(), "вязание".to_owned(), "футбол".to_owned(), "кино".to_owned()];
        assert!(set_topics(&mut c, &input, NOW));
        assert_eq!(c.topics, ["футбол", "кино"]);
        assert!(!set_topics(&mut c, &["футбол".into(), "кино".into()], NOW), "тот же набор — не будим поток");
    }

    #[test]
    fn cache_file_survives_old_and_partial_json() {
        let c: Cache = serde_json::from_str(r#"{"topics":["кино"],"unknown":1}"#).unwrap();
        assert_eq!(c.topics, ["кино"]);
        assert!(c.items.is_empty() && c.next.is_empty() && c.shown.is_empty());
        let mut full = cache(&["кино"]);
        full.items.push(item("кино", "ru", "https://k/1", NOW));
        full.shown.insert("https://k/0".into(), NOW);
        vote(&mut full, "KinoNews", true);
        merge(&mut full, KINONEWS, None, NOW);
        let back: Cache = serde_json::from_str(&serde_json::to_string(&full).unwrap()).unwrap();
        assert_eq!(back.items, full.items);
        assert_eq!(back.shown, full.shown);
        assert_eq!(back.sources, full.sources);
        assert_eq!(back.fetched, full.fetched);
    }

    /// Ручной прогон всех лент по сети: `cargo test -- --ignored live_feeds --nocapture`.
    #[test]
    #[ignore]
    fn live_feeds() {
        let agent = agent();
        let now = now();
        let mut c = cache(&TOPICS);
        let mut seen = HashSet::new();
        for f in FEEDS {
            if !seen.insert(f.url) {
                continue;
            }
            match fetch(&agent, f.url) {
                Some(e) => {
                    let fresh = e.iter().filter(|x| x.date.is_some_and(|d| now - d <= MAX_AGE)).count();
                    println!("OK   {:>3} записей, {:>3} свежих | {}", e.len(), fresh, f.url);
                    merge(&mut c, f.url, Some(&e), now);
                }
                None => {
                    println!("FAIL | {}", f.url);
                    merge(&mut c, f.url, None, now);
                }
            }
        }
        println!();
        for t in TOPICS {
            let items: Vec<&NewsItem> = c.items.iter().filter(|i| i.topic == t).collect();
            let ru = items.iter().filter(|i| i.lang == "ru").count();
            println!("{t:<17} {:>2} в кэше (ru {ru})", items.len());
            for i in items.iter().take(3) {
                println!("      {} ({})", i.title, i.source);
            }
        }
    }
}
