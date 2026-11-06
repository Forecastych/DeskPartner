/**
 * «В этот день» из Википедии: события дня (их скачивает Rust, команда wiki_today) — в факты по темам.
 *
 * Тему видно по коротким описаниям связанных статей («советский космонавт», «футбольный клуб»):
 * они короче и однообразнее самого текста события, по ним меньше промахов. Ищем основы слов,
 * а не слова целиком — русские окончания иначе не поймать. Событие может попасть в несколько тем;
 * повтора всё равно не будет — сказанное chatter помнит по тексту.
 *
 * Текст CC BY-SA, поэтому подпись в каждом облачке: облачко — единственное место, где его видно.
 *
 * Rust качает Википедию на языке интерфейса, поэтому и правила берутся по нему же. Английские
 * описания короче русских («Soviet cosmonaut»), окончаний почти нет — там, где короткая основа
 * цепляет чужие слова («war» → «Warsaw»), стоит граница слова.
 */
import { pick, t, type Lang } from './i18n';
import { TOPICS, type Topic } from './settings';

/** Ответ wiki_today: год, текст события и описания связанных статей. */
export interface WikiEvent {
  year: number;
  text: string;
  about: string[];
}

export const SIGN: Record<Lang, string> = { ru: 'Википедия, CC BY-SA', en: 'Wikipedia, CC BY-SA' };
/** Длиннее — облачко разрастётся во всю кошку и не успеет прочитаться за отведённые секунды. */
export const MAX_TEXT = 110;
/** Свежие факты идут вперёд встроенных; больше пяти за день по теме — уже не «иногда». */
export const PER_TOPIC = 5;

/** Основа слова с начала слова: «футбол» ловит «футбольный», но «кот» не поймает «который». */
const stems = (...list: string[]) => new RegExp(`(?:^|[^\\p{L}])(?:${list.join('|')})`, 'iu');

const RU: Record<Topic, RegExp> = {
  футбол: stems('футбол'),
  хоккей: stems('хокке'),
  баскетбол: stems('баскетбол'),
  теннис: stems('теннис'),
  'формула 1': stems('формул[аы]\\s*1', 'автогонщ', 'гран-при'),
  единоборства: stems('бокс[её]р', 'борец', 'борца', 'борьб', 'дзюдо', 'карате', 'самбо', 'единобор', 'кикбокс'),
  киберспорт: stems('киберспорт'),
  игры: stems('видеоигр', 'компьютерн\\S* игр', 'игров\\S* приставк', 'разработчик\\S* игр'),
  аниме: stems('аниме', 'манга', 'мангак'),
  кино: stems('фильм', 'кино', 'актёр', 'актер', 'актрис'),
  сериалы: stems('сериал', 'телесериал'),
  музыка: stems('композитор', 'музыка', 'музыкал', 'певец', 'певца', 'певиц', 'рок-групп', 'дирижёр', 'дирижер', 'оперн', 'рэпер', 'гитарист', 'пианист'),
  книги: stems('писател', 'поэт', 'прозаик', 'романист', 'литератур', 'книг', 'драматург'),
  космос: stems('космонавт', 'астронавт', 'космическ', 'космос', 'ракет', 'орбитальн', 'астроном', 'межпланетн'),
  наука: stems('учён', 'учен', 'физик', 'химик', 'математик', 'биолог', 'генетик', 'научн', 'нобелевск'),
  техника: stems('инженер', 'изобретат', 'авиаконструктор', 'самолёт', 'самолет', 'паровоз', 'локомотив', 'телеграф', 'телефон', 'радио', 'электростанц'),
  программирование: stems('программист', 'язык\\S* программирования', 'операционн\\S* систем', 'программн', 'информатик', 'интернет', 'компьютер'),
  история: stems('сражени', 'битв', 'войн', 'император', 'импери', 'корол', 'царь', 'царя', 'царств', 'цариц', 'династ', 'революц', 'полковод', 'княз', 'княгин'),
  животные: stems('животн', 'млекопитающ', 'зоолог', 'зоопарк', 'собак', 'кошк', 'птиц'),
  природа: stems('вулкан', 'землетрясени', 'заповедник', 'национальн\\S* парк', 'ураган', 'цунами', 'наводнени', 'ледник'),
  путешествия: stems('путешественни', 'мореплавател', 'экспедици', 'первооткрывател', 'полярн'),
  еда: stems('кулинар', 'повар', 'ресторан', 'блюд', 'напит', 'кондитер', 'шоколад'),
  искусство: stems('художни', 'живопис', 'скульптор', 'архитектор', 'картин', 'музей', 'театр', 'балет', 'балерин'),
  авто: stems('автомобил', 'автопроизводител', 'автогонщ'),
};

