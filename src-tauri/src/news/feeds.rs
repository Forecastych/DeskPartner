//! Откуда кошка берёт новости: публичные RSS/Atom-ленты без ключей и регистрации.
//! Каждую проверяли руками (200, валидный XML в UTF-8, свежие записи) 2026-11-05/06;
//! ручной прогон всех разом — `cargo test -- --ignored live_feeds --nocapture`.
//!
//! У каждой темы есть и русская, и английская лента: качаются только ленты на языке
//! интерфейса (news/mod.rs), так что тема не пустеет ни в одном из них.
//!
//! Лента либо целиком про тему (`words: false`), либо общая — тогда в тему идут только
//! заголовки со словами из `topic_words` (`words: true`). Одна общая лента может кормить
//! несколько тем: качается она всё равно один раз.

pub struct Feed {
    /// Тема из списка settings.ts, ровно как там написана.
    pub topic: &'static str,
    pub url: &'static str,
    /// "ru" или "en".
    pub lang: &'static str,
    /// Короткое имя для реплики: «Пишут: … (Чемпионат)».
    pub source: &'static str,
    /// Общая лента: в тему только заголовки со словами темы.
    pub words: bool,
}

const fn whole(topic: &'static str, lang: &'static str, source: &'static str, url: &'static str) -> Feed {
    Feed { topic, url, lang, source, words: false }
}

const fn by_words(topic: &'static str, lang: &'static str, source: &'static str, url: &'static str) -> Feed {
    Feed { topic, url, lang, source, words: true }
}

pub const TOPICS: [&str; 24] = [
    "футбол",
    "хоккей",
    "баскетбол",
    "теннис",
    "формула 1",
    "единоборства",
    "киберспорт",
    "игры",
    "аниме",
    "кино",
    "сериалы",
    "музыка",
    "книги",
    "космос",
    "наука",
    "техника",
    "программирование",
    "история",
    "животные",
    "природа",
    "путешествия",
    "еда",
    "искусство",
    "авто",
];

const LENTA_SCIENCE: &str = "https://lenta.ru/rss/news/science";
const NAKED_SCIENCE: &str = "https://naked-science.ru/feed";
const KINONEWS: &str = "https://www.kinonews.ru/rss/";
const KG_PORTAL: &str = "https://kg-portal.ru/rss/news.rss";
const SCIENCE_DAILY: &str = "https://www.sciencedaily.com/rss/top/science.xml";

