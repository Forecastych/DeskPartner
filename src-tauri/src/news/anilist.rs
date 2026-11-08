//! Расписание серий из AniList для ручного списка тайтлов из настроек.
//!
//! Список — строка через запятую: названия или ссылки на Shikimori, MyAnimeList, AniList.
//! Номер тайтла на Shikimori совпадает с MAL, поэтому ссылку Shikimori ищем по `idMal`.
//! Всё уходит одним GraphQL-запросом на алиасах: по одному запросу на разрешение списка
//! и на расписание, при лимите AniList 30 запросов в минуту.
//!
//! Только `Page { media(...) }`: одиночный `Media(...)` с ненайденным тайтлом отвечает 404
//! и обнуляет ВСЕ алиасы запроса, а в `Page` ненайденное — просто пустой список.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const API: &str = "https://graphql.anilist.co";
/// Больше тайтлов в списке не берём: строка настроек — не база данных.
pub const MAX_TITLES: usize = 10;

/// Тайтл, как его записал пользователь.
#[derive(Debug, Clone, PartialEq)]
pub enum Wanted {
    /// Номер MyAnimeList (он же Shikimori).
    Mal(u32),
    /// Номер AniList.
    AniList(u32),
    /// Название — ищем по нему.
    Name(String),
}

/// Номер из пути ссылки после `/anime/` или `/animes/`: у Shikimori перед ним бывают буквы
/// (`/animes/z52991-sousou-no-frieren`), у MAL и AniList — сразу цифры.
fn id_after(url: &str, marker: &str) -> Option<u32> {
    let at = url.find(marker)? + marker.len();
    let rest = url[at..].trim_start_matches(|c: char| c.is_ascii_alphabetic());
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|&n| n > 0)
}

/// Разобрать строку настроек: запятая, точка с запятой или перевод строки между тайтлами.
/// Повторы и пустое выбрасываем, больше [`MAX_TITLES`] не берём.
pub fn parse_list(s: &str) -> Vec<Wanted> {
    let mut out: Vec<Wanted> = Vec::new();
    for raw in s.split([',', ';', '\n']) {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        let low = t.to_lowercase();
        let w = if low.contains("shikimori.") || low.contains("myanimelist.net") {
            match id_after(&low, "/animes/").or_else(|| id_after(&low, "/anime/")) {
                Some(id) => Wanted::Mal(id),
                None => continue,
            }
        } else if low.contains("anilist.co") {
            match id_after(&low, "/anime/") {
                Some(id) => Wanted::AniList(id),
                None => continue,
            }
        } else if low.starts_with("http://") || low.starts_with("https://") {
            continue; // чужой сайт: искать по адресу бессмысленно
        } else {
            Wanted::Name(t.chars().take(100).collect())
        };
        if !out.contains(&w) {
            out.push(w);
        }
        if out.len() == MAX_TITLES {
            break;
        }
    }
    out
}

/// Тайтл, найденный в AniList. `typed` — название, как его ввёл пользователь (если вводил):
/// для русского интерфейса оно лучше английского.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Anime {
    pub id: u32,
    pub romaji: String,
    #[serde(default)]
    pub english: Option<String>,
    #[serde(default)]
    pub typed: Option<String>,
    pub url: String,
}

