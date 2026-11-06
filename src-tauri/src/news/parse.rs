//! Разбор RSS 2.0 и Atom и чистка заголовков. Из записи берём только заголовок, ссылку
//! и дату: описания, тексты и картинки чужие (авторское право), их не читаем и не храним.

use chrono::DateTime;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// Сырая запись ленты: заголовок уже чистый, дата — секунды Unix, если лента её дала.
#[derive(Debug, PartialEq)]
pub struct Entry {
    pub title: String,
    pub link: String,
    pub date: Option<i64>,
}

/// Длинней облачко не вмещает.
pub const TITLE_MAX: usize = 100;

#[derive(Clone, Copy, PartialEq)]
enum Field {
    Title,
    Link,
    Guid,
    /// pubDate, published, dc:date — когда вышло.
    Published,
    /// Atom updated — только если published нет.
    Updated,
}

#[derive(Default)]
struct Draft {
    title: Option<String>,
    link: Option<String>,
    guid: Option<String>,
    published: Option<i64>,
    updated: Option<i64>,
}

impl Draft {
    fn finish(self) -> Option<Entry> {
        let title = clean_title(self.title.as_deref()?);
        let link = self.link.or(self.guid).map(|l| decode_entities(l.trim()))?;
        let web = link.starts_with("https://") || link.starts_with("http://");
        (!title.is_empty() && web).then_some(Entry { title, link, date: self.published.or(self.updated) })
    }
}

fn field_of(name: &str) -> Option<Field> {
    Some(match name {
        "title" => Field::Title,
        "link" => Field::Link,
        "guid" => Field::Guid,
        "pubDate" | "published" | "dc:date" => Field::Published,
        "updated" => Field::Updated,
        _ => return None,
    })
}

/// href ссылки Atom, если это ссылка на саму статью (rel нет или alternate).
fn atom_href(e: &BytesStart) -> Option<String> {
    let mut href = None;
    let mut alternate = true;
    for a in e.html_attributes().flatten() {
        match a.key.as_ref() {
            "href" => href = Some(a.value.into_owned()),
            "rel" => alternate = a.value.as_ref() == "alternate",
            _ => {}
        }
    }
    href.filter(|h| alternate && !h.trim().is_empty())
}

/// Записи ленты по порядку. Битый XML — что успели разобрать до ошибки.
pub fn parse(xml: &str) -> Vec<Entry> {
    let mut r = Reader::from_str(xml.trim_start_matches('\u{feff}'));
    let c = r.config_mut();
    c.expand_empty_elements = true;
    c.check_end_names = false;
    c.allow_dangling_amp = true;
    c.allow_unmatched_ends = true;

    let mut out = Vec::new();
    let mut depth = 0usize;
    // глубина элемента item/entry и его черновик
    let mut entry: Option<(usize, Draft)> = None;
    // какое поле сейчас собираем и на какой глубине оно открылось
    let mut field: Option<(usize, Field)> = None;
    let mut text = String::new();
    loop {
        let ev = match r.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(ev) => ev,
        };
        match ev {
            Event::Start(e) => {
                depth += 1;
                let qname = e.name();
                let name = qname.as_ref();
                match (&mut entry, field) {
                    (None, _) if matches!(name, "item" | "entry") => entry = Some((depth, Draft::default())),
                    (Some((d, draft)), None) if depth == *d + 1 => {
                        if let Some(f) = field_of(name) {
                            if f == Field::Link {
                                // Atom: <link href="…"/>; RSS: <link>…</link>
                                if let Some(h) = atom_href(&e) {
                                    draft.link.get_or_insert(h);
                                }
                            }
                            field = Some((depth, f));
                            text.clear();
                        }
                    }
                    _ => {}
                }
            }
            Event::Text(t) if field.is_some() => text.push_str(&t.xml10_content()),
            // сущности отдаём чистке заголовка как есть: она декодирует и XML, и HTML
            Event::GeneralRef(g) if field.is_some() => {
                text.push('&');
                text.push_str(&g.into_inner());
                text.push(';');
            }
            Event::CData(t) if field.is_some() => text.push_str(&t.xml10_content()),
            Event::End(_) => {
                if let (Some((fd, f)), Some((_, draft))) = (field, &mut entry) {
                    if fd == depth {
                        let v = std::mem::take(&mut text);
                        let slot = match f {
                            Field::Title => Some(&mut draft.title),
                            Field::Link => Some(&mut draft.link),
                            Field::Guid => Some(&mut draft.guid),
                            Field::Published => {
                                draft.published = draft.published.or(parse_date(&v));
                                None
                            }
                            Field::Updated => {
                                draft.updated = draft.updated.or(parse_date(&v));
                                None
                            }
                        };
                        // первое непустое значение побеждает: у Atom ссылка могла прийти из href
                        if let Some(slot) = slot.filter(|s| s.is_none() && !v.trim().is_empty()) {
                            *slot = Some(v);
                        }
                        field = None;
                    }
                }
                if entry.as_ref().is_some_and(|(d, _)| *d == depth) {
                    if let Some(e) = entry.take().and_then(|(_, d)| d.finish()) {
                        out.push(e);
                    }
                    field = None;
                }
                depth = depth.saturating_sub(1);
            }
            _ => {}
        }
    }
    out
}

