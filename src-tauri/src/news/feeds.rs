//! Откуда кошка берёт новости: публичные RSS/Atom-ленты без ключей и регистрации.
//! Каждую проверяли руками (200, валидный XML в UTF-8, свежие записи) 2026-11-05;
//! ручной прогон всех разом — `cargo test -- --ignored live_feeds --nocapture`.
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

pub const FEEDS: &[Feed] = &[
    whole("футбол", "ru", "Чемпионат", "https://www.championat.com/rss/news/football/"),
    whole("футбол", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=208"),
    whole("хоккей", "ru", "Чемпионат", "https://www.championat.com/rss/news/hockey/"),
    whole("хоккей", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=209"),
    whole("баскетбол", "ru", "Чемпионат", "https://www.championat.com/rss/news/basketball/"),
    whole("баскетбол", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=210"),
    whole("теннис", "ru", "Чемпионат", "https://www.championat.com/rss/news/tennis/"),
    whole("теннис", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=212"),
    whole("формула 1", "ru", "F1News", "https://www.f1news.ru/export/news.xml"),
    // рубрика «авто» у Чемпионата — это автоспорт, почти весь про Формулу 1
    whole("формула 1", "ru", "Чемпионат", "https://www.championat.com/rss/news/auto/"),
    whole("формула 1", "en", "Autosport", "https://www.autosport.com/rss/f1/news/"),
    whole("единоборства", "ru", "Чемпионат", "https://www.championat.com/rss/news/boxing/"),
    whole("единоборства", "ru", "Sports.ru", "https://www.sports.ru/rss/rubric.xml?s=213"),
    whole("киберспорт", "ru", "Cybersport.ru", "https://www.cybersport.ru/rss/materials"),
    whole("киберспорт", "ru", "Чемпионат", "https://www.championat.com/rss/news/cybersport/"),
    whole("игры", "ru", "StopGame", "https://rss.stopgame.ru/rss_news.xml"),
    whole("игры", "ru", "Игромания", "https://www.igromania.ru/rss/news.xml"),
    whole("аниме", "ru", "Шикимори", "https://shikimori.io/forum/news.rss"),
    whole("аниме", "en", "Anime News Network", "https://www.animenewsnetwork.com/news/rss.xml"),
    whole("кино", "ru", "KinoNews", KINONEWS),
    whole("кино", "ru", "Film.ru", "https://www.film.ru/rss.xml"),
    whole("кино", "ru", "КГ-Портал", KG_PORTAL),
    // отдельной русской ленты про сериалы не нашлось: берём сериальное из кинолент
    by_words("сериалы", "ru", "KinoNews", KINONEWS),
    by_words("сериалы", "ru", "КГ-Портал", KG_PORTAL),
    whole("сериалы", "en", "TVLine", "https://tvline.com/feed/"),
    whole("музыка", "ru", "InterMedia", "https://www.intermedia.ru/rss/news.xml"),
    whole("музыка", "en", "Pitchfork", "https://pitchfork.com/feed/feed-news/rss"),
    whole("книги", "ru", "Год Литературы", "https://godliteratury.ru/rss"),
    whole("книги", "en", "The Guardian", "https://www.theguardian.com/books/rss"),
    whole("космос", "ru", "Naked Science", "https://naked-science.ru/article/category/astronomy/feed"),
    by_words("космос", "ru", "Лента.ру", LENTA_SCIENCE),
    whole("космос", "en", "Space.com", "https://www.space.com/feeds.xml"),
    whole("наука", "ru", "N + 1", "https://nplus1.ru/rss"),
    whole("наука", "ru", "Naked Science", NAKED_SCIENCE),
    whole("наука", "ru", "Элементы", "https://elementy.ru/rss/news"),
    whole("техника", "ru", "3DNews", "https://3dnews.ru/news/rss/"),
    whole("техника", "ru", "iXBT", "https://www.ixbt.com/export/news/rss.xml"),
    whole("программирование", "ru", "Хабр", "https://habr.com/ru/rss/flows/develop/articles/"),
    whole("программирование", "ru", "Хабр", "https://habr.com/ru/rss/hub/programming/all/"),
    whole("история", "ru", "Русская семёрка", "https://russian7.ru/feed/"),
    whole("история", "ru", "Арзамас", "https://arzamas.academy/feed_v1.rss"),
    whole("история", "ru", "Naked Science", "https://naked-science.ru/article/category/history/feed"),
    whole("история", "en", "HistoryExtra", "https://www.historyextra.com/feed/"),
    // русской ленты именно про животных не нашлось: зверей выбираем из научных по словам
    by_words("животные", "ru", "Naked Science", "https://naked-science.ru/article/category/biology/feed"),
    by_words("животные", "ru", "Naked Science", NAKED_SCIENCE),
    by_words("животные", "ru", "Лента.ру", LENTA_SCIENCE),
    whole("животные", "en", "The Guardian", "https://www.theguardian.com/environment/wildlife/rss"),
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
];

/// Слова темы для общих лент. Правила сравнения — в filter.rs: начало слова,
/// `$` на конце — слово целиком, пробел внутри — фраза.
pub fn topic_words(topic: &str) -> &'static [&'static str] {
    match topic {
        "сериалы" => &["сериал", "сезон", "шоураннер", "эпизод", "мини-сериал"],
        "космос" => &[
            "космос", "космич", "космонавт", "астронавт", "мкс$", "астроном", "телескоп", "марс", "луна$",
            "луну$", "луне$", "луны$", "лунн", "галактик", "планет", "экзопланет", "звезд", "ракет", "спутник",
            "nasa$", "наса$", "роскосмос", "орбит", "солнц", "комет", "астероид", "метеор", "вселенн",
            "черная дыра", "черной дыры", "черные дыры",
        ],
        "животные" => &[
            "животн", "зверь", "звери", "кошк", "кошек", "котов", "котят", "кот$", "кота$", "собак", "пес$",
            "щен", "птиц", "кит$", "кита$", "киты$", "китов$", "дельфин", "медвед", "волк", "лиса$", "лисы$",
            "тигр", "лев$", "льва$", "львы$", "львиц", "панда$", "панды$", "слон", "жираф", "обезьян", "шимпанзе", "горилл", "насеком", "пчел",
            "муравь", "бабочк", "жук", "рыб", "акул", "змей", "змея$", "ящериц", "черепах", "лягуш", "амфиби",
            "зоопарк", "динозавр", "млекопитающ", "попуга", "пингвин", "мышь$", "мыши$", "мышей$", "крыс", "енот", "осьминог",
            "гусениц", "ворон", "сов$", "совы$", "лошад", "коров", "оленей", "олень", "лемур", "пауки", "паук$",
        ],
        "искусство" => &[
            "выставк", "музей", "музея$", "музее$", "художник", "художниц", "живопис", "скульпт", "галере",
            "эрмитаж", "третьяков", "пушкинск", "аукцион", "полотн", "фреск", "биеннале", "инсталляци",
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
            assert!(!f.words || !topic_words(f.topic).is_empty(), "нет слов для темы {}", f.topic);
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