impl Anime {
    /// Название на языке интерфейса: по-русски — как написал пользователь, если он писал
    /// по-русски; иначе английское, а нет его — ромадзи.
    pub fn name(&self, en: bool) -> &str {
        let typed = self.typed.as_deref().filter(|t| !en && t.chars().any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')));
        typed.or(self.english.as_deref()).filter(|s| !s.trim().is_empty()).unwrap_or(&self.romaji)
    }
}

const FIELDS: &str = "id idMal title { romaji english } siteUrl";

/// Строка как литерал GraphQL — то же экранирование, что у JSON.
fn literal(s: &str) -> String {
    Value::String(s.to_owned()).to_string()
}

/// Запрос на разрешение списка: номера MAL и AniList — двумя пачками, каждое название —
/// двумя алиасами: `s<номер>` среди выходящих и анонсированных (нужен новый сезон, а не
/// старый) и запасной `t<номер>` без этого условия. Русские синонимы у AniList бывают только
/// у старых сезонов: «Фрирен» находится лишь запасным поиском (проверено 9 ноября 2026).
pub fn resolve_query(list: &[Wanted]) -> String {
    let join = |ids: Vec<u32>| ids.iter().map(u32::to_string).collect::<Vec<_>>().join(", ");
    let mal: Vec<u32> = list.iter().filter_map(|w| if let Wanted::Mal(id) = w { Some(*id) } else { None }).collect();
    let al: Vec<u32> = list.iter().filter_map(|w| if let Wanted::AniList(id) = w { Some(*id) } else { None }).collect();
    let mut q = String::from("query {");
    if !mal.is_empty() {
        q += &format!(" mal: Page(perPage: {}) {{ media(idMal_in: [{}], type: ANIME) {{ {FIELDS} }} }}", mal.len(), join(mal.clone()));
    }
    if !al.is_empty() {
        q += &format!(" al: Page(perPage: {}) {{ media(id_in: [{}], type: ANIME) {{ {FIELDS} }} }}", al.len(), join(al.clone()));
    }
    for (i, w) in list.iter().enumerate() {
        if let Wanted::Name(n) = w {
            q += &format!(
                " s{i}: Page(perPage: 1) {{ media(search: {}, type: ANIME, status_in: [RELEASING, NOT_YET_RELEASED], sort: SEARCH_MATCH) {{ {FIELDS} }} }}",
                literal(n)
            );
            q += &format!(" t{i}: Page(perPage: 1) {{ media(search: {}, type: ANIME, sort: SEARCH_MATCH) {{ {FIELDS} }} }}", literal(n));
        }
    }
    q + " }"
}

#[derive(Deserialize)]
struct RawMedia {
    id: u32,
    #[serde(rename = "idMal")]
    id_mal: Option<u32>,
    title: RawTitle,
    #[serde(rename = "siteUrl")]
    site_url: Option<String>,
}

#[derive(Deserialize)]
struct RawTitle {
    romaji: Option<String>,
    english: Option<String>,
}

fn media_of(data: &Value, alias: &str) -> Vec<RawMedia> {
    data.get(alias)
        .and_then(|p| p.get("media"))
        .and_then(|m| serde_json::from_value::<Vec<RawMedia>>(m.clone()).ok())
        .unwrap_or_default()
}

/// Разобрать ответ на [`resolve_query`] того же списка: найденные тайтлы в порядке списка
/// и то, что не нашлось (как пользователь записал). Не тот ответ — `None`.
pub fn parse_resolve(json: &str, list: &[Wanted]) -> Option<(Vec<Anime>, Vec<String>)> {
    let v: Value = serde_json::from_str(json).ok()?;
    let data = v.get("data").filter(|d| d.is_object())?;
    let (mal, al) = (media_of(data, "mal"), media_of(data, "al"));
    let mut found: Vec<Anime> = Vec::new();
    let mut missing = Vec::new();
    for (i, w) in list.iter().enumerate() {
        let (raw, typed, label) = match w {
            Wanted::Mal(id) => (mal.iter().find(|m| m.id_mal == Some(*id)), None, format!("MAL {id}")),
            Wanted::AniList(id) => (al.iter().find(|m| m.id == *id), None, format!("AniList {id}")),
            Wanted::Name(n) => {
                let hit = media_of(data, &format!("s{i}")).into_iter().next().or_else(|| media_of(data, &format!("t{i}")).into_iter().next());
                let anime = hit.as_ref().and_then(|m| to_anime(m, Some(n.clone())));
                match anime {
                    Some(a) if !found.iter().any(|f| f.id == a.id) => found.push(a),
                    Some(_) => {}
                    None => missing.push(n.clone()),
                }
                continue;
            }
        };
        match raw.and_then(|m| to_anime(m, typed)) {
            Some(a) if !found.iter().any(|f| f.id == a.id) => found.push(a),
            Some(_) => {}
            None => missing.push(label),
        }
    }
    Some((found, missing))
}

fn to_anime(m: &RawMedia, typed: Option<String>) -> Option<Anime> {
    let english = m.title.english.clone().filter(|s| !s.trim().is_empty());
    let romaji = m.title.romaji.clone().filter(|s| !s.trim().is_empty()).or_else(|| english.clone())?;
    let url = m.site_url.clone().unwrap_or_else(|| format!("https://anilist.co/anime/{}", m.id));
    Some(Anime { id: m.id, romaji, english, typed, url })
}

/// Серия в расписании.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Episode {
    pub media: u32,
    pub episode: u32,
    pub at: i64,
}

