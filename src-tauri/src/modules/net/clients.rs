//! Cached `reqwest` clients for the AI proxy.
//!
//! Every request used to build a fresh client: a new connection pool, a new TLS
//! handshake, no HTTP/2 reuse. Clients are now shared per
//! `(profile, host, pinned IPs, allow_private)`. The pinned addresses are part
//! of the key, so a host that re-resolves to different addresses gets a new
//! client pinned to the new set and DNS-rebinding protection is exactly as
//! strong as with a per-request client: no request can reach an address that
//! was not classified for that very request.

use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::{ip_kind, is_blocked_host_name, IpKind};

/// Idle clients are dropped after this long without use.
pub const IDLE_TTL: Duration = Duration::from_secs(90);
/// Distinct hosts kept warm; a handful of providers plus local servers.
pub const MAX_CLIENTS: usize = 8;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Profile {
    /// Provider calls: long-lived streaming responses, bounded redirects.
    Stream,
    /// Local-model reachability probe: short timeout, no redirects.
    Ping,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ClientKey {
    profile: Profile,
    host: String,
    ips: Vec<IpAddr>,
    allow_private: bool,
}

impl ClientKey {
    pub fn new(profile: Profile, host: &str, ips: &[IpAddr], allow_private: bool) -> Self {
        let mut ips = ips.to_vec();
        ips.sort_unstable();
        ips.dedup();
        Self {
            profile,
            host: host.to_ascii_lowercase(),
            ips,
            allow_private,
        }
    }
}

struct Entry<C> {
    key: ClientKey,
    client: C,
    last_used: Instant,
}

/// Generic over the client so the eviction rules are testable without sockets.
pub struct ClientCache<C> {
    entries: Vec<Entry<C>>,
}

impl<C: Clone> Default for ClientCache<C> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

impl<C: Clone> ClientCache<C> {
    pub fn get_or_insert_with(
        &mut self,
        key: ClientKey,
        now: Instant,
        make: impl FnOnce() -> Result<C, String>,
    ) -> Result<C, String> {
        self.entries
            .retain(|entry| now.saturating_duration_since(entry.last_used) < IDLE_TTL);
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.key == key) {
            entry.last_used = now;
            return Ok(entry.client.clone());
        }
        let client = make()?;
        while self.entries.len() >= MAX_CLIENTS {
            let oldest = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.entries.swap_remove(oldest);
        }
        self.entries.push(Entry {
            key,
            client: client.clone(),
            last_used: now,
        });
        Ok(client)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

static CLIENTS: OnceLock<Mutex<ClientCache<reqwest::Client>>> = OnceLock::new();
static CRYPTO: OnceLock<()> = OnceLock::new();

/// reqwest is built without a bundled provider, so the process needs exactly
/// one installed default. The updater installs the same `ring` provider.
fn ensure_crypto_provider() {
    CRYPTO.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

#[derive(Debug, PartialEq, Eq)]
pub enum RedirectDecision {
    Follow,
    Stop,
    TooMany,
}

/// Scheme, userinfo and host checks mirror the request validation. Without
/// `allow_private` a redirect may not leave the host whose addresses were
/// pinned, so a public API cannot bounce a request onto an internal address.
pub fn redirect_decision(
    next: &reqwest::Url,
    last_previous: Option<&reqwest::Url>,
    previous_len: usize,
    allow_private: bool,
) -> RedirectDecision {
    if previous_len > 10 {
        return RedirectDecision::TooMany;
    }
    match next.scheme() {
        "http" | "https" => {}
        _ => return RedirectDecision::Stop,
    }
    if next.username() != "" || next.password().is_some() {
        return RedirectDecision::Stop;
    }
    let Some(host) = next.host_str() else {
        return RedirectDecision::Stop;
    };
    if is_blocked_host_name(host) {
        return RedirectDecision::Stop;
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let kind = ip_kind(ip);
        if kind == IpKind::BlockedMetadata {
            return RedirectDecision::Stop;
        }
        if !allow_private && matches!(kind, IpKind::Loopback | IpKind::Private) {
            return RedirectDecision::Stop;
        }
    } else if !allow_private {
        if let Some(prev) = last_previous {
            if prev.host_str() != Some(host) {
                return RedirectDecision::Stop;
            }
        }
    }
    RedirectDecision::Follow
}

fn redirect_policy(allow_private: bool) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        match redirect_decision(
            attempt.url(),
            attempt.previous().last(),
            attempt.previous().len(),
            allow_private,
        ) {
            RedirectDecision::Follow => attempt.follow(),
            RedirectDecision::Stop => attempt.stop(),
            RedirectDecision::TooMany => attempt.error("too many redirects"),
        }
    })
}

