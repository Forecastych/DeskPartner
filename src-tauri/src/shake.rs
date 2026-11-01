//! Тряска курсором над питомцем — так его будят.
//!
//! Только логика: сюда приходят позиция курсора и момент опроса, а над зверем ли курсор
//! и не зажат ли Alt, решает hit.rs. Тряска — частые развороты по одной оси. Дрожь руки
//! отсекает минимальный размах отрезка, пролёт мимо — то, что у прямого движения
//! разворотов нет совсем, а у пролёта с промахом их один-два.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Минимальный размах между разворотами, физ. пиксели. Клетка арта — от 4 px (масштаб 100%),
/// так что это хотя бы 3 клетки: дрожь руки и шум сенсора столько не набегают.
pub const MIN_LEG: i32 = 12;
/// Сколько разворотов по одной оси должно уложиться в [`WINDOW`].
pub const TURNS: usize = 4;
/// Окно для разворотов: неспешное «туда-сюда» (человек водит курсором, читая) — не тряска.
pub const WINDOW: Duration = Duration::from_millis(1000);
/// Пауза после срабатывания: одна тряска — одно событие, а не очередь.
pub const COOLDOWN: Duration = Duration::from_millis(1500);

/// Развороты по одной оси.
#[derive(Default)]
struct Axis {
    /// Где начался первый отрезок; `None` — ещё ни одной точки.
    start: Option<i32>,
    /// Самая дальняя точка текущего отрезка.
    peak: i32,
    /// Куда идёт текущий отрезок: 0 — первый отрезок ещё не набрал [`MIN_LEG`].
    dir: i32,
    /// Моменты разворотов; старше [`WINDOW`] выкидываются.
    turns: VecDeque<Instant>,
}

impl Axis {
    /// Учитывает точку и возвращает, сколько разворотов было за последнее [`WINDOW`].
    fn feed(&mut self, p: i32, at: Instant) -> usize {
        match self.start {
            None => self.start = Some(p),
            Some(start) if self.dir == 0 => {
                if (p - start).abs() >= MIN_LEG {
                    self.dir = (p - start).signum();
                    self.peak = p;
                }
            }
            Some(_) => {
                if (p - self.peak) * self.dir > 0 {
                    self.peak = p;
                } else if (self.peak - p) * self.dir >= MIN_LEG {
                    // разворот засчитываем, только когда назад уже ушли на MIN_LEG,
                    // поэтому каждый отрезок между разворотами не короче порога
                    self.turns.push_back(at);
                    self.peak = p;
                    self.dir = -self.dir;
                }
            }
        }
        while self.turns.front().is_some_and(|&t| at.duration_since(t) > WINDOW) {
            self.turns.pop_front();
        }
        self.turns.len()
    }
}

/// Детектор тряски: кормить каждым опросом, пока курсор над питомцем.
#[derive(Default)]
pub struct Shake {
    x: Axis,
    y: Axis,
    /// До этого момента после срабатывания всё пропускаем.
    quiet_until: Option<Instant>,
}

impl Shake {
    /// Курсор в физических пикселях в момент `at`. `true` — только что потрясли.
    pub fn feed(&mut self, x: i32, y: i32, at: Instant) -> bool {
        if self.quiet_until.is_some_and(|q| at < q) {
            return false;
        }
        // обе оси кормим всегда, чтобы у каждой была непрерывная траектория
        let turns = self.x.feed(x, at).max(self.y.feed(y, at));
        if turns < TURNS {
            return false;
        }
        self.reset();
        self.quiet_until = Some(at + COOLDOWN);
        true
    }