/// Запрос расписания: серии тайтлов, выходящие между `from` и `to` (unix-секунды).
pub fn schedule_query(ids: &[u32], from: i64, to: i64) -> String {
    let list = ids.iter().map(u32::to_string).collect::<Vec<_>>().join(", ");
    format!(
        "query {{ Page(perPage: 50) {{ airingSchedules(mediaId_in: [{list}], airingAt_greater: {from}, airingAt_lesser: {to}, sort: TIME) {{ mediaId episode airingAt }} }} }}"
    )
}

/// Разобрать ответ на [`schedule_query`]. Не тот ответ — `None`.
pub fn parse_schedule(json: &str) -> Option<Vec<Episode>> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(rename = "mediaId")]
        media_id: u32,
        episode: u32,
        #[serde(rename = "airingAt")]
        airing_at: i64,
    }
    let v: Value = serde_json::from_str(json).ok()?;
    let list = v.pointer("/data/Page/airingSchedules")?;
    let raw: Vec<Raw> = serde_json::from_value(list.clone()).ok()?;
    Some(raw.into_iter().map(|r| Episode { media: r.media_id, episode: r.episode, at: r.airing_at }).collect())
}

/// Тело POST-запроса GraphQL.
pub fn body(query: &str) -> String {
    serde_json::json!({ "query": query }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_accepts_links_and_names() {
        let got = parse_list(
            "https://shikimori.one/animes/z52991-sousou-no-frieren, Фрирен; https://myanimelist.net/anime/21/One_Piece\nhttps://anilist.co/anime/209872/Ranma-12-2024-Season-3/ ,, https://example.com/x, Фрирен",
        );
        assert_eq!(
            got,
            vec![Wanted::Mal(52991), Wanted::Name("Фрирен".into()), Wanted::Mal(21), Wanted::AniList(209872)],
            "повтор и чужой сайт выброшены"
        );
        assert_eq!(parse_list("https://shikimori.io/animes/abc"), vec![], "ссылка без номера");
        assert_eq!(parse_list(&(1..=15).map(|i| format!("Тайтл {i}")).collect::<Vec<_>>().join(",")).len(), MAX_TITLES);
    }

    #[test]
    fn resolve_query_batches_ids_and_escapes_names() {
        let q = resolve_query(&[Wanted::Mal(52991), Wanted::Name("Say \"hi\"".into()), Wanted::Mal(21), Wanted::AniList(5)]);
        assert!(q.contains("mal: Page(perPage: 2) { media(idMal_in: [52991, 21], type: ANIME)"), "{q}");
        assert!(q.contains("al: Page(perPage: 1) { media(id_in: [5], type: ANIME)"), "{q}");
        assert!(q.contains(r#"s1: Page(perPage: 1) { media(search: "Say \"hi\"", type: ANIME, status_in"#), "{q}");
        assert!(q.contains(r#"t1: Page(perPage: 1) { media(search: "Say \"hi\"", type: ANIME, sort"#), "{q}");
        assert!(!q.contains("Media("), "одиночный Media при ненайденном валит весь ответ");
        let b: Value = serde_json::from_str(&body(&q)).unwrap();
        assert_eq!(b["query"], q);
    }

    /// Собран из ответов AniList 8–9 ноября 2026: Ранма по ссылке нашлась, «Ранма» по названию —
    /// нет ни так, ни так; «Фрирен» среди выходящих не нашлась, запасной поиск дал первый сезон.
    /// У второго сезона (по номеру MAL) english убран нарочно — проверить запасной ромадзи;
    /// в настоящем ответе там «…Season 2».
    const RESOLVE: &str = r#"{"data":{
      "mal":{"media":[{"id":182255,"idMal":59978,"title":{"romaji":"Sousou no Frieren 2nd Season","english":null},"siteUrl":"https:\/\/anilist.co\/anime\/182255"}]},
      "al":{"media":[{"id":209872,"idMal":63801,"title":{"romaji":"Ranma 1\/2 (2024) 3rd Season","english":"Ranma1\/2 (2024) Season 3"},"siteUrl":"https:\/\/anilist.co\/anime\/209872"}]},
      "s1":{"media":[]}, "t1":{"media":[]},
      "s2":{"media":[]}, "t2":{"media":[{"id":154587,"idMal":52991,"title":{"romaji":"Sousou no Frieren","english":"Frieren: Beyond Journey\u2019s End"},"siteUrl":"https:\/\/anilist.co\/anime\/154587"}]}}}"#;

    #[test]
    fn resolve_keeps_list_order_and_reports_missing() {
        let list = [Wanted::AniList(209872), Wanted::Name("Ранма".into()), Wanted::Name("Фрирен".into()), Wanted::Mal(1), Wanted::Mal(59978)];
        let (found, missing) = parse_resolve(RESOLVE, &list).unwrap();
        assert_eq!(found.iter().map(|a| a.id).collect::<Vec<_>>(), vec![209872, 154587, 182255]);
        assert_eq!(missing, vec!["Ранма".to_owned(), "MAL 1".to_owned()]);
        assert_eq!(found[1].name(false), "Фрирен", "по-русски — как ввёл пользователь");
        assert_eq!(found[1].name(true), "Frieren: Beyond Journey\u{2019}s End");
        assert_eq!(found[2].name(false), "Sousou no Frieren 2nd Season", "английского нет — ромадзи");
        assert_eq!(found[0].url, "https://anilist.co/anime/209872");
        assert_eq!(parse_resolve(r#"{"errors":[{"message":"Not Found."}],"data":null}"#, &list), None);
        assert_eq!(parse_resolve("<html>", &list), None);
    }

    #[test]
    fn typed_latin_name_does_not_replace_english_in_russian() {
        let a = Anime { id: 1, romaji: "Sousou no Frieren".into(), english: Some("Frieren".into()), typed: Some("frieren".into()), url: String::new() };
        assert_eq!(a.name(false), "Frieren");
    }

    /// Ответ AniList 8 ноября 2026 на расписание двух тайтлов.
    const SCHEDULE: &str = r#"{"data":{"Page":{"airingSchedules":[{"mediaId":209872,"episode":6,"airingAt":1794066960},{"mediaId":202250,"episode":6,"airingAt":1794069000}]}}}"#;

    #[test]
    fn schedule_is_parsed() {
        let e = parse_schedule(SCHEDULE).unwrap();
        assert_eq!(e[0], Episode { media: 209872, episode: 6, at: 1_794_066_960 });
        assert_eq!(e.len(), 2);
        assert_eq!(parse_schedule(r#"{"data":{"Page":{"airingSchedules":[]}}}"#), Some(vec![]));
        assert_eq!(parse_schedule(r#"{"errors":[{"message":"Too Many Requests."}],"data":null}"#), None);
        let q = schedule_query(&[209872, 202250], 10, 20);
        assert!(q.contains("mediaId_in: [209872, 202250], airingAt_greater: 10, airingAt_lesser: 20"), "{q}");
    }
}
