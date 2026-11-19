//! Colours the PTY reader answers terminal colour queries from.
//!
//! A program asking `OSC 11 ; ?` (or `CSI ? 996 n`) typically waits a short,
//! fixed time and then gives up, after which a late reply is echoed by the tty
//! as visible text. The webview round trip has no such bound, so the reader
//! answers these queries itself from the theme the frontend last pushed.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Mutex, PoisonError};

pub type Rgb = [u8; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalColors {
    pub foreground: Rgb,
    pub background: Rgb,
    pub cursor: Rgb,
    pub palette: [Rgb; 16],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorScheme {
    Dark,
    Light,
}

impl ColorScheme {
    pub fn report(self) -> &'static [u8] {
        match self {
            ColorScheme::Dark => b"\x1b[?997;1n",
            ColorScheme::Light => b"\x1b[?997;2n",
        }
    }
}

impl TerminalColors {
    pub fn scheme(&self) -> ColorScheme {
        let [r, g, b] = self.background.map(u32::from);
        // Rec. 709 luma scaled by 10_000, compared with mid grey.
        if r * 2126 + g * 7152 + b * 722 < 1_275_000 {
            ColorScheme::Dark
        } else {
            ColorScheme::Light
        }
    }

    /// The colour of dynamic slot 10 (foreground), 11 (background) or 12 (cursor).
    pub fn dynamic(&self, slot: u8) -> Option<Rgb> {
        match slot {
            10 => Some(self.foreground),
            11 => Some(self.background),
            12 => Some(self.cursor),
            _ => None,
        }
    }

    pub fn indexed(&self, index: u8) -> Rgb {
        match index {
            0..=15 => self.palette[usize::from(index)],
            16..=231 => {
                let n = index - 16;
                let level = |v: u8| if v == 0 { 0 } else { v * 40 + 55 };
                [level(n / 36), level(n / 6 % 6), level(n % 6)]
            }
            232..=255 => [(index - 232) * 10 + 8; 3],
        }
    }
}

/// Parts of the terminal's colour state a program changed behind the theme's
/// back (`OSC 4/10/11/12` sets, resets). The webview terminal then holds the
/// truth, so its own answer is used until the theme is pushed again.
pub mod diverged {
    pub const FOREGROUND: u8 = 1;
    pub const BACKGROUND: u8 = 2;
    pub const CURSOR: u8 = 4;
    /// Palette entries 0 to 15, which the theme sets.
    pub const PALETTE_THEMED: u8 = 8;
    /// Palette entries 16 to 255, which only a program changes.
    pub const PALETTE_EXTENDED: u8 = 16;
    pub const THEME_PUSH_CLEARS: u8 = FOREGROUND | BACKGROUND | CURSOR | PALETTE_THEMED;

    pub fn dynamic(slot: u8) -> u8 {
        match slot {
            10 => FOREGROUND,
            11 => BACKGROUND,
            12 => CURSOR,
            _ => 0,
        }
    }

    pub fn palette(index: u8) -> u8 {
        if index < 16 {
            PALETTE_THEMED
        } else {
            PALETTE_EXTENDED
        }
    }
}

#[derive(Default)]
pub struct ColorState {
    colors: Mutex<Option<TerminalColors>>,
    diverged: AtomicU8,
    /// `CSI ? 2031 h`: the program wants a report whenever the scheme flips.
    scheme_reports: AtomicBool,
}

impl ColorState {
    pub fn new(colors: Option<TerminalColors>) -> Self {
        Self {
            colors: Mutex::new(colors),
            ..Self::default()
        }
    }

    pub fn snapshot(&self) -> Option<TerminalColors> {
        *self.colors.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn diverged(&self) -> u8 {
        self.diverged.load(Ordering::Relaxed)
    }

    pub fn mark_diverged(&self, bits: u8) {
        if bits != 0 {
            self.diverged.fetch_or(bits, Ordering::Relaxed);
        }
    }

    pub fn clear_diverged(&self, bits: u8) {
        if bits != 0 {
            self.diverged.fetch_and(!bits, Ordering::Relaxed);
        }
    }

    pub fn set_scheme_reports(&self, enabled: bool) {
        self.scheme_reports.store(enabled, Ordering::Relaxed);
    }

    /// Installs a pushed theme. Returns the scheme to report to a program that
    /// enabled `CSI ? 2031 h`, when the theme flipped between dark and light.
    pub fn update(&self, colors: TerminalColors) -> Option<ColorScheme> {
        let previous = self
            .colors
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .replace(colors);
        self.clear_diverged(diverged::THEME_PUSH_CLEARS);
        let scheme = colors.scheme();
        // A webview terminal answers dark until its colours are known.
        let before = previous.map_or(ColorScheme::Dark, |c| c.scheme());
        (self.scheme_reports.load(Ordering::Relaxed) && before != scheme).then_some(scheme)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Terminator {
    Bel,
    St,
}

impl Terminator {
    fn bytes(self) -> &'static [u8] {
        match self {
            Terminator::Bel => b"\x07",
            Terminator::St => b"\x1b\\",
        }
    }
}

/// Appends `ESC ] <selector> ; rgb:RRRR/GGGG/BBBB <terminator>`, the 16-bit
/// form every other terminal (and the webview model) answers with.
pub fn push_color_reply(
    out: &mut Vec<u8>,
    selector: impl std::fmt::Display,
    rgb: Rgb,
    terminator: Terminator,
) {
    let [r, g, b] = rgb.map(|c| u16::from(c) * 257);
    let _ = write!(out, "\x1b]{selector};rgb:{r:04x}/{g:04x}/{b:04x}");
    out.extend_from_slice(terminator.bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colors(background: Rgb) -> TerminalColors {
        TerminalColors {
            foreground: [0xfb, 0xfb, 0xfb],
            background,
            cursor: [0x12, 0x34, 0x56],
            palette: std::array::from_fn(|i| [i as u8; 3]),
        }
    }

    #[test]
    fn replies_use_sixteen_bit_channels_and_the_queried_terminator() {
        let mut out = Vec::new();
        push_color_reply(&mut out, "11", [0x09, 0x0b, 0x0c], Terminator::St);
        assert_eq!(out, b"\x1b]11;rgb:0909/0b0b/0c0c\x1b\\");
        out.clear();
        push_color_reply(&mut out, "4;196", [255, 0, 0], Terminator::Bel);
        assert_eq!(out, b"\x1b]4;196;rgb:ffff/0000/0000\x07");
    }

    #[test]
    fn extended_palette_follows_the_xterm_cube_and_ramp() {
        let c = colors([0, 0, 0]);
        assert_eq!(c.indexed(3), [3, 3, 3]);
        assert_eq!(c.indexed(16), [0, 0, 0]);
        assert_eq!(c.indexed(17), [0, 0, 95]);
        assert_eq!(c.indexed(196), [255, 0, 0]);
        assert_eq!(c.indexed(231), [255, 255, 255]);
        assert_eq!(c.indexed(232), [8, 8, 8]);
        assert_eq!(c.indexed(255), [238, 238, 238]);
    }

    #[test]
    fn scheme_follows_the_background_luma() {
        assert_eq!(colors([0, 0, 0]).scheme(), ColorScheme::Dark);
        assert_eq!(colors([30, 30, 46]).scheme(), ColorScheme::Dark);
        assert_eq!(colors([255, 255, 255]).scheme(), ColorScheme::Light);
        assert_eq!(colors([253, 246, 227]).scheme(), ColorScheme::Light);
    }

    #[test]
    fn a_theme_push_clears_divergence_it_overwrites_and_reports_flips() {
        let state = ColorState::new(Some(colors([0, 0, 0])));
        state.mark_diverged(diverged::BACKGROUND | diverged::PALETTE_EXTENDED);
        assert_eq!(state.update(colors([0, 0, 0])), None);
        assert_eq!(state.diverged(), diverged::PALETTE_EXTENDED);

        state.set_scheme_reports(true);
        assert_eq!(state.update(colors([0, 0, 0])), None);
        assert_eq!(state.update(colors([255; 3])), Some(ColorScheme::Light));
        assert_eq!(state.update(colors([255; 3])), None);
        assert_eq!(state.update(colors([0; 3])), Some(ColorScheme::Dark));
    }

    #[test]
    fn colours_pushed_after_spawn_count_as_a_flip_from_the_dark_default() {
        let state = ColorState::new(None);
        state.set_scheme_reports(true);
        assert_eq!(state.update(colors([0; 3])), None);
        let state = ColorState::new(None);
        state.set_scheme_reports(true);
        assert_eq!(state.update(colors([255; 3])), Some(ColorScheme::Light));
    }
}
