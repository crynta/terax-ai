//! Address classification for the SSRF guard. Pure: no I/O, no DNS.
//!
//! An IPv6 address can carry an IPv4 destination (IPv4-mapped, IPv4-compatible,
//! NAT64, 6to4, Teredo). A dual-stack or translating network delivers such a
//! packet to the embedded IPv4 host, so the embedded address decides the class:
//! `::ffff:169.254.169.254` is the metadata service, not a public host.
//! Everything outside global unicast (`2000::/3`) is treated as non-public.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(super) enum IpKind {
    Public,
    Private,
    Loopback,
    BlockedMetadata,
}

impl IpKind {
    /// How dangerous the class is; the highest of several addresses wins.
    fn severity(self) -> u8 {
        match self {
            Self::Public => 0,
            Self::Private => 1,
            Self::Loopback => 2,
            Self::BlockedMetadata => 3,
        }
    }
}

pub(super) fn ip_kind(ip: IpAddr) -> IpKind {
    match ip {
        IpAddr::V4(v) => ipv4_kind(v),
        IpAddr::V6(v) => ipv6_kind(v),
    }
}

fn ipv4_kind(v: Ipv4Addr) -> IpKind {
    let o = v.octets();
    // Cloud metadata IPv4: 169.254.169.254
    if v.is_link_local() {
        return IpKind::BlockedMetadata;
    }
    // 0.0.0.0/8 is "this host" to most stacks.
    if v.is_loopback() || o[0] == 0 || v.is_broadcast() || v.is_multicast() {
        return IpKind::Loopback;
    }
    // RFC1918, CGNAT, benchmarking, IETF assignments, documentation, reserved.
    if o[0] == 10
        || (o[0] == 172 && (16..=31).contains(&o[1]))
        || (o[0] == 192 && o[1] == 168)
        || (o[0] == 100 && (64..=127).contains(&o[1]))
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 192 && o[1] == 0 && o[2] == 2)
        || (o[0] == 198 && o[1] == 51 && o[2] == 100)
        || (o[0] == 203 && o[1] == 0 && o[2] == 113)
        || o[0] >= 240
    {
        return IpKind::Private;
    }
    IpKind::Public
}

fn ipv6_kind(v: Ipv6Addr) -> IpKind {
    let s = v.segments();
    if v.is_unspecified() || v.is_loopback() || v.is_multicast() {
        return IpKind::Loopback;
    }
    // Cloud metadata IPv6 (AWS): fd00:ec2::254
    if s[0] == 0xfd00 && s[1] == 0xec2 {
        return IpKind::BlockedMetadata;
    }
    // fe80::/10 link-local
    if s[0] & 0xffc0 == 0xfe80 {
        return IpKind::BlockedMetadata;
    }
    if let Some(embedded) = embedded_ipv4(&s) {
        return embedded
            .into_iter()
            .flatten()
            .map(ipv4_kind)
            .max_by_key(|kind| kind.severity())
            .unwrap_or(IpKind::Public);
    }
    // Outside global unicast: unique-local fc00::/7, site-local fec0::/10,
    // discard 100::/64, local-use NAT64 64:ff9b:1::/48, and anything
    // unallocated or reserved.
    if s[0] & 0xe000 != 0x2000 {
        return IpKind::Private;
    }
    // IETF protocol assignments 2001::/23 (Teredo is handled above),
    // documentation 2001:db8::/32 and 3fff::/20.
    if s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8) || s[0] == 0x3fff && s[1] < 0x1000 {
        return IpKind::Private;
    }
    IpKind::Public
}

