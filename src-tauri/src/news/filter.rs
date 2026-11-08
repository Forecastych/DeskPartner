//! Что кошке рассказывать нельзя: тяжёлое (смерти, катастрофы, войны, преступления,
//! политика), реклама и пустой кликбейт. И какие заголовки общей ленты подходят теме.
//!
//! Слова сравниваются по началу слова в нижнем регистре, ё = е: «погиб» ловит «погибли»
//! и «погибших», но не «непогибший» внутри другого слова. `$` на конце — только слово
//! целиком («умер$» не ловит «умеренный»). Пробел внутри — фраза целиком.
//!
//! Английский список — не перевод русского: в английском одно слово чаще значит разное.
//! «dead» есть в Dead Space, «war» — в God of War, «death» — в Death Stranding, «shooting» —
//! это ещё и съёмки фильма, «injury» — обычная спортивная новость, а Hurricanes и Avalanche —
//! хоккейные клубы. Поэтому там почти везде слово целиком или фраза.

/// Тяжёлое: о таком кошка радостно не рассказывает. Лучше лишний раз промолчать.
const HEAVY: &[&str] = &[
    // смерть
    "погиб", "гибел", "умер$", "умерла$", "умерли$", "умерш", "умира", "смерт", "скончал", "некролог", "похорон",
    "труп", "тело найден", "тела найден",
    // насилие и преступления
    "убий", "убит", "убил", "убива", "застрел", "расстрел", "стрельб", "выстрел", "зарез", "избил", "избиени",
    "насили", "изнасил", "похищ", "похитил", "заложник", "теракт", "террор", "преступ", "уголовн", "приговор",
    "осужд", "осудил", "арест", "задержан", "тюрьм", "тюремн", "мошенн", "краж", "украл", "грабит", "ограбл",
    "наркот", "педофил", "самоубий", "суицид", "казн",
    // беды
    "авари", "катастроф", "крушени", "взрыв", "пожар", "сгорел", "наводнени", "землетрясени", "цунами",
    "ураган", "торнадо", "смерч", "оползн", "лавин", "эпидеми", "пандеми", "трагед", "трагич", "жертв", "пострадавш",
    "ранен", "ранил", "госпитализ", "реанимац",
    // война
    // «бомбардир» — это футбол, «боевик» — жанр кино: их не трогаем
    "войн", "воен", "фронт$", "обстрел", "бомба$", "бомбы$", "бомбу$", "бомбеж", "бомбардировк", "дрон",
    "беспилотн", "всу$", "сво$", "мобилиз", "оккупа", "хусит", "хамас", "ядерн оруж", "гиперзвук", "перехватчик",
    "пво$",
    // политика: кошка вне её. «трамп» целиком — иначе зацепит «трамплин»
    "путин", "зеленск", "трамп$", "трампа$", "трампу$", "трампом$", "байден", "кремл", "санкци", "госдум",
    "депутат", "митинг",
    // English: смерть
    "dies$", "died$", "dead at", "found dead", "shot dead", "death of", "deaths$", "death toll", "to death",
    "death penalty", "passed away", "passes away", "obituary", "funeral", "mourn",
    // насилие и преступления
    "kill$", "killed$", "killing$", "killings$", "murder", "suicide", "massacre", "genocide", "stabbed$", "stabbing", "kidnap", "abduct",
    "hostage", "terror", "mass shooting", "school shooting", "fatal shooting", "opened fire", "gunman", "gunmen",
    "rape$", "raped$", "rapist", "abuse", "assault", "arrested$", "arrest$", "arrests$", "convicted", "sentenced",
    "prison", "jail$", "jailed$", "fraud", "overdose", "trafficking",
    // беды
    "car crash", "plane crash", "air crash", "train crash", "helicopter crash", "fatally", "explosion", "disaster",
    "tragedy", "tragic", "victim", "seriously injured", "critically injured", "hospitalised", "hospitalized",
    "wildfire", "flooding", "floods$", "earthquake", "hurricane$", "tornado", "tsunami", "famine", "pandemic",
    "epidemic", "cancer",
    // война
    "at war", "civil war", "world war", "war crime", "invasion", "troops$", "airstrike", "air strike", "drone strike",
    "bombing", "shelling", "military", "missile", "ceasefire", "gaza$", "hamas$", "hezbollah", "refugee",
    // политика: «senator$» целиком — Ottawa Senators играют в хоккей
    "trump$", "biden$", "putin$", "zelensky", "sanctions$", "tariff", "election", "congress", "parliament",
    "prime minister", "white house", "senator$",
    // суды и увольнения
    "allegation", "lawsuit", "sued$", "sues$", "layoff", "laid off", "racism", "racist",
];

