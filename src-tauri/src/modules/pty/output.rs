use std::collections::VecDeque;

pub(super) const MAX_IN_FLIGHT_CHUNKS: usize = 2;
pub(super) const MAX_BUFFERED_BYTES: usize = 2 * 1024 * 1024;

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

    pub fn can_send(&self) -> bool {
        self.in_flight_chunks() < MAX_IN_FLIGHT_CHUNKS
    }

    pub fn sent(&mut self, bytes: usize) {
        assert!(bytes > 0 && self.can_send());
        assert!(self.in_flight_bytes() + bytes <= MAX_BUFFERED_BYTES);
        self.sent += bytes as u64;
        self.boundaries.push_back(self.sent);
    }

    pub fn acknowledge(&mut self, bytes: u64) -> Result<bool, &'static str> {
        if bytes <= self.acknowledged {
            return Ok(false);
        }
        let index = self
            .boundaries
            .iter()
            .position(|boundary| *boundary == bytes)
            .ok_or("pty_ack_output: invalid output boundary")?;
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
        assert!(!credit.can_send());
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
    fn invalid_credit_cannot_release_bytes_or_messages() {
        let mut credit = OutputCredit::default();
        credit.sent(100);
        credit.sent(200);
        for bytes in [1, 101, 299, 301, u64::MAX] {
            assert!(credit.acknowledge(bytes).is_err());
            assert_eq!(credit.in_flight_bytes(), 300);
            assert_eq!(credit.in_flight_chunks(), 2);
        }
        assert_eq!(credit.acknowledge(300), Ok(true));
    }

    #[test]
    fn credit_remains_bounded_over_long_streams_and_lost_replies() {
        let mut credit = OutputCredit::default();
        let mut parsed = 0;
        for _ in 0..100_000 {
            credit.sent(MAX_BUFFERED_BYTES / 2);
            credit.sent(MAX_BUFFERED_BYTES / 2);
            assert_eq!(credit.in_flight_bytes(), MAX_BUFFERED_BYTES);
            parsed += MAX_BUFFERED_BYTES as u64;
            assert_eq!(credit.acknowledge(parsed), Ok(true));
            assert_eq!(credit.acknowledge(parsed), Ok(false));
            assert!(credit.boundaries.capacity() <= 8);
        }
    }
}