fn build_client(key: &ClientKey) -> Result<reqwest::Client, String> {
    ensure_crypto_provider();
    let mut builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(10));
    // Pin the resolver to the addresses that passed classification. Without
    // this, reqwest's own lookup could return a different (private or
    // metadata) address between classify and connect. The port is filled in
    // from the URL.
    if !key.ips.is_empty() {
        let addrs: Vec<SocketAddr> = key.ips.iter().map(|ip| SocketAddr::new(*ip, 0)).collect();
        builder = builder.resolve_to_addrs(&key.host, &addrs);
    }
    builder = match key.profile {
        Profile::Stream => builder
            .redirect(redirect_policy(key.allow_private))
            .pool_idle_timeout(IDLE_TTL)
            .pool_max_idle_per_host(2)
            // One stalled consumer must not starve other streams multiplexed
            // on the same HTTP/2 connection: keep the connection window above
            // the sum of a few stream windows.
            .http2_initial_stream_window_size(256 * 1024)
            .http2_initial_connection_window_size(2 * 1024 * 1024),
        Profile::Ping => builder
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none()),
    };
    builder.build().map_err(|e| e.to_string())
}

/// A client pinned to `ips` for `host`, reused while that exact set is current.
pub fn client_for(
    profile: Profile,
    host: &str,
    ips: &[IpAddr],
    allow_private: bool,
) -> Result<reqwest::Client, String> {
    let key = ClientKey::new(profile, host, ips, allow_private);
    let cache = CLIENTS.get_or_init(|| Mutex::new(ClientCache::default()));
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    cache.get_or_insert_with(key.clone(), Instant::now(), || build_client(&key))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn key(host: &str, ips: &[&str], allow_private: bool) -> ClientKey {
        let ips: Vec<IpAddr> = ips.iter().map(|s| ip(s)).collect();
        ClientKey::new(Profile::Stream, host, &ips, allow_private)
    }

    #[test]
    fn identical_destinations_share_a_client_and_count_one_build() {
        let mut cache = ClientCache::<u32>::default();
        let now = Instant::now();
        let mut builds = 0;
        for _ in 0..3 {
            let got = cache
                .get_or_insert_with(key("api.example.com", &["1.1.1.1"], false), now, || {
                    builds += 1;
                    Ok(7)
                })
                .unwrap();
            assert_eq!(got, 7);
        }
        assert_eq!(builds, 1);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn pinned_addresses_are_part_of_the_key_so_rebinding_cannot_reuse_a_client() {
        let a = key("api.example.com", &["1.1.1.1"], false);
        let rebound = key("api.example.com", &["169.254.169.254"], false);
        assert_ne!(a, rebound);
        let mut cache = ClientCache::<u32>::default();
        let now = Instant::now();
        let first = cache.get_or_insert_with(a, now, || Ok(1)).unwrap();
        let second = cache.get_or_insert_with(rebound, now, || Ok(2)).unwrap();
        assert_eq!((first, second), (1, 2));
    }

    #[test]
    fn address_order_and_host_case_do_not_split_the_cache() {
        assert_eq!(
            key("API.Example.com", &["1.1.1.1", "8.8.8.8"], false),
            key("api.example.com", &["8.8.8.8", "1.1.1.1", "1.1.1.1"], false)
        );
    }

    #[test]
    fn private_opt_in_and_profile_are_part_of_the_key() {
        assert_ne!(
            key("localhost", &["127.0.0.1"], true),
            key("localhost", &["127.0.0.1"], false)
        );
        let ips = [ip("127.0.0.1")];
        assert_ne!(
            ClientKey::new(Profile::Stream, "localhost", &ips, true),
            ClientKey::new(Profile::Ping, "localhost", &ips, true)
        );
    }

    #[test]
    fn idle_clients_expire() {
        let mut cache = ClientCache::<u32>::default();
        let now = Instant::now();
        let k = key("a.example.com", &["1.1.1.1"], false);
        cache.get_or_insert_with(k.clone(), now, || Ok(1)).unwrap();
        let reused = cache
            .get_or_insert_with(k.clone(), now + IDLE_TTL - Duration::from_secs(1), || Ok(2))
            .unwrap();
        assert_eq!(reused, 1);
        let rebuilt = cache
            .get_or_insert_with(
                k,
                now + IDLE_TTL - Duration::from_secs(1) + IDLE_TTL + Duration::from_secs(1),
                || Ok(3),
            )
            .unwrap();
        assert_eq!(
            rebuilt, 3,
            "use refreshes the TTL; a full idle period expires it"
        );
    }

    #[test]
    fn the_cache_is_bounded_and_evicts_the_least_recently_used() {
        let mut cache = ClientCache::<usize>::default();
        let now = Instant::now();
        for i in 0..(MAX_CLIENTS + 3) {
            let k = key(&format!("h{i}.example.com"), &["1.1.1.1"], false);
            cache
                .get_or_insert_with(k, now + Duration::from_secs(i as u64), || Ok(i))
                .unwrap();
        }
        assert_eq!(cache.len(), MAX_CLIENTS);
        let oldest = key("h0.example.com", &["1.1.1.1"], false);
        let mut rebuilt = false;
        cache
            .get_or_insert_with(oldest, now + Duration::from_secs(20), || {
                rebuilt = true;
                Ok(0)
            })
            .unwrap();
        assert!(rebuilt, "the oldest entry was evicted");
    }

    #[test]
    fn a_failed_build_is_not_cached() {
        let mut cache = ClientCache::<u32>::default();
        let now = Instant::now();
        let k = key("a.example.com", &["1.1.1.1"], false);
        assert!(cache
            .get_or_insert_with(k.clone(), now, || Err("boom".into()))
            .is_err());
        assert!(cache.is_empty());
        assert_eq!(cache.get_or_insert_with(k, now, || Ok(5)).unwrap(), 5);
    }

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn redirects_stay_on_the_pinned_host_unless_private_access_was_granted() {
        let from = url("https://api.example.com/v1");
        let same = url("https://api.example.com/v2");
        let other = url("https://evil.example.net/");
        assert_eq!(
            redirect_decision(&same, Some(&from), 1, false),
            RedirectDecision::Follow
        );
        assert_eq!(
            redirect_decision(&other, Some(&from), 1, false),
            RedirectDecision::Stop
        );
        assert_eq!(
            redirect_decision(&other, Some(&from), 1, true),
            RedirectDecision::Follow
        );
    }

    #[test]
    fn redirects_never_reach_metadata_or_unsafe_schemes_or_userinfo() {
        let from = url("http://localhost:11434/");
        for target in [
            "http://169.254.169.254/latest",
            "http://[fe80::1]/",
            "http://metadata.google.internal/",
            "ftp://example.com/",
            "https://user:pw@example.com/",
        ] {
            assert_eq!(
                redirect_decision(&url(target), Some(&from), 1, true),
                RedirectDecision::Stop,
                "{target}"
            );
        }
    }

    #[test]
    fn ipv6_literal_redirects_are_classified_not_mistaken_for_hostnames() {
        let from = url("https://api.example.com/");
        assert_eq!(
            redirect_decision(&url("http://[::1]:8080/"), Some(&from), 1, false),
            RedirectDecision::Stop
        );
        assert_eq!(
            redirect_decision(&url("http://[::1]:8080/"), Some(&from), 1, true),
            RedirectDecision::Follow
        );
        assert_eq!(
            redirect_decision(&url("https://[2606:4700::1111]/"), Some(&from), 1, false),
            RedirectDecision::Follow,
            "public IP literals are allowed; only the address class matters"
        );
    }

    #[test]
    fn redirects_to_internal_addresses_hidden_in_ipv6_are_stopped() {
        let from = url("https://api.example.com/");
        for target in [
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:10.0.0.1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://[::ffff:169.254.169.254]/latest/meta-data",
            "http://[::127.0.0.1]/",
            "http://[64:ff9b::7f00:1]/",
            "http://[2002:7f00:1::]/",
            "http://[fe80::1]/",
            "http://[fc00::1]/",
            "http://[fd12:3456::1]/",
            "http://[fec0::1]/",
            "http://[ff02::1]/",
            "http://[::]/",
        ] {
            assert_eq!(
                redirect_decision(&url(target), Some(&from), 1, false),
                RedirectDecision::Stop,
                "{target}"
            );
        }
        for target in [
            "http://[::ffff:169.254.169.254]/",
            "http://[64:ff9b::a9fe:a9fe]/",
            "http://[2002:a9fe:a9fe::]/",
            "http://[fe80::1]/",
        ] {
            assert_eq!(
                redirect_decision(&url(target), Some(&from), 1, true),
                RedirectDecision::Stop,
                "{target} is metadata even with private access"
            );
        }
        for target in [
            "http://[::ffff:127.0.0.1]:11434/",
            "http://[::ffff:10.0.0.1]/",
        ] {
            assert_eq!(
                redirect_decision(&url(target), Some(&from), 1, true),
                RedirectDecision::Follow,
                "{target}"
            );
        }
        assert_eq!(
            redirect_decision(&url("https://[::ffff:8.8.8.8]/"), Some(&from), 1, false),
            RedirectDecision::Follow
        );
    }

    #[test]
    fn redirect_chains_are_bounded() {
        let u = url("https://api.example.com/");
        assert_eq!(
            redirect_decision(&u, Some(&u), 10, false),
            RedirectDecision::Follow
        );
        assert_eq!(
            redirect_decision(&u, Some(&u), 11, false),
            RedirectDecision::TooMany
        );
    }

    #[test]
    fn real_clients_build_with_http2_and_pinned_resolution() {
        let k = key(
            "api.example.com",
            &["93.184.216.34", "2606:2800:220:1::1"],
            false,
        );
        build_client(&k).expect("stream client");
        let ping = ClientKey::new(Profile::Ping, "localhost", &[ip("127.0.0.1")], true);
        build_client(&ping).expect("ping client");
    }
}
