//! Новости игр из Steam: что за игра в активном окне и что её разработчики объявили.
//!
//! Игру узнаём на компьютере, без сети. Запущена из библиотеки Steam (`…\steamapps\common\<папка>\`) —
//! номер игры (appid) и название лежат рядом, в `steamapps\appmanifest_<appid>.acf` той же
//! библиотеки. Иначе — по имени exe в маленьком справочнике популярных игр. Ни то ни другое
//! не совпало — не игра, по крайней мере для нас.
//!
//! Новости — ISteamNews/GetNewsForApp без ключа, только лента официальных анонсов
//! (`steam_community_announcements`): рядом в общей выдаче попадаются чужие СМИ. Наружу уходит
//! только appid. Анонсы пишутся на языке разработчика, поэтому язык заголовка проверяем сами:
//! не совпал с языком интерфейса — не показываем.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::filter;

/// Игра, как питомец её знает. `appid` нет — игры нет в Steam (Hearthstone): в игре мы её
/// узнаём и не мешаем, но новости спросить негде.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Game {
    pub appid: Option<u32>,
    pub name: String,
}

/// Справочник: имя exe в нижнем регистре, подсказка по пути (кусок пути в нижнем регистре —
/// у Path of Exile 1 и 2 одинаковые exe), appid и название.
const KNOWN: &[(&str, Option<&str>, Option<u32>, &str)] = &[
    ("cs2", None, Some(730), "Counter-Strike 2"),
    ("dota2", None, Some(570), "Dota 2"),
    ("pathofexile", Some("path of exile 2"), Some(2_694_490), "Path of Exile 2"),
    ("pathofexile_x64", Some("path of exile 2"), Some(2_694_490), "Path of Exile 2"),
    ("pathofexilesteam", Some("path of exile 2"), Some(2_694_490), "Path of Exile 2"),
    ("pathofexile_x64steam", Some("path of exile 2"), Some(2_694_490), "Path of Exile 2"),
    ("pathofexile", None, Some(238_960), "Path of Exile"),
    ("pathofexile_x64", None, Some(238_960), "Path of Exile"),
    ("pathofexilesteam", None, Some(238_960), "Path of Exile"),
    ("pathofexile_x64steam", None, Some(238_960), "Path of Exile"),
    ("bg3", None, Some(1_086_940), "Baldur's Gate 3"),
    ("bg3_dx11", None, Some(1_086_940), "Baldur's Gate 3"),
    ("eldenring", None, Some(1_245_620), "Elden Ring"),
    ("r5apex", None, Some(1_172_470), "Apex Legends"),
    ("r5apex_dx12", None, Some(1_172_470), "Apex Legends"),
    ("tslgame", None, Some(578_080), "PUBG: Battlegrounds"),
    ("rustclient", None, Some(252_490), "Rust"),
    ("destiny2", None, Some(1_085_660), "Destiny 2"),
    ("gta5", None, Some(271_590), "Grand Theft Auto V"),
    ("rocketleague", None, Some(252_950), "Rocket League"),
    ("terraria", None, Some(105_600), "Terraria"),
    ("stardew valley", None, Some(413_150), "Stardew Valley"),
    ("warframe.x64", None, Some(230_410), "Warframe"),
    ("witcher3", None, Some(292_030), "The Witcher 3"),
    ("cyberpunk2077", None, Some(1_091_500), "Cyberpunk 2077"),
    ("helldivers2", None, Some(553_850), "Helldivers 2"),
    ("factorio", None, Some(427_520), "Factorio"),
    ("overwatch", None, Some(2_357_570), "Overwatch 2"),
    // не в Steam: в игре узнаём, новостей не спрашиваем
    ("hearthstone", None, None, "Hearthstone"),
    ("wow", None, None, "World of Warcraft"),
    ("league of legends", None, None, "League of Legends"),
    ("valorant-win64-shipping", None, None, "Valorant"),
];

/// Имя exe без папки и расширения, в нижнем регистре.
fn stem(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path).to_lowercase();
    file.strip_suffix(".exe").map(str::to_owned).unwrap_or(file)
}