/// Реклама, распродажи, ставки и подборки «что купить».
/// «Промоутер» в боксе, «розыгрыш Кубка» и «конкурс Чайковского» — не реклама, поэтому без них.
/// По-английски так же: «promoted» — выход в Премьер-лигу, «deal» — контракт игрока,
/// «buy» — покупка компании, «sale» — продажа картины на аукционе, «odds» — «вопреки всему».
const ADS: &[&str] = &[
    "реклам", "промо$", "промоакци", "промокод", "партнерск", "спонсор", "erid", "скидк", "распродаж",
    "купить", "кэшбэк", "кешбэк", "акция$", "акции$", "подписк", "черная пятница",
    "sponsored", "promoted content", "advertis", "partner content", "promo$", "promo code", "promotional",
    "affiliate", "deals$", "deal of the day", "flash sale", "on sale now", "coupon", "discount", "gift$", "gifts$",
    "gift guide", "buy now", "where to buy", "black friday", "cyber monday", "prime day", "price cut",
    "lowest price", "all-time low", "giveaway", "betting", "best bets", "best odds", "odds boost", "parlay",
    "sportsbook", "now accepting", "accepting applications", "apply now",
];

/// Не новость, а повод кликнуть или формат без смысла для облачка.
const BAIT_ANYWHERE: &[&str] = &[
    // «шок$», а не «шок»: иначе пропадёт шоколад; «выпуск$» — иначе «Apple выпускает…»
    "шок$", "шокир", "сенсаци", "не поверите", "фотогалере", "трансляци", "онлайн$", "видео:", "тест:", "тест на",
    "викторин", "опрос", "подкаст", "выпуск$", "гороскоп", "диетолог", "похуд",
    // «Ветеринар раскрыла симптом…» — формат Ленты; «учёные раскрыли механизм» оставляем
    "раскрыл$", "раскрыла$",
    // English: «gallery» без «photo» не трогаем — National Gallery это искусство
    "won't believe", "jaw-dropping", "mind-blowing", "quiz", "live:", "live blog", "live updates", "as it happened",
    "– live", "— live", "horoscope", "podcast", "newsletter", "in pictures", "in photos", "photos:", "photo gallery",
    "– video", "— video", "video:", "watch:", "ending explained", "recap$", "spoilers", "crossword", "wordle",
    "sudoku", "you should",
];

/// Кликбейт, если с этого заголовок начинается: «Назван простой способ…», «Вот почему…».
/// Сравнивается с началом строки, поэтому «назван» ловит и «названы», и «названа».
const BAIT_START: &[&str] = &[
    "назван", "раскрыт", "раскрыл", "выяснилось", "стало известно", "вот почему", "вот что", "вот как",
    "что будет", "here's why", "this is why", "here's what", "here's how", "you need", "what happens",
    "everything we know", "everything you need", "what to know", "how to watch", "where to watch", "where to buy",
    "the best ", "best ",
];

/// Короче — не мысль, а обрывок: «Месяц волшебства».
const MIN_CHARS: usize = 20;
const MIN_WORDS: usize = 3;

fn norm(s: &str) -> String {
    s.to_lowercase().replace('ё', "е").replace('’', "'")
}

