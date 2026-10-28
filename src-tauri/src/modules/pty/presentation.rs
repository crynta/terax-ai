//! Per-PTY presentation classes and the coalescing deadline each implies.
//!
//! The frontend reports which class a terminal is in (`pty_set_presentation`)
//! only when it changes. Hidden terminals do not need 4 ms latency: they only
//! need their model kept current, so their output is delivered in larger,
//! rarer batches. Window occlusion and system sleep are applied natively.

use std::time::Duration;

use serde::Deserialize;

/// Sparse output keeps low interactive latency.
pub(super) const INTERACTIVE_COALESCE: Duration = Duration::from_millis(4);
/// Sustained focused output is aligned to the display cadence.
pub(super) const SUSTAINED_COALESCE: Duration = Duration::from_millis(16);
pub(super) const SUSTAINED_WINDOW: Duration = Duration::from_millis(40);
pub(super) const VISIBLE_COALESCE: Duration = Duration::from_millis(16);
pub(super) const HIDDEN_COALESCE: Duration = Duration::from_millis(100);
pub(super) const OCCLUDED_COALESCE: Duration = Duration::from_millis(250);
/// A queue this large is always due immediately, whatever the class. A flood
/// otherwise runs in lockstep with the poll round trip; at 256 KiB a 16 MiB
/// `cat` makes about 65 responses instead of about 250 at equal throughput.
pub(super) const IMMEDIATE_BYTES: usize = 256 * 1024;
/// When a response goes out, PTYs due within this window ride along so
/// wakeups across terminals line up instead of fanning out.
pub(super) const ALIGN_WINDOW: Duration = INTERACTIVE_COALESCE;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum PresentationClass {
    /// Visible and the active pane: the user is typing here.
    #[default]
    Focused,
    /// Visible in a split but not the active pane.
    Visible,
    /// In a hidden tab or otherwise off screen.
    Hidden,
    /// The window is occluded, minimised, or the machine is asleep.
    Occluded,
}

impl PresentationClass {
    /// Lower is served first when a response runs out of room.
    pub(super) fn priority(self) -> u8 {
        match self {
            Self::Focused => 0,
            Self::Visible => 1,
            Self::Hidden => 2,
            Self::Occluded => 3,
        }
    }
}

/// How long the oldest pending byte may wait before the PTY is due.
pub(super) fn coalesce_delay(
    class: PresentationClass,
    since_last_send: Option<Duration>,
    pending_bytes: usize,
) -> Duration {
    if pending_bytes >= IMMEDIATE_BYTES {
        return Duration::ZERO;
    }
    match class {
        PresentationClass::Focused => {
            if since_last_send.is_some_and(|elapsed| elapsed <= SUSTAINED_WINDOW) {
                SUSTAINED_COALESCE
            } else {
                INTERACTIVE_COALESCE
            }
        }
        PresentationClass::Visible => VISIBLE_COALESCE,
        PresentationClass::Hidden => HIDDEN_COALESCE,
        PresentationClass::Occluded => OCCLUDED_COALESCE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [PresentationClass; 4] = [
        PresentationClass::Focused,
        PresentationClass::Visible,
        PresentationClass::Hidden,
        PresentationClass::Occluded,
    ];

    #[test]
    fn focused_output_keeps_interactive_latency_and_bounds_sustained_ipc() {
        let focused = PresentationClass::Focused;
        assert_eq!(coalesce_delay(focused, None, 1), INTERACTIVE_COALESCE);
        assert_eq!(
            coalesce_delay(focused, Some(Duration::from_millis(100)), 1),
            INTERACTIVE_COALESCE
        );
        assert_eq!(
            coalesce_delay(focused, Some(Duration::from_millis(10)), 1),
            SUSTAINED_COALESCE
        );
        assert_eq!(
            coalesce_delay(focused, Some(SUSTAINED_WINDOW), 1),
            SUSTAINED_COALESCE
        );
    }

    #[test]
    fn each_class_has_its_documented_deadline() {
        let at = |class| coalesce_delay(class, None, 1);
        assert_eq!(at(PresentationClass::Focused), Duration::from_millis(4));
        assert_eq!(at(PresentationClass::Visible), Duration::from_millis(16));
        assert_eq!(at(PresentationClass::Hidden), Duration::from_millis(100));
        assert_eq!(at(PresentationClass::Occluded), Duration::from_millis(250));
        // Recent activity does not shorten a non-focused deadline.
        let recent = Some(Duration::from_millis(1));
        assert_eq!(
            coalesce_delay(PresentationClass::Hidden, recent, 1),
            HIDDEN_COALESCE
        );
    }

    #[test]
    fn a_large_queue_is_due_immediately_in_every_class() {
        for class in ALL {
            assert_eq!(
                coalesce_delay(class, Some(Duration::ZERO), IMMEDIATE_BYTES),
                Duration::ZERO,
                "{class:?}"
            );
            assert!(
                coalesce_delay(class, None, IMMEDIATE_BYTES - 1) > Duration::ZERO,
                "{class:?}"
            );
        }
    }

    #[test]
    fn classes_deserialize_from_the_frontend_names() {
        for (name, class) in [
            ("focused", PresentationClass::Focused),
            ("visible", PresentationClass::Visible),
            ("hidden", PresentationClass::Hidden),
            ("occluded", PresentationClass::Occluded),
        ] {
            let parsed: PresentationClass = serde_json::from_str(&format!("\"{name}\"")).unwrap();
            assert_eq!(parsed, class);
        }
        assert!(serde_json::from_str::<PresentationClass>("\"bogus\"").is_err());
    }

    #[test]
    fn priority_orders_focused_first() {
        let mut classes = ALL;
        classes.reverse();
        classes.sort_by_key(|class| class.priority());
        assert_eq!(classes, ALL);
    }
}