const EN: Record<Topic, RegExp> = {
  футбол: stems('football', 'soccer'),
  хоккей: stems('hockey', 'ice hockey'),
  баскетбол: stems('basketball'),
  теннис: stems('tennis'),
  'формула 1': stems('formula (?:one|1)', 'racing driver', 'grand prix'),
  единоборства: stems('boxer', 'boxing', 'wrestl', 'judo', 'karate', 'sambo', 'kickbox', 'martial art', 'mixed martial'),
  киберспорт: stems('esports?\\b', 'e-sports?\\b', 'professional gamer'),
  игры: stems('video game', 'game developer', 'game designer', 'game console'),
  аниме: stems('anime', 'manga'),
  кино: stems('film', 'movie', 'actor', 'actress'),
  сериалы: stems('television series', 'tv series', 'sitcom', 'television show'),
  музыка: stems('composer', 'music', 'singer', 'songwriter', 'rock band', 'conductor', 'opera', 'rapper', 'guitarist', 'pianist', 'violinist'),
  книги: stems('writer', 'poet', 'novel', 'author', 'playwright', 'literary', 'literature', 'book'),
  космос: stems('cosmonaut', 'astronaut', 'spacecraft', 'spaceflight', 'space station', 'space probe', 'space agency', 'rocket', 'astronom', 'satellite'),
  наука: stems('scientist', 'physicist', 'chemist', 'mathematician', 'biologist', 'geneticist', 'scientific', 'nobel'),
  техника: stems('engineer', 'inventor', 'aircraft', 'airplane', 'aeroplane', 'locomotive', 'telegraph', 'telephone', 'radio', 'power station', 'power plant'),
  программирование: stems('programmer', 'programming language', 'operating system', 'software', 'computer', 'internet'),
  история: stems('battle', 'wars?\\b', 'emperor', 'empress', 'empire', 'king', 'queen', 'tsar', 'czar', 'dynast', 'revolution', 'military commander', 'prince', 'pharaoh'),
  животные: stems('animal', 'mammal', 'zoolog', 'zoo\\b', 'dogs?\\b', 'cats?\\b', 'birds?\\b'),
  природа: stems('volcan', 'earthquake', 'nature reserve', 'national park', 'hurricane', 'typhoon', 'tropical cyclone', 'tsunami', 'flood', 'glacier'),
  путешествия: stems('explorer', 'navigator', 'expedition', 'polar', 'circumnavigat'),
  еда: stems('culinary', 'chef', 'restaurant', 'cuisine', 'dish(?:es)?\\b', 'beverage', 'confection', 'chocolate'),
  искусство: stems('painter', 'painting', 'sculpt', 'architect', 'museum', 'theatre', 'theater', 'ballet', 'ballerina'),
  авто: stems('automobile', 'automaker', 'car manufacturer', 'cars?\\b', 'racing driver'),
};

const RULES: Record<Lang, Record<Topic, RegExp>> = { ru: RU, en: EN };

/** Темы события по описаниям его статей; порядок — как в TOPICS. */
export function topicsOf(e: WikiEvent): Topic[] {
  const rules = pick(RULES);
  return TOPICS.filter((topic) => e.about.some((d) => rules[topic].test(d)));
}

/** Как событие звучит в облачке. */
export function line(e: WikiEvent): string {
  return t(`В этот день в ${e.year} году: ${e.text}`, `On this day in ${e.year}: ${e.text}`) + ` (${pick(SIGN)})`;
}

/**
 * События дня → факты по темам для Moment.extra. До нашей эры («в -44 году») и слишком длинное
 * пропускаем: в облачке это читается плохо. Порядок событий сохраняем — какой дала Википедия.
 */
export function sort(events: readonly WikiEvent[]): Partial<Record<Topic, string[]>> {
  const out: Partial<Record<Topic, string[]>> = {};
  for (const e of events) {
    if (!(e.year > 0) || !e.text || e.text.length > MAX_TEXT) continue;
    for (const topic of topicsOf(e)) {
      const list = (out[topic] ??= []);
      if (list.length < PER_TOPIC) list.push(line(e));
    }
  }
  return out;
}