/// Папка `steamapps` библиотеки и имя папки игры, если exe лежит в `steamapps\common\<папка>\`.
fn library(path: &str) -> Option<(PathBuf, String)> {
    let low = path.to_lowercase().replace('/', "\\");
    let at = low.find("\\steamapps\\common\\")?;
    let rest = &path[at + "\\steamapps\\common\\".len()..];
    let folder = rest.split(['\\', '/']).next().filter(|f| !f.is_empty() && rest.len() > f.len())?;
    Some((PathBuf::from(&path[..at + "\\steamapps".len()]), folder.to_owned()))
}

/// Значения верхнего уровня из appmanifest_*.acf (формат VDF: `"ключ"  "значение"`):
/// appid, название и папка установки.
pub fn parse_acf(text: &str) -> Option<(u32, String, String)> {
    let mut appid = None;
    let mut name = None;
    let mut dir = None;
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        // `"key"\t\t"value"` режется кавычками на ["", key, "\t\t", value, ""]
        if parts.len() < 5 {
            continue;
        }
        let (key, value) = (parts[1].to_ascii_lowercase(), parts[3]);
        match key.as_str() {
            "appid" if appid.is_none() => appid = value.parse().ok(),
            "name" if name.is_none() => name = Some(value.to_owned()),
            "installdir" if dir.is_none() => dir = Some(value.to_owned()),
            _ => {}
        }
    }
    Some((appid?, name.filter(|n| !n.trim().is_empty())?, dir?))
}

/// Игра из библиотеки Steam по папке установки: перебираем манифесты рядом.
fn from_library(steamapps: &Path, folder: &str) -> Option<Game> {
    let dir = std::fs::read_dir(steamapps).ok()?;
    for e in dir.flatten() {
        let name = e.file_name().to_string_lossy().to_lowercase();
        if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        if let Some((appid, name, dir)) = parse_acf(&text) {
            if dir.eq_ignore_ascii_case(folder) {
                return Some(Game { appid: Some(appid), name });
            }
        }
    }
    None
}

/// Игра по полному пути exe; `None` — не игра (или незнакомая).
pub fn identify(path: &str) -> Option<Game> {
    if let Some(g) = library(path).and_then(|(lib, folder)| from_library(&lib, &folder)) {
        return Some(g);
    }
    let exe = stem(path);
    let low = path.to_lowercase();
    KNOWN
        .iter()
        .find(|(e, hint, _, _)| *e == exe && hint.map_or(true, |h| low.contains(h)))
        .map(|(_, _, appid, name)| Game { appid: *appid, name: (*name).to_owned() })
}

/// Адрес запроса: последние анонсы игры, без текста статей (maxlength=1 — только заголовки).
pub fn api_url(appid: u32) -> String {
    format!(
        "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid={appid}&count=5&maxlength=1&feeds=steam_community_announcements&format=json"
    )
}

/// Страница анонса в магазине Steam: адрес из выдачи ведёт через чужой CDN, этот — стабильный.
pub fn news_url(appid: u32, gid: &str) -> String {
    format!("https://store.steampowered.com/news/app/{appid}/view/{gid}")
}

/// Анонс из выдачи.
#[derive(Debug, Clone, PartialEq)]
pub struct Announcement {
    pub gid: String,
    pub title: String,
    pub date: i64,
    /// Steam пометил анонс как список изменений.
    pub patch: bool,
}

#[derive(Deserialize)]
struct Reply {
    appnews: AppNews,
}

#[derive(Deserialize)]
struct AppNews {
    #[serde(default)]
    newsitems: Vec<RawItem>,
}

#[derive(Deserialize)]
struct RawItem {
    #[serde(default)]
    gid: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    date: i64,
    #[serde(default)]
    feedname: String,
    #[serde(default)]
    tags: Vec<String>,
}

/// Разобрать ответ GetNewsForApp: только официальные анонсы с заголовком, номером и датой.
/// Не JSON или не та форма — `None` (как неудачная загрузка).
pub fn parse_news(json: &str) -> Option<Vec<Announcement>> {
    let reply: Reply = serde_json::from_str(json).ok()?;
    Some(
        reply
            .appnews
            .newsitems
            .into_iter()
            .filter(|i| i.feedname == "steam_community_announcements" && !i.gid.is_empty() && i.date > 0)
            .map(|i| Announcement {
                title: super::parse::clean_title(&i.title),
                patch: i.tags.iter().any(|t| t == "patchnotes") || patchy(&i.title),
                gid: i.gid,
                date: i.date,
            })
            .filter(|a| !a.title.is_empty())
            .collect(),
    )
}