/// Слова заголовка: буквы и цифры, дефис внутри слова сохраняем («мини-сериал»).
fn words(s: &str) -> Vec<&str> {
    s.split(|c: char| !(c.is_alphanumeric() || c == '-')).map(|w| w.trim_matches('-')).filter(|w| !w.is_empty()).collect()
}

/// Есть ли в нормализованном заголовке хоть одно слово из списка (правила — в шапке файла).
fn hits(text: &str, list: &[&str]) -> bool {
    let ws = words(text);
    // для фраз: слова через одиночный пробел, с пробелами по краям
    let spaced = format!(" {} ", text.split_whitespace().collect::<Vec<_>>().join(" "));
    list.iter().any(|k| {
        if k.contains(' ') || !k.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '$') {
            spaced.contains(&format!(" {}", k))
        } else if let Some(exact) = k.strip_suffix('$') {
            ws.contains(&exact)
        } else {
            ws.iter().any(|w| w.starts_with(k))
        }
    })
}

/// Тяжёлая тема.
pub fn heavy(title: &str) -> bool {
    hits(&norm(title), HEAVY)
}

/// Реклама или распродажа (без проверки длины и кликбейта: анонсы игр бывают короткими).
pub fn ad(title: &str) -> bool {
    hits(&norm(title), ADS)
}

/// Реклама, кликбейт или слишком короткий.
pub fn junk(title: &str) -> bool {
    let t = norm(title);
    let short = t.chars().count() < MIN_CHARS || words(&t).len() < MIN_WORDS;
    short || hits(&t, ADS) || hits(&t, BAIT_ANYWHERE) || BAIT_START.iter().any(|b| t.starts_with(b))
}

/// Годится ли заголовок общей ленты для темы (по словам темы из feeds.rs).
pub fn fits(title: &str, words: &[&str]) -> bool {
    hits(&norm(title), words)
}

