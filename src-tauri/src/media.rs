//! «Кино вместе»: идёт ли сейчас видео и не грохнуло ли в нём что-то.
//!
//! Без заголовков окон. Видео узнаём по двум вещам. Первая — сигнал Windows «идёт воспроизведение»
//! (System Media Transport Controls, тот же, что показывает плитка громкости): кто играет, видео
//! или музыка, название. Вторая — имя exe плеера в активном окне. MPC-HC, PotPlayer и VLC 3
//! в плитку не пишут, у них решает уровень звука. Браузер пишет всегда, но не говорит, видео это
//! или музыка. Поэтому для него ещё условие «окно на весь экран».
//!
//! Звук берём только как пиковый уровень выхода по умолчанию, как индикатор в микшере громкости.
//! Сам звук не записывается. Название фильма уходит наружу, только если включены отзывы:
//! это решает фронт, здесь название лишь лежит в памяти до следующего опроса.

use serde::Serialize;
use std::time::{Duration, Instant};

/// Плееры по имени exe без расширения, в нижнем регистре.
const PLAYERS: &[&str] = &[
    "vlc",
    "mpc-hc",
    "mpc-hc64",
    "mpc-be",
    "mpc-be64",
    "potplayer",
    "potplayer64",
    "potplayermini",
    "potplayermini64",
    "mpv",
    "smplayer",
    "kmplayer",
    "kmplayer64x",
    "gom",
    "wmplayer",
    "video.ui",
    "daumpotplayer",
    "kodi",
    "plex",
    "stremio",
    "kinopoisk",
    "okko",
    "ivi",
    "netflix",
];

/// Источники в плитке, у которых «играет» не значит «видео»: браузеры. Firefox подписывается
/// не именем, а хэшем пути установки — он тут тоже.
const BROWSERS: &[&str] = &["chrome", "msedge", "firefox", "308046b0af4a39cb", "opera", "brave", "vivaldi", "yandex", "browser"];

/// Тише этого — плеер на паузе или без звука: открытый на паузе VLC фильмом не считается.
pub const SOUND: f32 = 0.01;

/// Громкая сцена: быстрый уровень выше этого и во столько раз выше фона за последние полминуты.
/// Фон нужен, чтобы боевик целиком не был «громкой сценой», а тихая драма — никогда ею не была.
pub const LOUD: f32 = 0.35;
pub const LOUD_OVER: f32 = 2.5;
/// Столько после всплеска громкости `loud` остаётся true: фронт опрашивает раз в 2 с и не должен его пропустить.
pub const LOUD_HOLD: Duration = Duration::from_secs(3);
/// Быстрый уровень сглаживается за ~0,5 с, фон — за ~30 с.
const FAST: Duration = Duration::from_millis(500);
const SLOW: Duration = Duration::from_secs(30);

/// Что прислала плитка о самом подходящем сеансе.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Session {
    /// Кто играет: AppUserModelId, приведённый `source_name` (chrome, msedge, vlc…).
    pub source: String,
    pub playing: bool,
    /// Сеанс сам сказал, что это видео (кинотеатры, «Кино и ТВ», VLC 4).
    pub video: bool,
    pub title: String,
}

/// AppUserModelId → короткое имя: `Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo` → `microsoft.zunevideo_8wekyb3d8bbwe`,
/// `C:\Program Files\VideoLAN\VLC\vlc.exe` → `vlc`, `Chrome` → `chrome`.
pub fn source_name(aumid: &str) -> String {
    let id = aumid.split('!').next().unwrap_or(aumid);
    let file = id.rsplit(['\\', '/']).next().unwrap_or(id).to_lowercase();
    file.strip_suffix(".exe").map(str::to_string).unwrap_or(file)
}

fn listed(list: &[&str], name: &str) -> bool {
    list.iter().any(|p| name == *p || name.starts_with(&format!("{p}.")) || name.starts_with(&format!("{p}_")))
}