/// Похоже на патч по словам заголовка, даже если Steam не поставил метку.
fn patchy(title: &str) -> bool {
    filter::fits(title, &["patch", "hotfix", "патч", "хотфикс", "обновлени"])
}

/// Не про игру: распродажи, мерч, твич-дропсы. Плюс общий фильтр тяжёлого и рекламы.
const OFF: &[&str] = &["sale$", "merch", "twitch drops", "keycap", "replica", "figuarts", "figure$", "figures$", "распродаж"];

/// Траур в студии. Общий фильтр тяжёлого к играм не годится: «Killing Floor», «Inside the
/// Trove of Terror», «Military Update» — это игры, а не сводки; поэтому — только этот список.
const SAD: &[&str] = &["passed away", "in memoriam", "in memory of", "mourn", "rest in peace", "скончал", "памяти", "трагед"];

/// Можно рассказывать: не реклама, не продажа сувениров, не траур.
pub fn tellable(title: &str) -> bool {
    !filter::ad(title) && !filter::fits(title, OFF) && !filter::fits(title, SAD)
}

/// Язык заголовка по алфавиту: кириллицы больше половины букв — "ru"; букв, кроме латиницы,
/// нет совсем — "en". Остальное (японский, немецкий с умляутами, смесь) — `None`, не покажем.
/// Немецкий без умляутов пройдёт за английский: эвристика, а не переводчик.
pub fn title_lang(title: &str) -> Option<&'static str> {
    let letters: Vec<char> = title.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return None;
    }
    let cyr = letters.iter().filter(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')).count();
    if cyr * 2 > letters.len() {
        return Some("ru");
    }
    letters.iter().all(|c| c.is_ascii_alphabetic()).then_some("en")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Сокращённый настоящий ответ для CS2 (8 ноября 2026) плюс запись чужой ленты.
    const CS2: &str = r#"{"appnews":{"appid":730,"newsitems":[
      {"gid":"1848557880481353","title":"Counter-Strike 2 Update","url":"https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1848557880481353","is_external_url":true,"author":"Vitaliy","contents":"\\...","feedlabel":"Community Announcements","date":1793840047,"feedname":"steam_community_announcements","feed_type":1,"appid":730,"tags":["patchnotes"]},
      {"gid":"1847920302232686","title":"The Armory &amp; You","url":"https://x","is_external_url":true,"author":"Vitaliy","contents":"","feedlabel":"Community Announcements","date":1793224089,"feedname":"steam_community_announcements","feed_type":1,"appid":730},
      {"gid":"555","title":"CS2 gets huge update, players furious","url":"https://pcgamer.example/x","is_external_url":true,"author":"","contents":"","feedlabel":"PC Gamer","date":1793224000,"feedname":"pcgamer","feed_type":0,"appid":730}
    ],"count":457}}"#;

    #[test]
    fn news_keeps_only_official_announcements() {
        let a = parse_news(CS2).unwrap();
        assert_eq!(a.len(), 2, "чужие СМИ не берём");
        assert_eq!(a[0], Announcement { gid: "1848557880481353".into(), title: "Counter-Strike 2 Update".into(), date: 1_793_840_047, patch: true });
        assert_eq!(a[1].title, "The Armory & You", "сущности раскрыты");
        assert!(!a[1].patch);
        assert_eq!(parse_news(r#"{"appnews":{"appid":1,"count":0}}"#), Some(vec![]), "пустая выдача — не ошибка");
        assert_eq!(parse_news("<html>502</html>"), None);
        assert_eq!(parse_news(r#"{"error":"bad appid"}"#), None);
    }

    #[test]
    fn patches_are_recognized_by_words_too() {
        assert!(patchy("Hotfix #36 Now Live!"));
        assert!(patchy("7.41f Gameplay Patch"));
        assert!(patchy("Вышло обновление 1.2"));
        assert!(!patchy("The International 2026 Grand Champions"));
    }

    #[test]
    fn off_topic_announcements_are_skipped() {
        for t in [
            "Steam Sale with our biggest discounts yet!",
            "Fall into the Steam Autumn Sale!",
            "ExileCon 2026 Twitch Drops",
            "Alexander, Warrior Jar Artisan Keycap has arrived!",
            "New Elden Ring Mini Replicas Arrive: Malenia, Messmer & Wylder",
            "In memory of our friend and colleague",
        ] {
            assert!(!tellable(t), "{t}");
        }
        for t in ["Path of Exile: Covens of Umbra Releases on November 13 PST!", "Counter-Strike 2 Update", "Inside the Trove of Terror", "Killing Floor 3: Military Update"] {
            assert!(tellable(t), "{t}");
        }
    }

    #[test]
    fn title_language_by_alphabet() {
        assert_eq!(title_lang("Counter-Strike 2 Update"), Some("en"));
        assert_eq!(title_lang("Hotfix #36 Now Live!"), Some("en"));
        assert_eq!(title_lang("Обновление 1.5: новые карты"), Some("ru"));
        assert_eq!(title_lang("Патч 7.41f для Dota 2"), Some("ru"), "латинские имена внутри русского заголовка");
        assert_eq!(title_lang("アップデートのお知らせ"), None);
        assert_eq!(title_lang("Großes Update für alle Spieler"), None, "умляут — не английский");
        assert_eq!(title_lang("Patch notes for Обновление"), None, "поровну — непонятно, молчим");
        assert_eq!(title_lang("1.0.2"), None);
    }

    #[test]
    fn acf_values_from_top_level() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"730\"\n\t\"universe\"\t\t\"1\"\n\t\"name\"\t\t\"Counter-Strike 2\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Counter-Strike Global Offensive\"\n\t\"UserConfig\"\n\t{\n\t\t\"name\"\t\t\"other\"\n\t}\n}\n";
        assert_eq!(parse_acf(acf), Some((730, "Counter-Strike 2".into(), "Counter-Strike Global Offensive".into())));
        assert_eq!(parse_acf("\"AppState\"\n{\n\t\"name\"\t\t\"x\"\n}"), None);
    }

    #[test]
    fn library_path_is_found_case_insensitively() {
        let (lib, folder) = library(r"D:\SteamLibrary\SteamApps\common\Hades II\Ship\Hades2.exe").unwrap();
        assert_eq!(lib, PathBuf::from(r"D:\SteamLibrary\SteamApps"));
        assert_eq!(folder, "Hades II");
        assert!(library(r"C:\Games\Hades II\Hades2.exe").is_none());
        assert!(library(r"D:\SteamLibrary\steamapps\common\game.exe").is_none(), "exe прямо в common — папки игры нет");
    }

    #[test]
    fn game_from_steam_library_manifest() {
        let root = std::env::temp_dir().join(format!("deskpartner-steam-{}", std::process::id()));
        let apps = root.join("steamapps");
        let game = apps.join("common").join("Hades II").join("Ship");
        std::fs::create_dir_all(&game).unwrap();
        std::fs::write(apps.join("appmanifest_1145350.acf"), "\"AppState\"\n{\n\t\"appid\"\t\t\"1145350\"\n\t\"name\"\t\t\"Hades II\"\n\t\"installdir\"\t\t\"Hades II\"\n}\n").unwrap();
        std::fs::write(apps.join("appmanifest_1.acf"), "битый файл").unwrap();
        let exe = game.join("Hades2.exe");
        let got = identify(&exe.to_string_lossy());
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(got, Some(Game { appid: Some(1_145_350), name: "Hades II".into() }));
    }

    #[test]
    fn game_from_builtin_list() {
        let g = |p: &str| identify(p).map(|g| (g.appid, g.name));
        assert_eq!(g(r"C:\Games\Counter-Strike\game\bin\win64\cs2.exe"), Some((Some(730), "Counter-Strike 2".into())));
        assert_eq!(g(r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile 2\PathOfExile.exe"), Some((Some(2_694_490), "Path of Exile 2".into())));
        assert_eq!(g(r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile\PathOfExile_x64.exe"), Some((Some(238_960), "Path of Exile".into())));
        assert_eq!(g(r"C:\Program Files (x86)\Hearthstone\Hearthstone.exe"), Some((None, "Hearthstone".into())), "не в Steam — игра без новостей");
        assert_eq!(g(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), None);
    }

    #[test]
    fn links_point_to_steam() {
        assert_eq!(news_url(730, "123"), "https://store.steampowered.com/news/app/730/view/123");
        assert!(api_url(570).contains("appid=570&") && api_url(570).contains("feeds=steam_community_announcements"));
    }
}