/// Можно рассказывать.
pub fn ok(title: &str) -> bool {
    !heavy(title) && !junk(title)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::news::feeds::topic_words;

    #[test]
    fn heavy_news_is_dropped() {
        for t in [
            "Футболист погиб в аварии под Москвой",
            "В Индии умерла старейшая слониха",
            "Теракт в аэропорту: число жертв растёт",
            "Хуситы заявили об атаке дрона на аэропорт",
            "Мужчина опоил туристку и изнасиловал её",
            "Торнадо выбил стёкла в аэропорту Бразилии",
            "Деньги Распутина: куда они пропали после его смерти",
            "Путин заявил о политизированных ограничениях спорта",
            "Европа испытает перехватчик гиперзвуковых ракет в 2029 году",
            "Actor dies at 84 after long illness",
            "Three killed in highway crash",
            "Why pharma firms are going to orbit in search of cancer drugs",
            "Mass shooting at a shopping mall in Texas",
            "Death toll rises after the earthquake in Turkey",
            "Former footballer found dead at his home",
            "Trump's tariffs hit console prices again",
            "Gaza ceasefire talks resume in Cairo",
            "Studio founder arrested over fraud claims",
            "Hunters were paid to kill newborn wolf pups, records show",
            "Trial in forest guardian killing delayed again",
        ] {
            assert!(heavy(t), "пропустили тяжёлое: {t}");
        }
    }

    #[test]
    fn harmless_news_stays() {
        for t in [
            "Умеренный рост: «Зенит» прибавил в обороне",
            "Бомбардир «Спартака» оформил хет-трик в Кубке",
            "Астрономы обнаружили систему с будущим слиянием нейтронных звёзд",
            "Капризов и Шестеркин — в топ-9 претендентов на Зал славы",
            "Webb spots a new exoplanet with an oxygen atmosphere",
            "Захватывающий финал: Алькарас вышел в полуфинал",
            "Dead Space remake gets a surprise sequel teaser",
            "Star Wars: Andor creator returns for a new series",
            "God of War studio teases its next big project",
            "Dying Light: The Beast adds a co-op horde mode",
            "Death Stranding 2 lands on PC next spring",
            "Gifted teen striker signs a new five-year deal",
            "Trumpet player joins the London Symphony Orchestra",
            "Ari Aster starts shooting his new horror film",
            "Saka injury update: Arsenal winger back in training",
            "Carolina Hurricanes extend their winning streak to seven",
            "Nvidia agrees to buy a chip startup for $2bn",
            "Promoted side stun the champions at Anfield",
            "National Gallery reopens its Renaissance wing",
        ] {
            assert!(!heavy(t), "зря выкинули: {t}");
            assert!(!junk(t), "зря выкинули как мусор: {t}");
        }
    }

    #[test]
    fn ads_and_bait_are_dropped() {
        for t in [
            "Партнёрский материал: лучшие ноутбуки этой осени",
            "Скидки до 70% на игры в цифровом магазине",
            "Book Riot's Deals of the Day for November 5",
            "Best Online Cooking Classes to Gift Your Favorite Cook",
            "Назван простой способ ускорить похудение без лекарств",
            "Вот почему кошки любят коробки больше игрушек",
            "Фотогалерея: Гран-при Сан-Паулу, четверг",
            "Лазер-шоу «Три дебила». Выпуск 750: всё о новинках",
            "От подкладов до бегемотов: тест на знание магических верований",
            "Ветеринар раскрыла указывающий на деменцию у кошки симптом",
            "PS5 hits its lowest price ever for Black Friday",
            "Everything we know about the next Zelda so far",
            "How to watch the Champions League final online",
            "Premier League best bets and betting tips for the weekend",
            "Wordle today: hints and the answer for November 6",
            "Severance season 2 ending explained, scene by scene",
            "The best mechanical keyboards for every budget",
            "Digital Arts MFA Program Now Accepting Applications",
            "10 new albums you should listen to now",
        ] {
            assert!(junk(t), "пропустили мусор: {t}");
        }
        assert!(!junk("Учёные раскрыли механизм памяти у пчёл"));
    }

    #[test]
    fn too_short_is_junk() {
        assert!(junk("Месяц волшебства"));
        assert!(junk("Очень-очень-длинное-слово-без-пробелов"));
        assert!(!junk("Ари Астер начал съёмки «Козла отпущения»"));
    }

    #[test]
    fn general_feed_words() {
        let space = topic_words("космос", "ru");
        assert!(fits("Самая сильная за месяц вспышка произошла на Солнце", space));
        assert!(fits("Европа запустит ракету к Марсу в 2029 году", space));
        assert!(!fits("Назван простой способ ускорить похудение", space));
        let pets = topic_words("животные", "ru");
        assert!(fits("Наблюдавшие за дракой мыши уходили готовыми к бою", pets));
        assert!(fits("Ёжик и кот подружились в приюте", pets));
        assert!(!fits("Китай построит новую обсерваторию", pets), "кит — не Китай");
        assert!(!fits("Мышцы растут быстрее после сна", pets), "мышь — не мышца");
        let tv = topic_words("сериалы", "ru");
        assert!(fits("Стартовали съёмки сериала о подвиге ополчения", tv));
        assert!(fits("Второй сезон «Одни из нас» получил дату", tv));
        assert!(!fits("Ари Астер начал съёмки «Козла отпущения»", tv));
    }

    #[test]
    fn english_feed_words() {
        let esports = topic_words("киберспорт", "en");
        assert!(fits("NaVi win IEM Cologne after a five-map final", esports));
        assert!(fits("Valorant Champions: Sentinels lock in their roster", esports));
        assert!(!fits("Twitch streamer reacts to the new iPhone", esports));
        let pets = topic_words("животные", "en");
        assert!(fits("Humpback whales sing in new dialects, study finds", pets));
        assert!(fits("Why cats knead: researchers have an answer", pets));
        assert!(!fits("New drug reverses memory loss in mice", pets), "опыты на мышах — не про зверей");
        assert!(!fits("Catalyst turns plastic waste into fuel", pets), "cat — не catalyst");
        assert!(topic_words("космос", "en").is_empty(), "у английского космоса нет общих лент");
    }
}