/// RSS — RFC 2822, Atom — RFC 3339; кое-кто путает, поэтому пробуем оба.
pub fn parse_date(s: &str) -> Option<i64> {
    let s = s.trim();
    DateTime::parse_from_rfc2822(s)
        .or_else(|_| DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.timestamp())
}

fn named_entity(name: &str) -> Option<char> {
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        "laquo" => '«',
        "raquo" => '»',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "lsquo" => '‘',
        "rsquo" => '’',
        "sbquo" => '‚',
        "ldquo" => '“',
        "rdquo" => '”',
        "bdquo" => '„',
        "shy" => '\u{ad}',
        "copy" => '©',
        "reg" => '®',
        "trade" => '™',
        "deg" => '°',
        "times" => '×',
        "minus" => '−',
        "middot" => '·',
        "bull" => '•',
        "prime" => '′',
        "euro" => '€',
        "thinsp" => '\u{2009}',
        "ensp" => '\u{2002}',
        "emsp" => '\u{2003}',
        _ => return None,
    })
}

/// `&amp;`, `&laquo;`, `&#171;`, `&#xAB;` → символы. Незнакомое оставляем как было.
pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest[1..].find(';').map(|j| j + 1).filter(|&j| j <= 12);
        let ch = end.and_then(|j| {
            let name = &rest[1..j];
            match name.strip_prefix('#') {
                Some(n) => {
                    let code = match n.strip_prefix(['x', 'X']) {
                        Some(h) => u32::from_str_radix(h, 16).ok(),
                        None => n.parse().ok(),
                    };
                    code.filter(|&c| c != 0).and_then(char::from_u32)
                }
                None => named_entity(name),
            }
        });
        match (ch, end) {
            (Some(c), Some(j)) => {
                out.push(c);
                rest = &rest[j + 1..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Убирает HTML-теги: `<b>`, `</a>`, `<br/>`, `<!-- -->`. Одинокое `<` (как в «3 < 5») — не тег.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let tag = after.starts_with(|c: char| c.is_ascii_alphabetic() || c == '/' || c == '!');
        match after.find('>').filter(|_| tag) {
            Some(j) => {
                out.push(' ');
                rest = &after[j + 1..];
            }
            None => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Невидимые символы форматирования: мягкий перенос, нулевой ширины, направление письма.
fn invisible(c: char) -> bool {
    matches!(c, '\u{ad}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{feff}')
}

/// Приписки ленты в конце заголовка: « — читать на Gastronom.ru», «  •  Журнал», « — GPblog».
fn strip_tail(s: &str) -> &str {
    let lower = s.to_lowercase();
    let credit = [" — читать на ", " - читать на ", ", читайте на ", " — читайте на ", " - read more", " – read more", " — read more", " | read more"];
    if let Some(i) = credit.iter().find_map(|c| lower.find(c)) {
        // to_lowercase для кириллицы и латиницы длину в байтах не меняет
        if s.is_char_boundary(i) {
            return s[..i].trim_end();
        }
    }
    for sep in [" • ", " — ", " | "] {
        if let Some(i) = s.rfind(sep) {
            let tail = s[i + sep.len()..].trim();
            // после | бывает рубрика в несколько слов: «… – recipe | The good mixer» у Guardian
            let one_word = if sep == " | " {
                tail.split_whitespace().count() <= 4 && tail.chars().count() <= 30
            } else {
                !tail.contains(' ') && tail.chars().count() <= 20
            };
            // после • и | — любая короткая приписка; после тире — только латинское имя источника под
            // русским заголовком: в английском «Arsenal win the derby — again» это ещё сам заголовок
            let latin = tail.chars().all(|c| c.is_ascii_alphanumeric() || c == '.');
            let russian = s[..i].chars().any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё'));
            let credit = sep != " — " || (latin && russian);
            if one_word && credit && !tail.is_empty() && s[..i].chars().count() >= 20 {
                return s[..i].trim_end();
            }
        }
    }
    s
}

/// Метки в начале: «[Перевод] », «[Видео] ».
fn strip_head(mut s: &str) -> &str {
    while let Some(rest) = s.strip_prefix('[') {
        match rest.find(']') {
            Some(j) if j <= 30 => s = rest[j + 1..].trim_start(),
            _ => break,
        }
    }
    s
}

/// Обрезка по слову до `max` символов с многоточием.
pub fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max - 1).collect();
    let cut = match cut.rfind(' ') {
        Some(i) if cut[..i].chars().count() >= max / 2 => &cut[..i],
        _ => cut.as_str(),
    };
    let cut = cut.trim_end_matches(|c: char| c.is_whitespace() || ",.:;—–-".contains(c));
    format!("{cut}…")
}

/// Заголовок для облачка: без сущностей, тегов, лишних пробелов и приписок, не длиннее TITLE_MAX.
pub fn clean_title(raw: &str) -> String {
    // дважды: заголовки бывают экранированы два раза (`&amp;quot;`)
    let s = decode_entities(&strip_tags(&decode_entities(raw)));
    let s = decode_entities(&strip_tags(&s));
    let s: String = s.chars().filter(|&c| !invisible(c)).map(|c| if c.is_whitespace() { ' ' } else { c }).collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = strip_tail(strip_head(&s));
    shorten(s, TITLE_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Лента — не запись</title>
    <link>https://example.ru/</link>
    <item>
      <title>«Зенит» обыграл &amp;quot;Спартак&amp;quot; &amp;mdash; 2:1</title>
      <link>https://example.ru/news/1</link>
      <description><![CDATA[<p>Длинный текст статьи, его брать нельзя</p><img src="x.jpg">]]></description>
      <pubDate>Thu, 05 Nov 2026 23:38:00 +0300</pubDate>
      <media:content url="x.jpg"><media:title>Подпись к картинке</media:title></media:content>
    </item>
    <item>
      <title><![CDATA[Новый трейлер &laquo;Дюны&raquo; <b>показали</b>]]></title>
      <guid isPermaLink="true">https://example.ru/news/2</guid>
      <dc:date>2026-11-05T10:00:00Z</dc:date>
    </item>
    <item>
      <title>Без ссылки — пропускаем</title>
    </item>
  </channel>
</rss>"#;

    const ATOM: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom feed</title>
  <link href="https://example.com/"/>
  <entry>
    <title type="html">Webb spots a &lt;i&gt;new&lt;/i&gt; exoplanet</title>
    <link rel="enclosure" href="https://example.com/pic.jpg"/>
    <link rel="alternate" type="text/html" href="https://example.com/a?x=1&amp;y=2"/>
    <updated>2026-11-05T12:00:00+00:00</updated>
    <published>2026-11-04T12:00:00Z</published>
    <summary>Not for us</summary>
  </entry>
  <entry>
    <title>Second</title>
    <link href="https://example.com/b"/>
    <updated>2026-11-05T13:00:00Z</updated>
  </entry>
</feed>"#;

    #[test]
    fn rss_takes_title_link_date_only() {
        let e = parse(RSS);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].title, "«Зенит» обыграл \"Спартак\" — 2:1");
        assert_eq!(e[0].link, "https://example.ru/news/1");
        assert_eq!(e[0].date, Some(1_793_911_080));
        // CDATA, сущности и теги в заголовке; ссылка из guid; дата из dc:date
        assert_eq!(e[1].title, "Новый трейлер «Дюны» показали");
        assert_eq!(e[1].link, "https://example.ru/news/2");
        assert_eq!(e[1].date, parse_date("2026-11-05T10:00:00Z"));
    }

    #[test]
    fn atom_prefers_alternate_link_and_published() {
        let e = parse(ATOM);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].title, "Webb spots a new exoplanet");
        assert_eq!(e[0].link, "https://example.com/a?x=1&y=2");
        assert_eq!(e[0].date, parse_date("2026-11-04T12:00:00Z"));
        assert_eq!(e[1].link, "https://example.com/b");
        assert_eq!(e[1].date, parse_date("2026-11-05T13:00:00Z"));
    }

    #[test]
    fn broken_xml_keeps_what_was_parsed() {
        let cut = &RSS[..RSS.find("<item>\n      <title><![CDATA[").unwrap() + 20];
        assert_eq!(parse(cut).len(), 1);
        assert!(parse("<html><body>not a feed</body></html>").is_empty());
        assert!(parse("").is_empty());
    }

    #[test]
    fn dates_both_formats() {
        assert_eq!(parse_date("Thu, 05 Nov 2026 20:38:00 GMT"), parse_date("2026-11-05T20:38:00Z"));
        assert_eq!(parse_date("вчера"), None);
    }

    #[test]
    fn entities_numeric_and_named() {
        assert_eq!(decode_entities("&#171;A&#xBB; &amp; B&hellip;"), "«A» & B…");
        assert_eq!(decode_entities("AT&T &unknown; & &#0;"), "AT&T &unknown; & &#0;");
    }

    #[test]
    fn cleaning_titles() {
        assert_eq!(clean_title("  Пробелы\n\tи&nbsp;переносы  "), "Пробелы и переносы");
        assert_eq!(clean_title("[Перевод] Уравнения Эйнштейна простым языком"), "Уравнения Эйнштейна простым языком");
        assert_eq!(
            clean_title("Есть ли польза в отваре от макарон — читать на Gastronom.ru"),
            "Есть ли польза в отваре от макарон"
        );
        assert_eq!(
            clean_title("Тмин индийский: калорийность, как выбирать, как готовить, читайте на Гастроном.ру"),
            "Тмин индийский: калорийность, как выбирать, как готовить"
        );
        assert_eq!(clean_title("Ключ к тексту: «Недоросль» Фонвизина  •  Журнал"), "Ключ к тексту: «Недоросль» Фонвизина");
        assert_eq!(
            clean_title("«Ред Булл» не планирует менять двигатель Ферстаппена — GPblog"),
            "«Ред Булл» не планирует менять двигатель Ферстаппена"
        );
        // русское после тире — часть заголовка
        assert_eq!(clean_title("Бронзовая медаль досталась сборной — Россия"), "Бронзовая медаль досталась сборной — Россия");
        assert_eq!(clean_title("Луна\u{200a}—\u{202a}спутник\u{202c}"), "Луна —спутник");
        // английское после тире — тоже часть заголовка, а «read more» — приписка
        assert_eq!(clean_title("Arsenal win the north London derby — again"), "Arsenal win the north London derby — again");
        assert_eq!(clean_title("Pixel 11 leaks in full ahead of launch - Read more at Example.com"), "Pixel 11 leaks in full ahead of launch");
        assert_eq!(clean_title("Cocktail of the week: the fallen leaf – recipe | The good mixer"), "Cocktail of the week: the fallen leaf – recipe");
        assert_eq!(clean_title("3 < 5, а <b>жирный</b> текст"), "3 < 5, а жирный текст");
    }

    #[test]
    fn long_title_is_cut_on_a_word() {
        let long = "Слово ".repeat(40);
        let t = clean_title(&long);
        assert!(t.chars().count() <= TITLE_MAX, "{t}");
        assert!(t.ends_with("Слово…"), "{t}");
        let one = "а".repeat(150);
        assert_eq!(clean_title(&one).chars().count(), TITLE_MAX);
    }
}
