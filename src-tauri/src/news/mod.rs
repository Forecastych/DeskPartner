//! Новости по увлечениям: «Пишут: …» в облачке кошки.
//!
//! Фоновый поток раз в несколько часов качает публичные RSS/Atom-ленты выбранных тем
//! (список — feeds.rs), берёт из записей только заголовок, ссылку и дату, отсеивает
//! тяжёлое, рекламу и кликбейт (filter.rs) и копит свежее в `news.json` в папке данных.
//! Фронт берёт по одной новости командой `news_pick`.
//!
//! Приватность: наружу уходят только GET к адресам лент — без куки, без идентификаторов,
//! темы пользователя в запросы не попадают (ленты качаются целиком, выбор — локально).
//! Нет сети — новостей просто нет, без ошибок.

mod feeds;
mod filter;
mod parse;

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
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
    cache.next.retain(|url, _| FEEDS.iter().any(|f| f.url == url && topics.iter().any(|t| t == f.topic)));
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

/// Новость для облачка: тема — случайная из тех, где есть непоказанное; внутри темы
/// сначала русские, из них самая свежая. Выбранная запоминается как показанная.
fn pick(cache: &mut Cache, now: i64, seed: u64) -> Option<NewsItem> {
    let fresh = |i: &&NewsItem| !cache.shown.contains_key(&i.link);
    let topics: Vec<&String> =
        cache.topics.iter().filter(|t| cache.items.iter().filter(fresh).any(|i| &i.topic == *t)).collect();
    if topics.is_empty() {
        return None;
    }
    let topic = topics[(seed % topics.len() as u64) as usize];
    let item = cache
        .items
        .iter()
        .filter(fresh)
        .filter(|i| &i.topic == topic)
        .min_by_key(|i| (i.lang != "ru", -i.date))?
        .clone();
    cache.shown.insert(item.link.clone(), now);
    Some(item)
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
    let agent = agent();
    for url in urls {
        let entries = fetch(&agent, url);
        with_cache(|c| merge(c, url, entries.as_deref(), now()));
    }
    with_cache(|c| save(c));
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

/// Новость для облачка по увлечениям пользователя или `None`, если рассказать нечего.
/// Темы запоминаются локально: по ним фоновый поток решает, какие ленты качать.
#[tauri::command]
pub fn news_pick(topics: Vec<String>) -> Option<NewsItem> {
    let (item, changed) = with_cache(|c| {
        let t = now();
        let changed = set_topics(c, &topics, t);
        let item = pick(c, t, seed());
        if changed || item.is_some() {
            save(c);
        }
        (item, changed)
    });
    if changed {
        wake();
    }
    item
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
        let order: Vec<String> = (0..3).map(|s| pick(&mut c, NOW, s).unwrap().link).collect();
        assert_eq!(order, ["https://a/ru-new", "https://a/ru-old", "https://a/en-new"]);
        assert_eq!(pick(&mut c, NOW, 0), None, "всё показано — молчим");
    }

    #[test]
    fn pick_spreads_over_topics_and_skips_shared_links() {
        let mut c = cache(&["наука", "животные"]);
        c.items.push(item("наука", "ru", "https://n/whale", NOW));
        c.items.push(item("животные", "ru", "https://n/whale", NOW));
        c.items.push(item("наука", "ru", "https://n/atom", NOW - 60));
        let first = pick(&mut c, NOW, 1).unwrap();
        assert_eq!((first.topic.as_str(), first.link.as_str()), ("животные", "https://n/whale"));
        // у животных больше нечего — выбор только из науки, и кита там не повторяем
        let second = pick(&mut c, NOW, 1).unwrap();
        assert_eq!((second.topic.as_str(), second.link.as_str()), ("наука", "https://n/atom"));
        assert_eq!(pick(&mut c, NOW, 1), None);
        assert_eq!(pick(&mut cache(&[]), NOW, 0), None);
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
        let back: Cache = serde_json::from_str(&serde_json::to_string(&full).unwrap()).unwrap();
        assert_eq!(back.items, full.items);
        assert_eq!(back.shown, full.shown);
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