/// Браузер на весь экран, даже не в фокусе: человек смотрит фильм на одном мониторе, а пишет
/// на другом. `exes` — `source_name` от путей окон, накрывших свой монитор (world::covering).
pub fn browser_fullscreen<S: AsRef<str>>(exes: &[S]) -> bool {
    exes.iter().any(|e| listed(BROWSERS, e.as_ref()))
}

/// Идёт ли видео прямо сейчас. `fg` — exe активного окна (`source_name` от пути), `fullscreen` —
/// что-то на весь экран: активное окно (win::Quiet::Fullscreen) или браузер где угодно.
pub fn watching(s: Option<&Session>, fg: &str, level: f32, fullscreen: bool) -> bool {
    if let Some(s) = s.filter(|s| s.playing) {
        if s.video || listed(PLAYERS, &s.source) || s.source.contains("zunevideo") {
            return true;
        }
        if listed(BROWSERS, &s.source) && fullscreen {
            return true;
        }
    }
    listed(PLAYERS, fg) && level > SOUND
}

/// Из сеансов плитки — играющий, видео вперёд; никто не играет — None.
pub fn pick(sessions: Vec<Session>) -> Option<Session> {
    let mut playing: Vec<Session> = sessions.into_iter().filter(|s| s.playing).collect();
    playing.sort_by_key(|s| !s.video);
    playing.into_iter().next()
}

/// Громкая сцена по пиковому уровню: два скользящих средних, быстрое и фон.
#[derive(Debug)]
pub struct Loudness {
    fast: f32,
    slow: f32,
    until: Option<Instant>,
}

impl Default for Loudness {
    fn default() -> Self {
        // фон стартует не с нуля: первый же звук после тишины не должен считаться взрывом
        Loudness { fast: 0.0, slow: LOUD, until: None }
    }
}

impl Loudness {
    /// Новый замер пикового уровня 0..1 через `dt` после прошлого.
    pub fn feed(&mut self, level: f32, dt: Duration, at: Instant) {
        let k = |span: Duration| (dt.as_secs_f32() / span.as_secs_f32()).min(1.0);
        self.fast += (level - self.fast) * k(FAST);
        self.slow += (level - self.slow) * k(SLOW);
        if self.fast > LOUD && self.fast > self.slow * LOUD_OVER {
            self.until = Some(at + LOUD_HOLD);
        }
    }

    pub fn level(&self) -> f32 {
        self.fast
    }

    pub fn loud(&self, at: Instant) -> bool {
        matches!(self.until, Some(t) if at < t)
    }
}

/// Что видит фронт.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Media {
    pub watching: bool,
    /// Название из плитки; пусто — плеер его не передаёт.
    pub title: String,
    pub loud: bool,
}

#[cfg(windows)]
pub use sys::start;

#[cfg(windows)]
mod sys {
    use super::*;
    use std::sync::{Arc, Mutex};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Media::MediaPlaybackType;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// Уровень меряем 4 раза в секунду: всплеск короче этого громкой сценой и не считается.
    const SAMPLE: Duration = Duration::from_millis(250);
    /// Плитку и активное окно — раз в секунду: фильм не начинается и не кончается быстрее.
    const POLL_EVERY: u32 = 4;

