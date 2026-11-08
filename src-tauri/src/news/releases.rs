//! «Вышло»: патчи игр, в которые пользователь играет, и новые серии тайтлов из его списка.
//!
//! Обе вещи включаются в настройках отдельно и по умолчанию выключены: наружу уходят номера
//! игр Steam и список тайтлов — это больше, чем дата и язык.
//!
//! Игры: поток senses-tick раз в секунду отдаёт сюда путь exe активного окна ([`Watch`]).
//! Узнали игру ([`steam::identify`]) — копим минуты; от 10 минут игра попадает в профиль,
//! через 30 дней без игры — забывается. Профиль — только номер игры, название и минуты,
//! и только пока включены новости игр: выключили — профиль стёрт.
//!
//! Качает тот же фоновый поток, что и ленты новостей: Steam — раз в 6 часов на игру,
//! AniList — раз в день (разрешение списка — раз в неделю или когда список поменялся).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::anilist::{self, Anime, Episode, Wanted};
use super::steam::{self, Announcement, Game};
use super::{lock, now, FeedStatus, BODY_LIMIT, BUSY, TIMEOUT, USER_AGENT};

const FILE: &str = "releases.json";
const DAY: i64 = 24 * 3600;
/// Столько секунд в игре — и она в профиле.
const GAME_MIN: u64 = 10 * 60;
/// Не играл столько — игра забыта.
const GAME_FORGET: i64 = 30 * DAY;
/// Новости спрашиваем для стольких самых любимых игр.
const TOP_GAMES: usize = 5;
const STEAM_TTL: i64 = 6 * 3600;
const ANIME_TTL: i64 = DAY;
const RESOLVE_TTL: i64 = 7 * DAY;
const FAIL_TTL: i64 = 3600;
/// Старше — уже не новость (как у лент).
const MAX_AGE: i64 = super::MAX_AGE;
/// Расписание берём с запасом вперёд: серия выйдет — скажем, не дожидаясь нового запроса.
const AHEAD: i64 = 2 * DAY;
/// Накопленные секунды игры сбрасываются в профиль так часто.
const FLUSH: u64 = 60;
/// И на диск — не чаще.
const SAVE_GAP: i64 = 5 * 60;
const ANILIST: &str = "anilist";
/// Ссылку из облачка открываем только на эти сайты.
const LINK_HOSTS: &[&str] = &["store.steampowered.com", "anilist.co"];

/// Игра в профиле.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Played {
    appid: u32,
    name: String,
    secs: u64,
    /// Когда играли в последний раз.
    seen: i64,
}

/// Что вышло: анонс игры или серия.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Release {
    /// "steam:<appid>" или "anilist".
    source: String,
    /// Уникальный ключ: по нему помним, что уже рассказали.
    key: String,
    /// Название игры; у серий пусто — имя тайтла берётся на языке интерфейса при показе.
    #[serde(default)]
    name: String,
    /// Заголовок анонса; у серий пусто.
    #[serde(default)]
    title: String,
    #[serde(default)]
    episode: Option<u32>,
    #[serde(default)]
    media: Option<u32>,
    link: String,
    date: i64,
    #[serde(default)]
    patch: bool,
    /// Язык заголовка анонса по алфавиту; `None` — не понять, не показываем.
    #[serde(default)]
    lang: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