    /// Курсор ушёл со зверя (или зажат Alt, или тащат мышью) — накопленное не в счёт.
    /// Пауза после срабатывания остаётся: выйти и зайти снова — не способ её обойти.
    pub fn reset(&mut self) {
        self.x = Axis::default();
        self.y = Axis::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Шаг опроса как в hit.rs.
    const STEP: u64 = 33;

    fn ms(t0: Instant, m: u64) -> Instant {
        t0 + Duration::from_millis(m)
    }

    /// Точки через равные промежутки `step` мс; возвращает номера точек, где сработало.
    fn run(s: &mut Shake, t0: Instant, step: u64, pts: &[(i32, i32)]) -> Vec<usize> {
        pts.iter()
            .enumerate()
            .filter(|&(i, &(x, y))| s.feed(x, y, ms(t0, i as u64 * step)))
            .map(|(i, _)| i)
            .collect()
    }

    /// Траектория f(мс), снятая с шагом опроса hit.rs на [from, to); возвращает мс срабатываний.
    fn sample(s: &mut Shake, t0: Instant, from: u64, to: u64, f: impl Fn(u64) -> (i32, i32)) -> Vec<u64> {
        (from..to)
            .step_by(STEP as usize)
            .filter(|&m| {
                let (x, y) = f(m);
                s.feed(x, y, ms(t0, m))
            })
            .collect()
    }

    /// Пила между lo и hi, отрезок длится `leg` мс.
    fn tri(m: u64, lo: i32, hi: i32, leg: u64) -> i32 {
        let ph = m % (2 * leg);
        let k = if ph < leg { ph } else { 2 * leg - ph };
        lo + ((hi - lo) as i64 * k as i64 / leg as i64) as i32
    }

    /// Туда-сюда по x между 0 и `amp` с отрезком `amp`, n точек.
    fn zigzag(amp: i32, n: usize) -> Vec<(i32, i32)> {
        (0..n).map(|i| (if i % 2 == 0 { 0 } else { amp }, 50)).collect()
    }

    #[test]
    fn fourth_turn_fires() {
        let t0 = Instant::now();
        // точки 2, 3, 4, 5 — развороты; на четвёртом срабатывает
        assert_eq!(run(&mut Shake::default(), t0, 100, &zigzag(20, 6)), vec![5]);
        // трёх разворотов мало
        assert!(run(&mut Shake::default(), t0, 100, &zigzag(20, 5)).is_empty());
    }

    #[test]
    fn vertical_shake_fires() {
        let t0 = Instant::now();
        let pts: Vec<_> = zigzag(20, 6).into_iter().map(|(x, y)| (y, x)).collect();
        assert_eq!(run(&mut Shake::default(), t0, 100, &pts), vec![5]);
    }

    #[test]
    fn leg_threshold() {
        let t0 = Instant::now();
        assert_eq!(run(&mut Shake::default(), t0, 100, &zigzag(MIN_LEG, 6)), vec![5]);
        // дрожь руки меньше порога — не тряска, сколько ни дрожи
        assert!(run(&mut Shake::default(), t0, STEP, &zigzag(MIN_LEG - 1, 200)).is_empty());
    }

    #[test]
    fn turns_must_fit_window() {
        let t0 = Instant::now();
        // развороты на 660..1650 мс: от первого до четвёртого 990 мс — укладывается
        assert_eq!(run(&mut Shake::default(), t0, 330, &zigzag(40, 6)), vec![5]);
        // по 340 мс: четыре разворота растягиваются на 1020 мс, сколько ни продолжай
        assert!(run(&mut Shake::default(), t0, 340, &zigzag(40, 30)).is_empty());
    }

    #[test]
    fn real_shake_at_poll_rate() {
        let t0 = Instant::now();
        // ~3 Гц, размах 60 px поверх спрайта 128 px, по диагонали — срабатывает быстро
        let fired = sample(&mut Shake::default(), t0, 0, 2000, |m| {
            (tri(m, 30, 90, 150), tri(m, 40, 70, 150))
        });
        assert!(fired.first().is_some_and(|&m| m < 1000), "{fired:?}");
    }

    #[test]
    fn fly_through_is_not_shake() {
        let t0 = Instant::now();
        // пролёт насквозь ~600 px/с с дрожью поперёк и вдоль
        let jitter = [0, 3, -2, 1, -3, 2, 0, -1];
        let pts: Vec<_> = (0..10)
            .map(|i| (i * 20 + jitter[i as usize % 8], 60 + jitter[(i as usize + 3) % 8]))
            .collect();
        assert!(run(&mut Shake::default(), t0, STEP, &pts).is_empty());
        // по диагонали, с промахом и возвратом назад — один разворот
        let pts = [(0, 0), (25, 20), (50, 40), (75, 60), (100, 80), (125, 100), (100, 85), (80, 70), (60, 55)];
        assert!(run(&mut Shake::default(), t0, STEP, &pts).is_empty());
    }

    #[test]
    fn cooldown_after_fire() {
        let t0 = Instant::now();
        let mut s = Shake::default();
        // трясём без остановки 4 с
        let fired = sample(&mut s, t0, 0, 4000, |m| (tri(m, 20, 100, 120), 60));
        assert!(fired.len() >= 2, "{fired:?}");
        for w in fired.windows(2) {
            assert!(w[1] - w[0] >= COOLDOWN.as_millis() as u64, "{fired:?}");
        }
    }

    #[test]
    fn reset_drops_turns_but_keeps_cooldown() {
        let t0 = Instant::now();
        let mut s = Shake::default();
        // три разворота, ушли со зверя, вернулись и сделали ещё три — без сброса было бы шесть
        assert!(run(&mut s, t0, 100, &zigzag(20, 5)).is_empty());
        s.reset();
        assert!(run(&mut s, ms(t0, 500), 100, &zigzag(20, 5)).is_empty());
        // после срабатывания выход со зверя паузу не снимает
        let mut s = Shake::default();
        assert_eq!(run(&mut s, t0, 100, &zigzag(20, 6)), vec![5]);
        s.reset();
        assert!(run(&mut s, ms(t0, 600), 100, &zigzag(20, 6)).is_empty());
        assert_eq!(run(&mut s, ms(t0, 2100), 100, &zigzag(20, 6)), vec![5]);
    }
}