/// The IPv4 addresses a transition-mechanism IPv6 address delivers to, if it
/// is one.
fn embedded_ipv4(s: &[u16; 8]) -> Option<[Option<Ipv4Addr>; 2]> {
    let v4 = |hi: u16, lo: u16| {
        let [a, b] = hi.to_be_bytes();
        let [c, d] = lo.to_be_bytes();
        Some(Ipv4Addr::new(a, b, c, d))
    };
    match s {
        // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, deprecated)
        [0, 0, 0, 0, 0, 0xffff, hi, lo] | [0, 0, 0, 0, 0, 0, hi, lo] => Some([v4(*hi, *lo), None]),
        // ::ffff:0:a.b.c.d (SIIT-translated)
        [0, 0, 0, 0, 0xffff, 0, hi, lo] => Some([v4(*hi, *lo), None]),
        // 64:ff9b::/96 (NAT64)
        [0x64, 0xff9b, 0, 0, 0, 0, hi, lo] => Some([v4(*hi, *lo), None]),
        // 2002::/16 (6to4): the IPv4 address follows the prefix
        [0x2002, hi, lo, ..] => Some([v4(*hi, *lo), None]),
        // 2001:0::/32 (Teredo): server in segments 2-3, client obfuscated by
        // inverting segments 6-7
        [0x2001, 0, server_hi, server_lo, _, _, client_hi, client_lo] => {
            Some([v4(*server_hi, *server_lo), v4(!*client_hi, !*client_lo)])
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(addr: &str) -> IpKind {
        ip_kind(addr.parse().unwrap())
    }

    #[test]
    fn ipv4_mapped_addresses_take_the_class_of_the_embedded_ipv4() {
        assert_eq!(kind("::ffff:127.0.0.1"), IpKind::Loopback);
        assert_eq!(kind("::ffff:7f00:1"), IpKind::Loopback);
        assert_eq!(kind("::ffff:169.254.169.254"), IpKind::BlockedMetadata);
        assert_eq!(kind("::ffff:a9fe:a9fe"), IpKind::BlockedMetadata);
        assert_eq!(kind("::ffff:10.0.0.1"), IpKind::Private);
        assert_eq!(kind("::ffff:192.168.1.1"), IpKind::Private);
        assert_eq!(kind("::ffff:172.16.0.1"), IpKind::Private);
        assert_eq!(kind("::ffff:100.64.0.1"), IpKind::Private);
        assert_eq!(kind("::ffff:0.0.0.0"), IpKind::Loopback);
        assert_eq!(kind("::ffff:8.8.8.8"), IpKind::Public);
        assert_eq!(kind("::ffff:1.1.1.1"), IpKind::Public);
    }

    #[test]
    fn ipv4_compatible_and_translated_addresses_are_classified_by_their_ipv4() {
        assert_eq!(kind("::127.0.0.1"), IpKind::Loopback);
        assert_eq!(kind("::7f00:1"), IpKind::Loopback);
        assert_eq!(kind("::169.254.169.254"), IpKind::BlockedMetadata);
        assert_eq!(kind("::10.1.2.3"), IpKind::Private);
        assert_eq!(kind("::8.8.8.8"), IpKind::Public);
        assert_eq!(kind("::1"), IpKind::Loopback);
        assert_eq!(kind("::"), IpKind::Loopback);
        assert_eq!(kind("::ffff:0:127.0.0.1"), IpKind::Loopback);
        assert_eq!(kind("::ffff:0:8.8.8.8"), IpKind::Public);
    }

    #[test]
    fn nat64_addresses_are_classified_by_their_ipv4() {
        assert_eq!(kind("64:ff9b::7f00:1"), IpKind::Loopback);
        assert_eq!(kind("64:ff9b::127.0.0.1"), IpKind::Loopback);
        assert_eq!(kind("64:ff9b::a9fe:a9fe"), IpKind::BlockedMetadata);
        assert_eq!(kind("64:ff9b::a00:1"), IpKind::Private);
        assert_eq!(kind("64:ff9b::c0a8:101"), IpKind::Private);
        // A real IPv4-only host reached through DNS64 stays reachable.
        assert_eq!(kind("64:ff9b::808:808"), IpKind::Public);
        // Local-use NAT64 embeds at a prefix-dependent offset: never public.
        assert_eq!(kind("64:ff9b:1::808:808"), IpKind::Private);
    }

    #[test]
    fn six_to_four_addresses_are_classified_by_their_ipv4() {
        assert_eq!(kind("2002:7f00:1::"), IpKind::Loopback);
        assert_eq!(kind("2002:7f00:1::1"), IpKind::Loopback);
        assert_eq!(kind("2002:a9fe:a9fe::"), IpKind::BlockedMetadata);
        assert_eq!(kind("2002:a00:1::"), IpKind::Private);
        assert_eq!(kind("2002:c0a8:101::5"), IpKind::Private);
        assert_eq!(kind("2002:808:808::1"), IpKind::Public);
    }

    #[test]
    fn teredo_addresses_are_unsafe_if_server_or_client_ipv4_is() {
        // Server 8.8.8.8, client 1.2.3.4 (obfuscated as !1.2.3.4).
        assert_eq!(kind("2001:0:808:808:0:0:fefd:fcfb"), IpKind::Public);
        // Client 127.0.0.1 obfuscated: 80ff:fffe.
        assert_eq!(kind("2001:0:808:808:0:0:80ff:fffe"), IpKind::Loopback);
        // Server 10.0.0.1.
        assert_eq!(kind("2001:0:a00:1:0:0:fefd:fcfb"), IpKind::Private);
        // Client 169.254.169.254: obfuscated 5601:5601.
        assert_eq!(
            kind("2001:0:808:808:0:0:5601:5601"),
            IpKind::BlockedMetadata
        );
    }

    #[test]
    fn non_global_ipv6_ranges_are_never_public() {
        assert_eq!(kind("fe80::1"), IpKind::BlockedMetadata);
        assert_eq!(kind("febf::1"), IpKind::BlockedMetadata);
        assert_eq!(kind("fc00::1"), IpKind::Private);
        assert_eq!(kind("fd12:3456::1"), IpKind::Private);
        assert_eq!(kind("fdff:ffff::1"), IpKind::Private);
        assert_eq!(kind("fd00:ec2::254"), IpKind::BlockedMetadata);
        assert_eq!(kind("fec0::1"), IpKind::Private);
        assert_eq!(kind("feff::1"), IpKind::Private);
        assert_eq!(kind("ff02::1"), IpKind::Loopback);
        assert_eq!(kind("ff00::"), IpKind::Loopback);
        assert_eq!(kind("::"), IpKind::Loopback);
        assert_eq!(kind("::1"), IpKind::Loopback);
        assert_eq!(kind("100::1"), IpKind::Private);
        assert_eq!(kind("2001:db8::1"), IpKind::Private);
        assert_eq!(kind("2001:db8:ffff::1"), IpKind::Private);
        assert_eq!(kind("2001:2::1"), IpKind::Private);
        assert_eq!(kind("3fff::1"), IpKind::Private);
        assert_eq!(kind("3fff:fff:ffff::1"), IpKind::Private);
        assert_eq!(kind("4000::1"), IpKind::Private);
        assert_eq!(kind("8000::1"), IpKind::Private);
    }

    #[test]
    fn global_unicast_ipv6_stays_public() {
        for addr in [
            "2606:4700::1111",
            "2607:f8b0:4005:80a::200e",
            "2a00:1450:4001:81b::200e",
            "2001:4860:4860::8888",
            "2001:200::1",
            "2001:1200::1",
            "2620:fe::fe",
            "3fff:1000::1",
            "3ffe::1",
        ] {
            assert_eq!(kind(addr), IpKind::Public, "{addr}");
        }
    }

    #[test]
    fn newly_covered_ipv4_ranges_are_not_public() {
        for addr in [
            "0.1.2.3",
            "192.0.0.8",
            "192.0.2.1",
            "198.51.100.7",
            "203.0.113.9",
            "240.0.0.1",
            "255.255.255.254",
        ] {
            assert_ne!(kind(addr), IpKind::Public, "{addr}");
        }
        for addr in ["192.0.1.1", "198.51.101.1", "203.0.114.1", "239.0.0.0"] {
            let expected = if addr == "239.0.0.0" {
                IpKind::Loopback
            } else {
                IpKind::Public
            };
            assert_eq!(kind(addr), expected, "{addr}");
        }
    }
}