struct Fetched {
    at: i64,
    ok: bool,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct Cache {
    #[serde(default)]
    steam: bool,
    /// Список тайтлов из настроек как есть; пусто — аниме выключено.
    #[serde(default)]
    list: String,
    #[serde(default)]
    games: Vec<Played>,
    #[serde(default)]
    titles: Vec<Anime>,
    /// Что из списка AniList не нашёл — показать в настройках.
    #[serde(default)]
    missing: Vec<String>,
    /// Для какого списка и когда разрешали названия.
    #[serde(default)]
    resolved_for: String,
    #[serde(default)]
    resolved_at: i64,
    #[serde(default)]
    releases: Vec<Release>,
    #[serde(default)]
    next: BTreeMap<String, i64>,
    #[serde(default)]
    fetched: BTreeMap<String, Fetched>,
    #[serde(default)]
    shown: Vec<String>,
    #[serde(skip)]
    saved_at: i64,
}

/// Что сказать в облачке.
#[derive(Serialize, Debug, PartialEq)]
pub struct ReleasePick {
    /// "game" или "anime".
    kind: &'static str,
    /// Игра или тайтл на языке интерфейса.
    name: String,
    /// Заголовок анонса; у серий пусто.
    title: String,
    episode: Option<u32>,
    patch: bool,
    link: String,
}

fn steam_key(appid: u32) -> String {
    format!("steam:{appid}")
}

// ---------- профиль игр ----------

/// Самые любимые игры: от GAME_MIN, не забытые, по убыванию минут.
fn top(c: &Cache, now: i64) -> Vec<&Played> {
    let mut g: Vec<&Played> = c.games.iter().filter(|p| p.secs >= GAME_MIN && now - p.seen <= GAME_FORGET).collect();
    g.sort_by(|a, b| b.secs.cmp(&a.secs).then(a.appid.cmp(&b.appid)));
    g.truncate(TOP_GAMES);
    g
}

/// Добавить сыгранные секунды; `true` — игра только что попала в профиль.
fn add_play(c: &mut Cache, appid: u32, name: &str, secs: u64, now: i64) -> bool {
    if let Some(p) = c.games.iter_mut().find(|p| p.appid == appid) {
        let before = p.secs;
        p.secs += secs;
        p.seen = now;
        p.name = name.to_owned();
        before < GAME_MIN && p.secs >= GAME_MIN
    } else {
        c.games.push(Played { appid, name: name.to_owned(), secs, seen: now });
        secs >= GAME_MIN
    }
}

// ---------- сроки и слияние ----------

fn is_due(c: &Cache, key: &str, now: i64) -> bool {
    c.next.get(key).is_none_or(|&t| t <= now)
}

/// Игры, чьи анонсы пора спросить.
fn due_steam(c: &Cache, now: i64) -> Vec<(u32, String)> {
    if !c.steam {
        return Vec::new();
    }
    top(c, now).into_iter().filter(|p| is_due(c, &steam_key(p.appid), now)).map(|p| (p.appid, p.name.clone())).collect()
}

/// Работа для AniList: список, что разрешать (если надо) и номера уже найденных тайтлов.
#[derive(Debug, PartialEq)]
struct AnimeJob {
    list: String,
    resolve: Option<Vec<Wanted>>,
    ids: Vec<u32>,
}

fn due_anime(c: &Cache, now: i64) -> Option<AnimeJob> {
    let wanted = anilist::parse_list(&c.list);
    if wanted.is_empty() || !is_due(c, ANILIST, now) {
        return None;
    }
    let stale = c.resolved_for != c.list || now - c.resolved_at >= RESOLVE_TTL;
    Some(AnimeJob {
        list: c.list.clone(),
        resolve: stale.then_some(wanted),
        ids: c.titles.iter().map(|a| a.id).collect(),
    })
}

fn mark(c: &mut Cache, key: &str, ok: bool, ttl: i64, now: i64) {
    c.fetched.insert(key.to_owned(), Fetched { at: now, ok });
    c.next.insert(key.to_owned(), now + if ok { ttl } else { FAIL_TTL });
}

/// Анонсы игры пришли (или нет — `None`): заменить прежние анонсы этой игры свежими.
fn merge_steam(c: &mut Cache, appid: u32, name: &str, got: Option<&[Announcement]>, now: i64) {
    let source = steam_key(appid);
    mark(c, &source, got.is_some(), STEAM_TTL, now);
    let Some(list) = got else { return };
    c.releases.retain(|r| r.source != source);
    // у CS2 пять анонсов подряд зовутся «Counter-Strike 2 Update»: рассказываем самый свежий
    let mut titles: Vec<&str> = Vec::new();
    let mut fresh: Vec<&Announcement> = list.iter().filter(|a| a.date <= now && now - a.date <= MAX_AGE && steam::tellable(&a.title)).collect();
    fresh.sort_by(|a, b| b.date.cmp(&a.date));
    fresh.retain(|a| {
        let new = !titles.iter().any(|t| t.eq_ignore_ascii_case(&a.title));
        titles.push(&a.title);
        new
    });
    for a in fresh {
        c.releases.push(Release {
            source: source.clone(),
            key: format!("steam:{appid}:{}", a.gid),
            name: name.to_owned(),
            title: a.title.clone(),
            episode: None,
            media: None,
            link: steam::news_url(appid, &a.gid),
            date: a.date,
            patch: a.patch,
            lang: steam::title_lang(&a.title).map(str::to_owned),
        });
    }
}

/// Названия разрешены для списка `list`. Список успели поменять — ответ уже не про него.
fn set_titles(c: &mut Cache, list: &str, found: Vec<Anime>, missing: Vec<String>, now: i64) {
    if c.list != list {
        return;
    }
    c.titles = found;
    c.missing = missing;
    c.resolved_for = list.to_owned();
    c.resolved_at = now;
}

/// Расписание пришло (или нет — `None`): серии тайтлов из списка вместо прежних.
fn merge_schedule(c: &mut Cache, list: &str, got: Option<&[Episode]>, now: i64) {
    if c.list != list {
        return;
    }
    mark(c, ANILIST, got.is_some(), ANIME_TTL, now);
    let Some(eps) = got else { return };
    c.releases.retain(|r| r.source != ANILIST);
    for e in eps.iter().filter(|e| now - e.at <= MAX_AGE) {
        let Some(anime) = c.titles.iter().find(|a| a.id == e.media) else { continue };
        c.releases.push(Release {
            source: ANILIST.to_owned(),
            key: format!("anilist:{}:{}", e.media, e.episode),
            name: String::new(),
            title: String::new(),
            episode: Some(e.episode),
            media: Some(e.media),
            link: anime.url.clone(),
            date: e.at,
            patch: false,
            lang: None,
        });
    }
}

/// Убрать старое: протухшие релизы, забытые игры, следы выключенного.
fn prune(c: &mut Cache, now: i64) {
    c.games.retain(|p| now - p.seen <= GAME_FORGET);
    if !c.steam {
        c.games.clear();
    }
    let titles: Vec<u32> = c.titles.iter().map(|a| a.id).collect();
    let steam = c.steam;
    let anime = !c.list.is_empty();
    c.releases.retain(|r| {
        now - r.date <= MAX_AGE
            && match r.media {
                Some(m) => anime && titles.contains(&m),
                None => steam,
            }
    });
    let keys: Vec<&str> = c.releases.iter().map(|r| r.key.as_str()).collect();
    c.shown.retain(|k| keys.contains(&k.as_str()));
    let sources: Vec<String> = top(c, now).iter().map(|p| steam_key(p.appid)).chain(anime.then(|| ANILIST.to_owned())).collect();
    c.next.retain(|k, _| sources.contains(k));
    c.fetched.retain(|k, _| sources.contains(k));
}

/// Самое свежее нерассказанное, что уже вышло; помечается рассказанным.
/// Анонс игры — только если язык заголовка совпадает с языком интерфейса.
fn pick(c: &mut Cache, now: i64, en: bool) -> Option<ReleasePick> {
    let lang = if en { "en" } else { "ru" };
    let best = c
        .releases
        .iter()
        .filter(|r| r.date <= now && now - r.date <= MAX_AGE && !c.shown.contains(&r.key))
        .filter(|r| match r.media {
            Some(m) => c.titles.iter().any(|a| a.id == m),
            None => c.steam && r.lang.as_deref() == Some(lang),
        })
        .max_by_key(|r| r.date)?
        .clone();
    c.shown.push(best.key.clone());
    let (kind, name) = match best.media {
        Some(m) => ("anime", c.titles.iter().find(|a| a.id == m).map(|a| a.name(en).to_owned()).unwrap_or_default()),
        None => ("game", best.name),
    };
    Some(ReleasePick { kind, name, title: best.title, episode: best.episode, patch: best.patch, link: best.link })
}

/// Настройки поменялись; `true` — есть что качать заново.
fn setup(c: &mut Cache, steam_on: bool, list: &str, now: i64) -> bool {
    let list = list.trim();
    let mut changed = false;
    if c.steam != steam_on {
        c.steam = steam_on;
        changed = steam_on;
    }
    if c.list != list {
        c.list = list.to_owned();
        c.next.remove(ANILIST);
        changed |= !list.is_empty();
    }
    prune(c, now);
    changed
}

/// Строки для списка источников в настройках.
fn status(c: &Cache, now: i64, lang: &str) -> Vec<FeedStatus> {
    let row = |source: String, topic: &str, key: &str, items: usize, missing: Vec<String>| FeedStatus {
        source,
        lang: lang.to_owned(),
        topics: vec![topic.to_owned()],
        at: c.fetched.get(key).map(|f| f.at),
        ok: c.fetched.get(key).map(|f| f.ok),
        next: c.next.get(key).copied(),
        items,
        weight: 1.0,
        missing,
    };
    let mut out = Vec::new();
    if c.steam {
        let games = top(c, now);
        if games.is_empty() {
            out.push(row("Steam".into(), "игры", "", 0, Vec::new()));
        }
        for p in games {
            let key = steam_key(p.appid);
            let items = c.releases.iter().filter(|r| r.source == key && r.lang.as_deref() == Some(lang)).count();
            out.push(row(format!("Steam: {}", p.name), "игры", &key, items, Vec::new()));
        }
    }
    if !c.list.is_empty() {
        let items = c.releases.iter().filter(|r| r.source == ANILIST && r.date <= now).count();
        out.push(row("AniList".into(), "аниме", ANILIST, items, c.missing.clone()));
    }
    out
}

/// Ссылку можно открыть: https и сайт из LINK_HOSTS.
fn allowed_link(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    LINK_HOSTS.contains(&host) && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

// ---------- состояние ----------

static STATE: Mutex<Option<Cache>> = Mutex::new(None);
/// Активное окно — игра (любая узнанная, даже без Steam): в игре про игры не говорим.
static IN_GAME: AtomicBool = AtomicBool::new(false);

fn path() -> Option<PathBuf> {
    crate::store::data_dir().map(|d| PathBuf::from(d).join(FILE))
}

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

fn save(c: &mut Cache) {
    c.saved_at = now();
    let Some(p) = path() else { return };
    let Ok(json) = serde_json::to_string(c) else { return };
    let tmp = p.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() && std::fs::rename(&tmp, &p).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Сейчас на экране игра.
pub fn in_game() -> bool {
    IN_GAME.load(Ordering::Relaxed)
}

/// Следит за активным окном из потока senses-tick: узнаёт игру и копит минуты.
pub struct Watch {
    path: Option<String>,
    game: Option<Game>,
    secs: u64,
}

impl Default for Watch {
    fn default() -> Self {
        Self::new()
    }
}

impl Watch {
    pub fn new() -> Self {
        Watch { path: None, game: None, secs: 0 }
    }

    /// Тик раз в секунду: `path` — exe активного окна, `active` — человек за компьютером.
    pub fn tick(&mut self, path: Option<&str>, active: bool) {
        if path != self.path.as_deref() {
            self.flush();
            self.path = path.map(str::to_owned);
            self.game = path.and_then(steam::identify);
            IN_GAME.store(self.game.is_some(), Ordering::Relaxed);
        }
        if active && self.game.as_ref().is_some_and(|g| g.appid.is_some()) {
            self.secs += 1;
            if self.secs >= FLUSH {
                self.flush();
            }
        }
    }

    fn flush(&mut self) {
        let secs = std::mem::take(&mut self.secs);
        let Some(Game { appid: Some(appid), name }) = &self.game else { return };
        if secs == 0 {
            return;
        }
        with_cache(|c| {
            if !c.steam {
                return;
            }
            let t = now();
            let joined = add_play(c, *appid, name, secs, t);
            if joined || t - c.saved_at >= SAVE_GAP {
                save(c);
            }
        });
    }
}

// ---------- сеть ----------

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .user_agent(USER_AGENT)
        .accept("application/json")
        .https_only(true)
        .max_redirects(3)
        .build()
        .into()
}

fn read(mut resp: ureq::http::Response<ureq::Body>) -> Option<String> {
    let body = resp.body_mut().with_config().limit(BODY_LIMIT).read_to_vec().ok()?;
    String::from_utf8(body).ok()
}

fn get(agent: &ureq::Agent, url: &str) -> Option<String> {
    read(agent.get(url).call().ok()?)
}

fn graphql(agent: &ureq::Agent, query: &str) -> Option<String> {
    read(agent.post(anilist::API).header("Content-Type", "application/json").send(anilist::body(query)).ok()?)
}

/// Спросить, что подошло по срокам. Зовётся из потока новостей; пока качаем, кэш не заперт.
pub(super) fn refresh() {
    let (games, anime) = with_cache(|c| {
        let t = now();
        prune(c, t);
        (due_steam(c, t), due_anime(c, t))
    });
    if games.is_empty() && anime.is_none() {
        return;
    }
    BUSY.store(true, Ordering::Relaxed);
    let agent = agent();
    for (appid, name) in games {
        let got = get(&agent, &steam::api_url(appid)).and_then(|s| steam::parse_news(&s));
        with_cache(|c| merge_steam(c, appid, &name, got.as_deref(), now()));
    }
    if let Some(job) = anime {
        let mut ids = Some(job.ids);
        if let Some(wanted) = &job.resolve {
            ids = graphql(&agent, &anilist::resolve_query(wanted)).and_then(|s| anilist::parse_resolve(&s, wanted)).map(|(found, missing)| {
                let ids = found.iter().map(|a| a.id).collect();
                with_cache(|c| set_titles(c, &job.list, found, missing, now()));
                ids
            });
        }
        let t = now();
        let episodes = match ids {
            Some(ids) if ids.is_empty() => Some(Vec::new()),
            Some(ids) => graphql(&agent, &anilist::schedule_query(&ids, t - MAX_AGE, t + AHEAD)).and_then(|s| anilist::parse_schedule(&s)),
            None => None,
        };
        with_cache(|c| merge_schedule(c, &job.list, episodes.as_deref(), now()));
    }
    with_cache(save);
    BUSY.store(false, Ordering::Relaxed);
}

/// «Обновить сейчас»: как у лент — снять сроки, кроме спрошенного в последние минуты.
pub(super) fn force() {
    with_cache(|c| {
        let t = now();
        let fetched = &c.fetched;
        c.next.retain(|k, _| fetched.get(k).is_some_and(|f| t - f.at < super::REFRESH_GAP));
    });
}

pub(super) fn status_rows() -> Vec<FeedStatus> {
    with_cache(|c| status(c, now(), crate::i18n::code()))
}

// ---------- команды ----------

/// Настройки «Новости игр» и «Новые серии». `anime` — список тайтлов, пусто — выключено.
#[tauri::command]
pub fn releases_setup(steam: bool, anime: String) {
    let changed = with_cache(|c| {
        let changed = setup(c, steam, &anime, now());
        save(c);
        changed
    });
    if changed {
        super::wake();
    }
}

/// Что вышло — для облачка, или `None`. В игре — всегда `None`.
#[tauri::command]
pub fn release_pick() -> Option<ReleasePick> {
    if in_game() {
        return None;
    }
    with_cache(|c| {
        let got = pick(c, now(), crate::i18n::en());
        if got.is_some() {
            save(c);
        }
        got
    })
}

/// Открыть ссылку из облачка в браузере — только Steam и AniList.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    if !allowed_link(&url) {
        return Err("link not allowed".into());
    }
    #[cfg(windows)]
    {
        if crate::win::open_url(&url) {
            Ok(())
        } else {
            Err("cannot open the browser".into())
        }
    }
    #[cfg(not(windows))]
    Err("not supported".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_793_900_000;
    const H: i64 = 3600;

    fn ann(gid: &str, title: &str, date: i64, patch: bool) -> Announcement {
        Announcement { gid: gid.into(), title: title.into(), date, patch }
    }

    fn frieren() -> Anime {
        Anime { id: 182255, romaji: "Sousou no Frieren 2nd Season".into(), english: Some("Frieren: Beyond Journey's End Season 2".into()), typed: Some("Фрирен".into()), url: "https://anilist.co/anime/182255".into() }
    }

    fn played(c: &mut Cache, appid: u32, name: &str, mins: u64) {
        add_play(c, appid, name, mins * 60, NOW);
    }

    #[test]
    fn games_enter_profile_after_ten_minutes_and_are_forgotten() {
        let mut c = Cache { steam: true, ..Default::default() };
        assert!(!add_play(&mut c, 730, "Counter-Strike 2", 9 * 60, NOW));
        assert!(top(&c, NOW).is_empty(), "девять минут — ещё не любимая игра");
        assert!(add_play(&mut c, 730, "Counter-Strike 2", 60, NOW), "десятая минута — в профиле");
        for (i, id) in [1u32, 2, 3, 4, 5].into_iter().enumerate() {
            played(&mut c, id, "x", 20 + i as u64);
        }
        let t: Vec<u32> = top(&c, NOW).iter().map(|p| p.appid).collect();
        assert_eq!(t, vec![5, 4, 3, 2, 1], "пять любимых по минутам");
        assert!(top(&c, NOW + GAME_FORGET + 1).is_empty(), "месяц без игры — забыта");
        prune(&mut c, NOW + GAME_FORGET + 1);
        assert!(c.games.is_empty());
    }

    #[test]
    fn steam_off_forgets_profile() {
        let mut c = Cache { steam: true, ..Default::default() };
        played(&mut c, 730, "Counter-Strike 2", 30);
        assert!(!setup(&mut c, false, "", NOW));
        assert!(c.games.is_empty(), "выключили — профиль стёрт");
        assert!(due_steam(&c, NOW).is_empty());
    }

    #[test]
    fn steam_due_and_merge() {
        let mut c = Cache { steam: true, ..Default::default() };
        played(&mut c, 730, "Counter-Strike 2", 30);
        assert_eq!(due_steam(&c, NOW), vec![(730, "Counter-Strike 2".to_owned())]);
        let list = [
            ann("1", "Counter-Strike 2 Update", NOW - H, true),
            ann("2", "Steam Sale with our biggest discounts yet!", NOW - H, false),
            ann("3", "Old news from last month about maps", NOW - MAX_AGE - 1, false),
            ann("4", "Обновление 1.5: новые карты", NOW - 2 * H, true),
            ann("5", "Counter-Strike 2 Update", NOW - 3 * H, true),
        ];
        merge_steam(&mut c, 730, "Counter-Strike 2", Some(&list), NOW);
        assert_eq!(c.releases.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(), vec!["steam:730:1", "steam:730:4"]);
        assert_eq!(c.releases[0].link, "https://store.steampowered.com/news/app/730/view/1");
        assert!(due_steam(&c, NOW + STEAM_TTL - 1).is_empty());
        assert_eq!(due_steam(&c, NOW + STEAM_TTL).len(), 1);

        merge_steam(&mut c, 730, "Counter-Strike 2", None, NOW);
        assert_eq!(c.next["steam:730"], NOW + FAIL_TTL, "неудача — повтор через час");
        assert_eq!(c.releases.len(), 2, "неудача прежнее не стирает");
    }

    #[test]
    fn pick_respects_interface_language_and_shows_once() {
        let mut c = Cache { steam: true, ..Default::default() };
        played(&mut c, 730, "Counter-Strike 2", 30);
        // русского анонса в настоящей выдаче CS2 нет — заголовок придуман для проверки
        let list = [ann("1", "Counter-Strike 2 Update", NOW - H, true), ann("4", "Обновление 1.5: новые карты", NOW - 2 * H, true)];
        merge_steam(&mut c, 730, "Counter-Strike 2", Some(&list), NOW);

        let ru = pick(&mut c, NOW, false).unwrap();
        assert_eq!((ru.kind, ru.name.as_str(), ru.title.as_str(), ru.patch), ("game", "Counter-Strike 2", "Обновление 1.5: новые карты", true));
        assert_eq!(pick(&mut c, NOW, false), None, "английский анонс в русском интерфейсе не показываем");
        let en = pick(&mut c, NOW, true).unwrap();
        assert_eq!(en.title, "Counter-Strike 2 Update");
        assert_eq!(pick(&mut c, NOW, true), None, "рассказанное — один раз");
    }

    #[test]
    fn anime_job_resolves_once_then_schedules() {
        let mut c = Cache::default();
        assert!(due_anime(&c, NOW).is_none(), "список пуст — AniList не трогаем");
        assert!(setup(&mut c, false, "Фрирен, https://anilist.co/anime/209872", NOW));
        let job = due_anime(&c, NOW).unwrap();
        assert_eq!(job.resolve, Some(vec![Wanted::Name("Фрирен".into()), Wanted::AniList(209872)]));

        set_titles(&mut c, &job.list, vec![frieren()], vec!["AniList 209872".into()], NOW);
        let eps = [
            Episode { media: 182255, episode: 5, at: NOW - 2 * H },
            Episode { media: 182255, episode: 6, at: NOW + DAY },
            Episode { media: 999, episode: 1, at: NOW - H },
        ];
        merge_schedule(&mut c, &job.list, Some(&eps), NOW);
        assert_eq!(c.releases.len(), 2, "чужой тайтл не берём");
        assert!(due_anime(&c, NOW + ANIME_TTL - 1).is_none());
        let again = due_anime(&c, NOW + ANIME_TTL).unwrap();
        assert_eq!(again.resolve, None, "названия разрешены — неделю не спрашиваем");
        assert_eq!(again.ids, vec![182255]);
        assert!(due_anime(&c, NOW + RESOLVE_TTL).unwrap().resolve.is_some());

        let p = pick(&mut c, NOW, false).unwrap();
        assert_eq!((p.kind, p.name.as_str(), p.episode), ("anime", "Фрирен", Some(5)));
        assert_eq!(p.link, "https://anilist.co/anime/182255");
        assert_eq!(pick(&mut c, NOW, false), None, "шестая ещё не вышла");
        let p6 = pick(&mut c, NOW + DAY, true).unwrap();
        assert_eq!((p6.name.as_str(), p6.episode), ("Frieren: Beyond Journey's End Season 2", Some(6)), "вышла — скажем без нового запроса");
    }

    #[test]
    fn stale_answers_for_old_list_are_ignored() {
        let mut c = Cache::default();
        setup(&mut c, false, "Фрирен", NOW);
        let job = due_anime(&c, NOW).unwrap();
        setup(&mut c, false, "One Piece", NOW);
        set_titles(&mut c, &job.list, vec![frieren()], vec![], NOW);
        merge_schedule(&mut c, &job.list, Some(&[]), NOW);
        assert!(c.titles.is_empty() && c.releases.is_empty());
        assert!(due_anime(&c, NOW).is_some(), "новый список спросим сразу");
    }

    #[test]
    fn anime_off_drops_titles_releases() {
        let mut c = Cache::default();
        setup(&mut c, false, "Фрирен", NOW);
        set_titles(&mut c, "Фрирен", vec![frieren()], vec![], NOW);
        merge_schedule(&mut c, "Фрирен", Some(&[Episode { media: 182255, episode: 5, at: NOW - H }]), NOW);
        setup(&mut c, false, "", NOW);
        assert!(c.releases.is_empty());
        assert_eq!(pick(&mut c, NOW, false), None);
    }

    #[test]
    fn status_rows_for_settings() {
        let mut c = Cache { steam: true, ..Default::default() };
        let rows = status(&c, NOW, "ru");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source, "Steam");
        played(&mut c, 730, "Counter-Strike 2", 30);
        c.list = "Ранма".into();
        c.missing = vec!["Ранма".into()];
        let rows = status(&c, NOW, "ru");
        assert_eq!(rows.iter().map(|r| r.source.as_str()).collect::<Vec<_>>(), vec!["Steam: Counter-Strike 2", "AniList"]);
        assert_eq!(rows[1].missing, vec!["Ранма".to_owned()]);
        assert_eq!(rows[1].topics, vec!["аниме".to_owned()]);
    }

