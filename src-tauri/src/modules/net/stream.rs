//! Flow control and request ownership for streamed AI responses.
//!
//! Credit is counted in bytes, not messages. The webview acknowledges
//! cumulative offsets once at least half a window has arrived, so a normal SSE
//! stream of small chunks costs a handful of acknowledgment calls per response
//! instead of one per couple of chunks. Together with the webview's 64 KiB
//! stream buffer the window bounds unconsumed data at 192 KiB per request.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{AbortHandle, AbortRegistration};
use tokio::sync::Notify;

/// Largest payload of one packet.
pub const CHUNK_BYTES: usize = 64 * 1024;
/// Unacknowledged bytes allowed in flight.
pub const WINDOW_BYTES: u64 = 128 * 1024;
/// Unacknowledged packets allowed in flight; bounds the boundary ledger when a
/// server sends tiny chunks. The webview acknowledges well before this.
pub const MAX_UNACKED_PACKETS: usize = 256;
/// A consumer that grants no credit for this long while the response is
/// waiting on it is abandoned and the request is cancelled.
pub const CONSUMER_IDLE: Duration = Duration::from_secs(120);
const MAX_REQUESTS: usize = 16;
type Key = (String, String);

#[derive(Clone, Default)]
pub struct AiStreamState(Arc<Mutex<HashMap<Key, Arc<StreamControl>>>>);

pub struct StreamControl {
    abort: AbortHandle,
    credit: Mutex<Credit>,
    changed: Notify,
}

#[derive(Default)]
struct Credit {
    sent: u64,
    acknowledged: u64,
    boundaries: VecDeque<u64>,
}

impl Credit {
    fn outstanding(&self) -> u64 {
        self.sent - self.acknowledged
    }

    fn admits(&self, bytes: u64) -> bool {
        self.outstanding() == 0
            || (self.outstanding() + bytes <= WINDOW_BYTES
                && self.boundaries.len() < MAX_UNACKED_PACKETS)
    }
}

pub struct StreamLease {
    state: AiStreamState,
    key: Key,
    pub control: Arc<StreamControl>,
}