    /// Поток опроса: пишет итог в `out`. Ошибки WinRT и COM не роняют питомца — просто «видео нет».
    pub fn start(out: Arc<Mutex<Media>>) {
        std::thread::Builder::new()
            .name("media".into())
            .spawn(move || {
                // SAFETY: инициализация COM для этого потока; не освобождаем — поток живёт до выхода.
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                let mut manager: Option<Manager> = None;
                let mut meter: Option<IAudioMeterInformation> = None;
                let mut loud = Loudness::default();
                let mut last = Instant::now();
                let mut n = 0u32;
                let mut session: Option<Session> = None;
                let mut fg = String::new();
                let mut full = false;
                loop {
                    std::thread::sleep(SAMPLE);
                    let at = Instant::now();
                    if meter.is_none() {
                        meter = open_meter();
                    }
                    // SAFETY: только чтение пикового уровня у живого интерфейса.
                    let peak = match meter.as_ref().map(|m| unsafe { m.GetPeakValue() }) {
                        Some(Ok(p)) => p,
                        // сменили устройство вывода — откроем заново на следующем замере
                        _ => {
                            meter = None;
                            0.0
                        }
                    };
                    loud.feed(peak, at - last, at);
                    last = at;

                    if n % POLL_EVERY == 0 {
                        if manager.is_none() {
                            manager = Manager::RequestAsync().and_then(|op| op.join()).ok();
                        }
                        session = match manager.as_ref().map(sessions) {
                            Some(Ok(list)) => pick(list),
                            Some(Err(_)) => {
                                manager = None;
                                None
                            }
                            None => None,
                        };
                        fg = crate::win::foreground_path().map(|p| source_name(&p)).unwrap_or_default();
                        // «весь экран» Windows знает лишь про активное окно, поэтому ещё и окна, накрывшие
                        // свой монитор в фоне: alt-tab с фильма — кино идёт, вышли из полноэкранного
                        // или свернули (свёрнутые sys::windows не отдаёт) — кончилось
                        full = crate::win::quiet() == crate::win::Quiet::Fullscreen || {
                            let exes: Vec<String> = crate::world::covering()
                                .into_iter()
                                .filter_map(crate::win::window_path)
                                .map(|p| source_name(&p))
                                .collect();
                            browser_fullscreen(&exes)
                        };
                    }
                    n = n.wrapping_add(1);

                    let now = Media {
                        watching: watching(session.as_ref(), &fg, loud.level(), full),
                        title: session.as_ref().map(|s| s.title.clone()).unwrap_or_default(),
                        loud: loud.loud(at),
                    };
                    *out.lock().unwrap() = now;
                }
            })
            .expect("media thread");
    }