    #[test]
    fn only_steam_and_anilist_links_open() {
        assert!(allowed_link("https://store.steampowered.com/news/app/730/view/1"));
        assert!(allowed_link("https://anilist.co/anime/182255"));
        assert!(!allowed_link("http://anilist.co/anime/1"));
        assert!(!allowed_link("https://anilist.co.evil.example/anime/1"));
        assert!(!allowed_link("https://store.steampowered.com@evil.example/"));
        assert!(!allowed_link("file:///C:/Windows/System32/calc.exe"));
        assert!(!allowed_link("https://anilist.co/a b"));
    }

    /// Живой Steam: `cargo test -- --ignored live_steam --nocapture`.
    #[test]
    #[ignore]
    fn live_steam() {
        let agent = agent();
        for appid in [730u32, 570, 238_960] {
            let body = get(&agent, &steam::api_url(appid)).expect("Steam не ответил");
            let list = steam::parse_news(&body).expect("не тот ответ");
            println!("{appid}: {} анонсов", list.len());
            for a in &list {
                println!("  {} | patch={} lang={:?} tellable={}", a.title, a.patch, steam::title_lang(&a.title), steam::tellable(&a.title));
            }
        }
    }

    /// Живой AniList: `cargo test -- --ignored live_anilist --nocapture`.
    #[test]
    #[ignore]
    fn live_anilist() {
        let agent = agent();
        let wanted = anilist::parse_list("https://shikimori.one/animes/z52991-sousou-no-frieren, One Piece, Фрирен, Ранма");
        let body = graphql(&agent, &anilist::resolve_query(&wanted)).expect("AniList не ответил");
        let (found, missing) = anilist::parse_resolve(&body, &wanted).expect("не тот ответ");
        for a in &found {
            println!("{} | ru: {} | en: {}", a.id, a.name(false), a.name(true));
        }
        println!("не нашли: {missing:?}");
        assert!(!found.is_empty());
        let t = now();
        let ids: Vec<u32> = found.iter().map(|a| a.id).collect();
        let body = graphql(&agent, &anilist::schedule_query(&ids, t - MAX_AGE, t + AHEAD)).expect("расписание не пришло");
        let eps = anilist::parse_schedule(&body).expect("не тот ответ");
        for e in &eps {
            println!("  {} серия {} через {} ч", e.media, e.episode, (e.at - t) / 3600);
        }
    }

    #[test]
    fn watch_counts_only_games() {
        let mut w = Watch::new();
        w.tick(Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), true);
        assert!(!in_game() && w.secs == 0);
        w.tick(Some(r"C:\Program Files (x86)\Hearthstone\Hearthstone.exe"), true);
        assert!(in_game(), "Hearthstone — игра, хоть и не в Steam");
        assert_eq!(w.secs, 0, "без appid минуты не копим");
        w.tick(None, true);
        assert!(!in_game());
    }
}