impl AiStreamState {
    pub fn start(
        &self,
        window: &str,
        id: &str,
    ) -> Result<(StreamLease, AbortRegistration), String> {
        if id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err("invalid AI request id".into());
        }
        let key = (window.to_owned(), id.to_owned());
        let mut requests = self.0.lock().unwrap();
        if requests.contains_key(&key) {
            return Err("AI request id is already active".into());
        }
        if requests.len() >= MAX_REQUESTS {
            return Err("too many active AI requests".into());
        }
        let (abort, registration) = AbortHandle::new_pair();
        let control = Arc::new(StreamControl {
            abort,
            credit: Mutex::new(Credit::default()),
            changed: Notify::new(),
        });
        requests.insert(key.clone(), control.clone());
        Ok((
            StreamLease {
                state: self.clone(),
                key,
                control,
            },
            registration,
        ))
    }

    pub fn cancel(&self, window: &str, id: &str) {
        let request = self
            .0
            .lock()
            .unwrap()
            .get(&(window.to_owned(), id.to_owned()))
            .cloned();
        if let Some(request) = request {
            request.abort.abort();
        }
    }

    pub fn cancel_window(&self, window: &str) {
        let requests: Vec<_> = self
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|((owner, _), _)| owner == window)
            .map(|(_, request)| request.clone())
            .collect();
        for request in requests {
            request.abort.abort();
        }
    }

    pub fn acknowledge(&self, window: &str, id: &str, bytes: u64) -> Result<(), String> {
        let request = self
            .0
            .lock()
            .unwrap()
            .get(&(window.to_owned(), id.to_owned()))
            .cloned();
        match request {
            Some(request) => request.acknowledge(bytes),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    fn active(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

impl Drop for StreamLease {
    fn drop(&mut self) {
        self.state.0.lock().unwrap().remove(&self.key);
    }
}

impl StreamControl {
    /// Takes credit for one packet if the window has room.
    pub fn try_reserve(&self, bytes: usize) -> Result<bool, String> {
        if bytes == 0 || bytes > CHUNK_BYTES {
            return Err("invalid AI stream chunk size".into());
        }
        let mut credit = self.credit.lock().unwrap();
        if !credit.admits(bytes as u64) {
            return Ok(false);
        }
        credit.sent = credit
            .sent
            .checked_add(bytes as u64)
            .ok_or("AI stream byte offset overflow")?;
        let end = credit.sent;
        credit.boundaries.push_back(end);
        Ok(true)
    }

    /// Resolves when an acknowledgment may have freed credit. Fails when the
    /// consumer grants nothing for `CONSUMER_IDLE`, which ends the request
    /// instead of pinning its slot (and the provider connection) until the
    /// page reloads.
    pub async fn credit_changed(&self) -> Result<(), String> {
        self.credit_changed_within(CONSUMER_IDLE).await
    }

    async fn credit_changed_within(&self, idle: Duration) -> Result<(), String> {
        tokio::time::timeout(idle, self.changed.notified())
            .await
            .map_err(|_| "AI stream consumer stopped reading".to_string())
    }

    /// Waits for room for `bytes`, then takes it.
    #[cfg(test)]
    async fn reserve(&self, bytes: usize) -> Result<(), String> {
        while !self.try_reserve(bytes)? {
            self.credit_changed().await?;
        }
        Ok(())
    }

    fn acknowledge(&self, bytes: u64) -> Result<(), String> {
        let mut credit = self.credit.lock().unwrap();
        if bytes <= credit.acknowledged {
            return Ok(());
        }
        let count = credit
            .boundaries
            .iter()
            .position(|boundary| *boundary == bytes)
            .ok_or("invalid AI stream acknowledgment")?
            + 1;
        credit.boundaries.drain(..count);
        credit.acknowledged = bytes;
        drop(credit);
        self.changed.notify_one();
        Ok(())
    }
}

/// Appends as much of `carry` as fits into `packet` (whose first byte is the
/// packet kind), leaving the rest in `carry`.
pub fn fill_packet(packet: &mut Vec<u8>, carry: &mut bytes::Bytes) {
    use bytes::Buf;
    let room = CHUNK_BYTES.saturating_sub(packet.len().saturating_sub(1));
    let take = room.min(carry.len());
    packet.extend_from_slice(&carry[..take]);
    carry.advance(take);
}

pub fn payload_len(packet: &[u8]) -> usize {
    packet.len().saturating_sub(1)
}

pub fn new_packet(kind: u8, capacity: usize) -> Vec<u8> {
    let mut packet = Vec::with_capacity(capacity.min(CHUNK_BYTES) + 1);
    packet.push(kind);
    packet
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use futures_util::{future::Abortable, FutureExt};

    #[test]
    fn credit_is_counted_in_bytes_so_tiny_chunks_do_not_exhaust_the_window() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = &lease.control;
        // Hundreds of small SSE-sized chunks fit before any acknowledgment.
        for _ in 0..200 {
            assert_eq!(c.try_reserve(100), Ok(true));
        }
        assert_eq!(c.credit.lock().unwrap().outstanding(), 20_000);
    }

    #[test]
    fn the_window_blocks_by_bytes_and_a_lone_packet_always_fits() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = &lease.control;
        assert_eq!(c.try_reserve(CHUNK_BYTES), Ok(true));
        assert_eq!(c.try_reserve(CHUNK_BYTES), Ok(true));
        assert_eq!(c.try_reserve(1), Ok(false), "128 KiB in flight");
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64)
            .unwrap();
        assert_eq!(c.try_reserve(CHUNK_BYTES), Ok(true));
        assert_eq!(c.try_reserve(1), Ok(false));
    }

    #[test]
    fn the_packet_ledger_is_bounded_even_for_one_byte_chunks() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = &lease.control;
        for _ in 0..MAX_UNACKED_PACKETS {
            assert_eq!(c.try_reserve(1), Ok(true));
        }
        assert_eq!(c.try_reserve(1), Ok(false));
        assert!(c.credit.lock().unwrap().boundaries.len() <= MAX_UNACKED_PACKETS);
        state
            .acknowledge("main", "request", (MAX_UNACKED_PACKETS / 2) as u64)
            .unwrap();
        assert_eq!(c.try_reserve(1), Ok(true));
    }

    #[test]
    fn acknowledgments_must_land_on_unacknowledged_packet_boundaries() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = &lease.control;
        c.try_reserve(CHUNK_BYTES).unwrap();
        c.try_reserve(10).unwrap();
        assert!(state.acknowledge("main", "request", 1).is_err());
        assert!(
            state
                .acknowledge("main", "request", CHUNK_BYTES as u64 + 11)
                .is_err(),
            "credit that was never sent"
        );
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64 + 10)
            .unwrap();
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64)
            .unwrap();
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64 + 10)
            .unwrap();
        assert_eq!(c.credit.lock().unwrap().outstanding(), 0);
        assert!(c.try_reserve(0).is_err());
        assert!(c.try_reserve(CHUNK_BYTES + 1).is_err());
    }

    #[tokio::test]
    async fn reserve_resumes_when_credit_arrives() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = lease.control.clone();
        c.try_reserve(CHUNK_BYTES).unwrap();
        c.try_reserve(CHUNK_BYTES).unwrap();
        let mut waiting = Box::pin({
            let c = c.clone();
            async move { c.reserve(10).await }
        });
        assert!(waiting.as_mut().now_or_never().is_none());
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64)
            .unwrap();
        assert_eq!(waiting.as_mut().now_or_never(), Some(Ok(())));
    }

    #[tokio::test(start_paused = true)]
    async fn a_consumer_that_grants_no_credit_is_abandoned_after_the_idle_timeout() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = lease.control.clone();
        c.try_reserve(CHUNK_BYTES).unwrap();
        c.try_reserve(CHUNK_BYTES).unwrap();
        let waiting = tokio::spawn({
            let c = c.clone();
            async move { c.reserve(CHUNK_BYTES).await }
        });
        tokio::time::sleep(CONSUMER_IDLE + Duration::from_secs(1)).await;
        let result = waiting.await.unwrap();
        assert!(result.unwrap_err().contains("stopped reading"));
    }

    #[tokio::test(start_paused = true)]
    async fn steady_acknowledgments_keep_a_slow_consumer_alive() {
        let state = AiStreamState::default();
        let (lease, _) = state.start("main", "request").unwrap();
        let c = lease.control.clone();
        c.try_reserve(CHUNK_BYTES).unwrap();
        c.try_reserve(CHUNK_BYTES).unwrap();
        let waiting = tokio::spawn({
            let c = c.clone();
            async move { c.reserve(CHUNK_BYTES).await }
        });
        tokio::time::sleep(CONSUMER_IDLE - Duration::from_secs(1)).await;
        state
            .acknowledge("main", "request", CHUNK_BYTES as u64)
            .unwrap();
        assert_eq!(waiting.await.unwrap(), Ok(()));
    }

    #[test]
    fn cancellation_is_owned_by_the_calling_window_and_releases_registration() {
        let state = AiStreamState::default();
        let (lease, registration) = state.start("main", "request").unwrap();
        state.cancel("settings", "request");
        assert!(!lease.control.abort.is_aborted());
        state.cancel("main", "request");
        assert!(Abortable::new(std::future::pending::<()>(), registration)
            .now_or_never()
            .unwrap()
            .is_err());
        drop(lease);
        assert_eq!(state.active(), 0);
    }

    #[tokio::test]
    async fn closing_a_window_aborts_requests_waiting_for_consumer_credit() {
        let state = AiStreamState::default();
        let (lease, registration) = state.start("main", "request").unwrap();
        lease.control.try_reserve(CHUNK_BYTES).unwrap();
        lease.control.try_reserve(CHUNK_BYTES).unwrap();
        state.cancel_window("main");
        let control = lease.control.clone();
        assert!(Abortable::new(
            async move { control.reserve(CHUNK_BYTES).await },
            registration
        )
        .now_or_never()
        .is_none_or(|result| result.is_err()));
    }

    #[test]
    fn registrations_are_bounded_and_ids_cannot_replace_live_owners() {
        let state = AiStreamState::default();
        let leases: Vec<_> = (0..MAX_REQUESTS)
            .map(|i| state.start("main", &i.to_string()).unwrap())
            .collect();
        assert!(state.start("main", "0").is_err());
        assert!(state.start("main", "overflow").is_err());
        drop(leases);
        assert!(state.start("main", "new").is_ok());
        assert!(state.start("main", "../invalid").is_err());
    }

    #[test]
    fn packets_fill_to_the_chunk_limit_and_carry_the_remainder() {
        let mut packet = new_packet(1, 0);
        let mut carry = Bytes::from(vec![7u8; CHUNK_BYTES + 5]);
        fill_packet(&mut packet, &mut carry);
        assert_eq!(payload_len(&packet), CHUNK_BYTES);
        assert_eq!(carry.len(), 5);
        assert_eq!(packet[0], 1);

        let mut next = new_packet(1, 0);
        fill_packet(&mut next, &mut carry);
        assert_eq!(payload_len(&next), 5);
        assert!(carry.is_empty());

        let mut more = Bytes::from_static(b"abc");
        fill_packet(&mut next, &mut more);
        assert_eq!(
            payload_len(&next),
            8,
            "small chunks coalesce into one packet"
        );
        assert_eq!(&next[6..], b"abc");
    }

    #[test]
    fn a_full_packet_takes_nothing_more() {
        let mut packet = new_packet(1, 0);
        let mut first = Bytes::from(vec![1u8; CHUNK_BYTES]);
        fill_packet(&mut packet, &mut first);
        let mut extra = Bytes::from_static(b"zz");
        fill_packet(&mut packet, &mut extra);
        assert_eq!(payload_len(&packet), CHUNK_BYTES);
        assert_eq!(extra.len(), 2);
    }
}
