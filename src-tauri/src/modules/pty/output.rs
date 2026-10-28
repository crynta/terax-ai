//! Byte-based flow-control credit for one PTY's output stream.
//!
//! Every data frame handed to the webview is a chunk with a cumulative end
//! offset. The frontend acknowledges cumulative parsed offsets, which must land
//! exactly on a delivered chunk boundary; duplicates, stale offsets and retries
//! therefore cannot grant credit.

use std::collections::VecDeque;

/// Bytes the webview may hold unparsed for one PTY.
pub(super) const MAX_IN_FLIGHT_BYTES: usize = 1024 * 1024;
/// Pending (not yet delivered) plus in-flight bytes the reader may retain.
pub(super) const MAX_BUFFERED_BYTES: usize = 2 * 1024 * 1024;
/// Bounds the boundary list when the output is a stream of tiny chunks. The
/// frontend receiver enforces the same number (`MAX_PENDING_CHUNKS`).
pub(super) const MAX_IN_FLIGHT_CHUNKS: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct InvalidBoundary;

#[derive(Default)]
pub(super) struct OutputCredit {
    sent: u64,
    acknowledged: u64,
    boundaries: VecDeque<u64>,
}

impl OutputCredit {
    pub fn sent_bytes(&self) -> u64 {
        self.sent
    }

    pub fn acknowledged_bytes(&self) -> u64 {
        self.acknowledged
    }

    pub fn in_flight_bytes(&self) -> usize {
        (self.sent - self.acknowledged) as usize
    }

    pub fn in_flight_chunks(&self) -> usize {
        self.boundaries.len()
    }

    /// Bytes that may be sent right now; zero when either the byte window or
    /// the chunk window is full.
    pub fn room(&self) -> usize {
        if self.in_flight_chunks() >= MAX_IN_FLIGHT_CHUNKS {
            0
        } else {
            MAX_IN_FLIGHT_BYTES.saturating_sub(self.in_flight_bytes())
        }
    }

    pub fn sent(&mut self, bytes: usize) {
        assert!(bytes > 0 && bytes <= self.room());
        self.sent += bytes as u64;
        self.boundaries.push_back(self.sent);
    }

    pub fn acknowledge(&mut self, bytes: u64) -> Result<bool, InvalidBoundary> {
        if bytes <= self.acknowledged {
            return Ok(false);
        }
        let index = self
            .boundaries
            .iter()
            .position(|boundary| *boundary == bytes)
            .ok_or(InvalidBoundary)?;
        self.boundaries.drain(..=index);
        self.acknowledged = bytes;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cumulative_acknowledgements_are_idempotent_and_order_independent() {
        let mut credit = OutputCredit::default();
        credit.sent(64 * 1024);
        credit.sent(32 * 1024);
        assert_eq!(credit.in_flight_chunks(), 2);
        assert_eq!(credit.acknowledge(64 * 1024), Ok(true));
        assert_eq!(credit.in_flight_bytes(), 32 * 1024);
        assert_eq!(credit.in_flight_chunks(), 1);
        credit.sent(10);
        assert_eq!(credit.acknowledge(64 * 1024), Ok(false));
        assert_eq!(credit.in_flight_chunks(), 2);
        assert_eq!(credit.acknowledge(96 * 1024 + 10), Ok(true));
        assert_eq!(credit.acknowledge(96 * 1024), Ok(false));
        assert_eq!(credit.in_flight_bytes(), 0);
        assert_eq!(credit.in_flight_chunks(), 0);
    }

    #[test]
    fn invalid_credit_cannot_release_bytes_or_chunks() {
        let mut credit = OutputCredit::default();
        credit.sent(100);
        credit.sent(200);
        for bytes in [1, 101, 299, 301, u64::MAX] {
            assert_eq!(credit.acknowledge(bytes), Err(InvalidBoundary));
            assert_eq!(credit.in_flight_bytes(), 300);
            assert_eq!(credit.in_flight_chunks(), 2);
        }
        assert_eq!(credit.acknowledge(300), Ok(true));
    }

    #[test]
    fn duplicate_and_retried_acknowledgements_grant_no_extra_credit() {
        let mut credit = OutputCredit::default();
        credit.sent(MAX_IN_FLIGHT_BYTES);
        assert_eq!(credit.room(), 0);
        assert_eq!(credit.acknowledge(MAX_IN_FLIGHT_BYTES as u64), Ok(true));
        for _ in 0..10 {
            assert_eq!(credit.acknowledge(MAX_IN_FLIGHT_BYTES as u64), Ok(false));
        }
        assert_eq!(credit.room(), MAX_IN_FLIGHT_BYTES);
        credit.sent(1);
        assert_eq!(credit.room(), MAX_IN_FLIGHT_BYTES - 1);
        // A late duplicate of an older boundary cannot release the new chunk.
        assert_eq!(credit.acknowledge(MAX_IN_FLIGHT_BYTES as u64), Ok(false));
        assert_eq!(credit.in_flight_bytes(), 1);
    }

    #[test]
    fn the_byte_window_bounds_one_pty_at_one_mebibyte() {
        let mut credit = OutputCredit::default();
        credit.sent(MAX_IN_FLIGHT_BYTES / 2);
        assert_eq!(credit.room(), MAX_IN_FLIGHT_BYTES / 2);
        credit.sent(MAX_IN_FLIGHT_BYTES / 2);
        assert_eq!(credit.room(), 0);
        assert_eq!(
            credit.acknowledge((MAX_IN_FLIGHT_BYTES / 2) as u64),
            Ok(true)
        );
        assert_eq!(credit.room(), MAX_IN_FLIGHT_BYTES / 2);
    }

    #[test]
    fn tiny_chunks_are_bounded_by_the_chunk_window() {
        let mut credit = OutputCredit::default();
        for _ in 0..MAX_IN_FLIGHT_CHUNKS {
            assert!(credit.room() > 0);
            credit.sent(1);
        }
        assert_eq!(credit.room(), 0);
        assert_eq!(credit.acknowledge(1), Ok(true));
        assert!(credit.room() > 0);
    }

    #[test]
    fn credit_remains_bounded_over_long_streams_and_lost_replies() {
        let mut credit = OutputCredit::default();
        let mut parsed = 0;
        for _ in 0..100_000 {
            credit.sent(MAX_IN_FLIGHT_BYTES / 2);
            credit.sent(MAX_IN_FLIGHT_BYTES / 2);
            assert_eq!(credit.in_flight_bytes(), MAX_IN_FLIGHT_BYTES);
            parsed += MAX_IN_FLIGHT_BYTES as u64;
            assert_eq!(credit.acknowledge(parsed), Ok(true));
            assert_eq!(credit.acknowledge(parsed), Ok(false));
            assert!(credit.boundaries.capacity() <= 8);
        }
    }
}