pub const FEEDS: &[Feed] = &[
    whole("футбол", "ru", "Чемпионат", "https://www.championat.com/rss/news/football/"),
    whole("футбол", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=208"),
    whole("футбол", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml"),
    whole("футбол", "en", "The Guardian", "https://www.theguardian.com/football/rss"),
    whole("хоккей", "ru", "Чемпионат", "https://www.championat.com/rss/news/hockey/"),
    whole("хоккей", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=209"),
    whole("хоккей", "en", "ESPN", "https://www.espn.com/espn/rss/nhl/news"),
    whole("хоккей", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/ice-hockey/rss.xml"),
    whole("баскетбол", "ru", "Чемпионат", "https://www.championat.com/rss/news/basketball/"),
    whole("баскетбол", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=210"),
    whole("баскетбол", "en", "ESPN", "https://www.espn.com/espn/rss/nba/news"),
    whole("баскетбол", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/basketball/rss.xml"),
    whole("теннис", "ru", "Чемпионат", "https://www.championat.com/rss/news/tennis/"),
    whole("теннис", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=212"),
    whole("теннис", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/tennis/rss.xml"),
    whole("теннис", "en", "The Guardian", "https://www.theguardian.com/sport/tennis/rss"),
    whole("формула 1", "ru", "F1News", "https://www.f1news.ru/export/news.xml"),
    // рубрика «авто» у Чемпионата — это автоспорт, почти весь про Формулу 1
    whole("формула 1", "ru", "Чемпионат", "https://www.championat.com/rss/news/auto/"),
    whole("формула 1", "en", "Autosport", "https://www.autosport.com/rss/f1/news/"),
    whole("формула 1", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/formula1/rss.xml"),
    whole("единоборства", "ru", "Чемпионат", "https://www.championat.com/rss/news/boxing/"),
    whole("единоборства", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=213"),
    whole("единоборства", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/boxing/rss.xml"),
    whole("единоборства", "en", "BBC Sport", "https://feeds.bbci.co.uk/sport/mixed-martial-arts/rss.xml"),
    whole("киберспорт", "ru", "Cybersport.ru", "https://www.cybersport.ru/rss/materials"),
    whole("киберспорт", "ru", "Чемпионат", "https://www.championat.com/rss/news/cybersport/"),
    whole("киберспорт", "en", "HLTV", "https://www.hltv.org/rss/news"),
    // у Dexerto вперемешку стримеры, кино и железо: в тему — только киберспорт по словам
    by_words("киберспорт", "en", "Dexerto", "https://www.dexerto.com/feed/"),
    whole("игры", "ru", "StopGame", "https://rss.stopgame.ru/rss_news.xml"),
    whole("игры", "ru", "Игромания", "https://www.igromania.ru/rss/news.xml"),
    whole("игры", "en", "Eurogamer", "https://www.eurogamer.net/feed"),
    whole("игры", "en", "Rock Paper Shotgun", "https://www.rockpapershotgun.com/feed"),
    whole("игры", "en", "GameSpot", "https://www.gamespot.com/feeds/news/"),
    whole("аниме", "ru", "Шикимори", "https://shikimori.io/forum/news.rss"),
    whole("аниме", "en", "Anime News Network", "https://www.animenewsnetwork.com/news/rss.xml"),
    whole("кино", "ru", "KinoNews", KINONEWS),
    whole("кино", "ru", "Film.ru", "https://www.film.ru/rss.xml"),
    whole("кино", "ru", "КГ-Портал", KG_PORTAL),
    whole("кино", "en", "The Guardian", "https://www.theguardian.com/film/rss"),
    whole("кино", "en", "Variety", "https://variety.com/v/film/feed/"),
    whole("кино", "en", "/Film", "https://www.slashfilm.com/feed/"),
    // отдельной русской ленты про сериалы не нашлось: берём сериальное из кинолент
    by_words("сериалы", "ru", "KinoNews", KINONEWS),
    by_words("сериалы", "ru", "КГ-Портал", KG_PORTAL),
    whole("сериалы", "en", "TVLine", "https://tvline.com/feed/"),
    whole("сериалы", "en", "The Guardian", "https://www.theguardian.com/tv-and-radio/rss"),
    whole("музыка", "ru", "InterMedia", "https://www.intermedia.ru/rss/news.xml"),
    whole("музыка", "en", "Pitchfork", "https://pitchfork.com/feed/feed-news/rss"),
    whole("книги", "ru", "Год Литературы", "https://godliteratury.ru/rss"),
    whole("книги", "en", "The Guardian", "https://www.theguardian.com/books/rss"),
    whole("космос", "ru", "Naked Science", "https://naked-science.ru/article/category/astronomy/feed"),
    by_words("космос", "ru", "Лента.ру", LENTA_SCIENCE),
    whole("космос", "en", "Space.com", "https://www.space.com/feeds.xml"),
    whole("космос", "en", "NASA", "https://www.nasa.gov/feed/"),
    whole("наука", "ru", "N + 1", "https://nplus1.ru/rss"),
    whole("наука", "ru", "Naked Science", NAKED_SCIENCE),
    whole("наука", "ru", "Элементы", "https://elementy.ru/rss/news"),
    whole("наука", "en", "ScienceDaily", SCIENCE_DAILY),
    whole("наука", "en", "The Guardian", "https://www.theguardian.com/science/rss"),
    whole("наука", "en", "Phys.org", "https://phys.org/rss-feed/"),
    whole("техника", "ru", "3DNews", "https://3dnews.ru/news/rss/"),
    whole("техника", "ru", "iXBT", "https://www.ixbt.com/export/news/rss.xml"),
    whole("техника", "en", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    whole("техника", "en", "The Verge", "https://www.theverge.com/rss/index.xml"),
    whole("техника", "en", "The Guardian", "https://www.theguardian.com/technology/rss"),
    whole("программирование", "ru", "Хабр", "https://habr.com/ru/rss/flows/develop/articles/"),
    whole("программирование", "ru", "Хабр", "https://habr.com/ru/rss/hub/programming/all/"),
    whole("программирование", "en", "InfoQ", "https://feed.infoq.com/"),
    whole("программирование", "en", "GitHub Blog", "https://github.blog/feed/"),
    whole("программирование", "en", "Stack Overflow", "https://stackoverflow.blog/feed/"),
    whole("история", "ru", "Русская семёрка", "https://russian7.ru/feed/"),
    whole("история", "ru", "Арзамас", "https://arzamas.academy/feed_v1.rss"),
    whole("история", "ru", "Naked Science", "https://naked-science.ru/article/category/history/feed"),
    whole("история", "en", "HistoryExtra", "https://www.historyextra.com/feed/"),
    // русской ленты именно про животных не нашлось: зверей выбираем из научных по словам
    by_words("животные", "ru", "Naked Science", "https://naked-science.ru/article/category/biology/feed"),
    by_words("животные", "ru", "Naked Science", NAKED_SCIENCE),
    by_words("животные", "ru", "Лента.ру", LENTA_SCIENCE),
    whole("животные", "en", "The Guardian", "https://www.theguardian.com/environment/wildlife/rss"),
    by_words("животные", "en", "ScienceDaily", SCIENCE_DAILY),
    whole("природа", "ru", "Экосфера", "https://ecosphere.press/feed/"),
    whole("природа", "en", "The Guardian", "https://www.theguardian.com/environment/rss"),
    whole("природа", "en", "Mongabay", "https://news.mongabay.com/feed/"),
    whole("путешествия", "ru", "TourDom", "https://www.tourdom.ru/rss/"),
    whole("путешествия", "ru", "Лента.ру", "https://lenta.ru/rss/news/travel"),
    whole("путешествия", "en", "The Guardian", "https://www.theguardian.com/travel/rss"),
    whole("еда", "ru", "Гастроном", "https://www.gastronom.ru/rss"),
    whole("еда", "en", "The Kitchn", "https://www.thekitchn.com/main.rss"),
    whole("еда", "en", "The Guardian", "https://www.theguardian.com/food/rss"),
    whole("искусство", "ru", "The Art Newspaper", "https://www.theartnewspaper.ru/rss/"),
    by_words("искусство", "ru", "Лента.ру", "https://lenta.ru/rss/news/culture"),
    whole("искусство", "en", "Hyperallergic", "https://hyperallergic.com/feed/"),
    whole("искусство", "en", "ARTnews", "https://www.artnews.com/feed/"),
    whole("авто", "ru", "Колёса.ру", "https://www.kolesa.ru/export/rss.xml"),
    whole("авто", "ru", "5 колесо", "https://5koleso.ru/feed/"),
    whole("авто", "en", "Car and Driver", "https://www.caranddriver.com/rss/all.xml/"),
    whole("авто", "en", "Motor1", "https://www.motor1.com/rss/news/all/"),
];

/// Слова темы для общих лент на языке ленты. Правила сравнения — в filter.rs: начало слова,
/// `$` на конце — слово целиком, пробел внутри — фраза.
pub fn topic_words(topic: &str, lang: &str) -> &'static [&'static str] {
    match (topic, lang) {
        ("сериалы", "ru") => &["сериал", "сезон", "шоураннер", "эпизод", "мини-сериал"],
        ("космос", "ru") => &[
            "космос", "космич", "космонавт", "астронавт", "мкс$", "астроном", "телескоп", "марс", "луна$",
            "луну$", "луне$", "луны$", "лунн", "галактик", "планет", "экзопланет", "звезд", "ракет", "спутник",
            "nasa$", "наса$", "роскосмос", "орбит", "солнц", "комет", "астероид", "метеор", "вселенн",
            "черная дыра", "черной дыры", "черные дыры",
        ],
        ("животные", "ru") => &[
            "животн", "зверь", "звери", "кошк", "кошек", "котов", "котят", "кот$", "кота$", "собак", "пес$",
            "щен", "птиц", "кит$", "кита$", "киты$", "китов$", "дельфин", "медвед", "волк", "лиса$", "лисы$",
            "тигр", "лев$", "льва$", "львы$", "львиц", "панда$", "панды$", "слон", "жираф", "обезьян", "шимпанзе", "горилл", "насеком", "пчел",
            "муравь", "бабочк", "жук", "рыб", "акул", "змей", "змея$", "ящериц", "черепах", "лягуш", "амфиби",
            "зоопарк", "динозавр", "млекопитающ", "попуга", "пингвин", "мышь$", "мыши$", "мышей$", "крыс", "енот", "осьминог",
            "гусениц", "ворон", "сов$", "совы$", "лошад", "коров", "оленей", "олень", "лемур", "пауки", "паук$",
        ],
        ("искусство", "ru") => &[
            "выставк", "музей", "музея$", "музее$", "художник", "художниц", "живопис", "скульпт", "галере",
            "эрмитаж", "третьяков", "пушкинск", "аукцион", "полотн", "фреск", "биеннале", "инсталляци",
        ],
        ("киберспорт", "en") => &[
            "esport", "e-sport", "counter-strike", "cs2$", "valorant", "league of legends", "dota", "overwatch league",
            "rainbow six siege", "rocket league", "tournament", "roster", "pro player", "pro team", "major$", "worlds$",
            "lck$", "lec$", "lcs$", "vct$", "iem$", "blast premier", "esl$", "navi$", "faze$", "fnatic", "t1$",
            "g2$", "vitality", "team liquid", "cloud9", "sentinels",
        ],
        // без «mice» и «rats»: у ScienceDaily это опыты на мышах, а не новости про зверей
        ("животные", "en") => &[
            "animal", "wildlife", "mammal", "bird", "dog$", "dogs$", "pupp", "cat$", "cats$", "kitten", "feline",
            "canine", "whale", "dolphin", "bear$", "bears$", "wolf$", "wolves", "fox$", "foxes$", "tiger", "lion$",
            "lions$", "elephant", "giraffe", "monkey", "ape$", "apes$", "chimp", "gorilla", "primate", "insect",
            "bee$", "bees$", "honeybee", "bumblebee", "ant$", "ants$", "butterfl", "beetle", "fish$", "fishes$",
            "shark", "snake", "lizard", "turtle", "tortoise", "frog", "amphibian", "reptile", "zoo$", "zoos$",
            "dinosaur", "parrot", "penguin", "raccoon", "octopus", "squid", "caterpillar", "crow$", "crows$", "owl$",
            "owls$", "horse", "deer$", "lemur", "spider", "bat$", "bats$", "otter", "seal$", "seals$",
        ],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_topic_has_a_feed_and_every_feed_a_topic() {
        for t in TOPICS {
            assert!(FEEDS.iter().any(|f| f.topic == t), "нет ленты для темы {t}");
        }
        for f in FEEDS {
            assert!(TOPICS.contains(&f.topic), "лента {} с чужой темой {}", f.url, f.topic);
            assert!(f.url.starts_with("https://"), "не https: {}", f.url);
            assert!(matches!(f.lang, "ru" | "en"), "язык {} у {}", f.lang, f.url);
            assert!(!f.words || !topic_words(f.topic, f.lang).is_empty(), "нет слов для темы {} ({})", f.topic, f.lang);
        }
    }

    #[test]
    fn every_topic_has_a_feed_in_both_languages() {
        for t in TOPICS {
            for lang in ["ru", "en"] {
                assert!(FEEDS.iter().any(|f| f.topic == t && f.lang == lang), "нет ленты для темы {t} на {lang}");
            }
        }
    }

    #[test]
    fn same_feed_is_not_listed_twice_for_one_topic() {
        for (i, a) in FEEDS.iter().enumerate() {
            for b in &FEEDS[i + 1..] {
                assert!(!(a.url == b.url && a.topic == b.topic), "дубль {} / {}", a.url, a.topic);
            }
        }
    }
}