    fn open_meter() -> Option<IAudioMeterInformation> {
        // SAFETY: обычный путь к устройству вывода по умолчанию; COM инициализирован в этом потоке.
        unsafe {
            let e: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let dev = e.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None).ok()
        }
    }

    fn sessions(m: &Manager) -> windows::core::Result<Vec<Session>> {
        let list = m.GetSessions()?;
        let mut out = Vec::new();
        for i in 0..list.Size()? {
            let s = list.GetAt(i)?;
            let info = s.GetPlaybackInfo()?;
            let playing = info.PlaybackStatus()? == Status::Playing;
            let video = info.PlaybackType().and_then(|t| t.Value()).is_ok_and(|t| t == MediaPlaybackType::Video);
            // название нужно только играющему: у остальных не дёргаем лишний асинхронный вызов
            let title = if playing {
                s.TryGetMediaPropertiesAsync().and_then(|op| op.join()).and_then(|p| p.Title()).map(|t| t.to_string()).unwrap_or_default()
            } else {
                String::new()
            };
            let source = source_name(&s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default());
            out.push(Session { source, playing, video, title });
        }
        Ok(out)
    }

    /// Что видит плитка прямо сейчас: `cargo test -- --ignored media_live --nocapture`.
    #[test]
    #[ignore]
    fn media_live() {
        let m = Manager::RequestAsync().and_then(|op| op.join()).unwrap();
        for s in sessions(&m).unwrap() {
            println!("{s:?}");
        }
        println!("fg={:?} full={}", crate::win::foreground_path(), crate::win::quiet() == crate::win::Quiet::Fullscreen);
        let exes: Vec<String> = crate::world::covering().into_iter().filter_map(crate::win::window_path).map(|p| source_name(&p)).collect();
        println!("covering={exes:?} browser_fullscreen={}", browser_fullscreen(&exes));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing(source: &str, video: bool) -> Session {
        Session { source: source.into(), playing: true, video, title: "Дюна".into() }
    }

    #[test]
    fn source_name_shortens_aumid_and_paths() {
        assert_eq!(source_name("Chrome"), "chrome");
        assert_eq!(source_name(r"C:\Program Files\VideoLAN\VLC\vlc.exe"), "vlc");
        assert_eq!(source_name("Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo"), "microsoft.zunevideo_8wekyb3d8bbwe");
        assert_eq!(source_name("MSEdge"), "msedge");
    }

    #[test]
    fn browser_fullscreen_by_window_exe() {
        assert!(browser_fullscreen(&["explorer", "chrome"]));
        assert!(browser_fullscreen(&["firefox"]));
        // игра на весь экран — не браузер
        assert!(!browser_fullscreen(&["cs2"]));
        assert!(!browser_fullscreen::<&str>(&[]));
    }

    #[test]
    fn browser_film_lasts_only_while_on_full_screen() {
        let film = playing("chrome", false);
        // в окне — ещё не кино
        assert!(!watching(Some(&film), "chrome", 0.5, false));
        // на весь экран — кино, и в фокусе браузер или нет, неважно (окно накрывает монитор)
        assert!(watching(Some(&film), "chrome", 0.5, true));
        assert!(watching(Some(&film), "code", 0.5, true));
        // вышли из полноэкранного или свернули — тот же ролик уже не кино
        assert!(!watching(Some(&film), "chrome", 0.5, false));
        assert!(!watching(Some(&film), "code", 0.5, false));
    }

    #[test]
    fn video_session_or_player_counts_browser_needs_fullscreen() {
        assert!(watching(Some(&playing("microsoft.zunevideo_8wekyb3d8bbwe", false)), "", 0.0, false));
        assert!(watching(Some(&playing("someapp", true)), "", 0.0, false));
        assert!(watching(Some(&playing("vlc", false)), "explorer", 0.0, false));
        // музыка в окне браузера — не кино, на весь экран — кино
        assert!(!watching(Some(&playing("chrome", false)), "chrome", 0.5, false));
        assert!(watching(Some(&playing("chrome", false)), "chrome", 0.5, true));
        assert!(watching(Some(&playing("308046b0af4a39cb", false)), "firefox", 0.5, true));
        // Spotify в плитке: не видео, даже на весь экран
        assert!(!watching(Some(&playing("spotify", false)), "spotify", 0.5, true));
        // на паузе плитка ничего не решает
        let paused = Session { playing: false, ..playing("chrome", true) };
        assert!(!watching(Some(&paused), "chrome", 0.0, true));
    }

    #[test]
    fn player_without_tile_needs_sound() {
        assert!(watching(None, "mpc-hc64", 0.2, false));
        assert!(watching(None, "potplayermini64", 0.2, false));
        assert!(!watching(None, "mpc-hc64", 0.0, false));
        assert!(!watching(None, "code", 0.2, false));
        // похожее имя — не плеер
        assert!(!watching(None, "vlcsnap-tool", 0.2, false));
    }

    #[test]
    fn pick_prefers_playing_video() {
        let paused = Session { playing: false, ..playing("netflix", true) };
        let music = playing("spotify", false);
        let film = playing("chrome", true);
        assert_eq!(pick(vec![paused.clone(), music.clone(), film.clone()]), Some(film));
        assert_eq!(pick(vec![paused.clone(), music.clone()]), Some(music));
        assert_eq!(pick(vec![paused]), None);
    }

    #[test]
    fn loud_scene_is_a_jump_over_background() {
        let t0 = Instant::now();
        let step = Duration::from_millis(250);
        let mut l = Loudness::default();
        let mut at = t0;
        // минута тихого диалога: фон опускается
        for _ in 0..240 {
            at += step;
            l.feed(0.08, step, at);
        }
        assert!(!l.loud(at));
        // взрыв
        for _ in 0..4 {
            at += step;
            l.feed(0.9, step, at);
        }
        assert!(l.loud(at));
        assert!(!l.loud(at + LOUD_HOLD));

        // боевик, где громко всё время: фон высокий, «громкой сцены» нет
        let mut l = Loudness::default();
        let mut at = t0;
        for _ in 0..480 {
            at += step;
            l.feed(0.7, step, at);
        }
        let quiet_since = at;
        for _ in 0..4 {
            at += step;
            l.feed(0.8, step, at);
        }
        assert!(!l.loud(at), "громко с {quiet_since:?} и до сих пор — это не всплеск");
    }
}
