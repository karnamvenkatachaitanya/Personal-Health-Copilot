"""DNS resilience patch.
Resolves issues where local ISPs hijack or fail to resolve
Supabase subdomains (like *.supabase.co) to ISP blackhole IPs (e.g. 183.82.x.x) or return NXDOMAIN.
Falls back to Google DNS (8.8.8.8) and Cloudflare DNS (1.1.1.1), or known Cloudflare anycast IPs.
"""
import logging
import socket

logger = logging.getLogger("dns_patch")

_orig_getaddrinfo = socket.getaddrinfo

# Known Cloudflare anycast IPs for Supabase
CLOUDFLARE_SUPABASE_IPS = ["172.64.149.246", "104.18.38.10"]


def _is_suspicious_ip(ip: str) -> bool:
    # 183.82.*.* is Indian ISP captive portal or DNS block IP
    return ip.startswith("183.82.")


def resilient_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if host and isinstance(host, str) and "supabase.co" in host:
        try:
            results = _orig_getaddrinfo(host, port, family, type, proto, flags)
            if results and any(_is_suspicious_ip(r[4][0]) for r in results):
                raise socket.gaierror("Poisoned ISP DNS address detected")
            return results
        except Exception:
            # Try resolving via Google/Cloudflare public DNS
            try:
                import dns.resolver
                resolver = dns.resolver.Resolver()
                resolver.nameservers = ["8.8.8.8", "1.1.1.1"]
                answers = resolver.resolve(host, "A", lifetime=2.0)
                valid_ips = [str(ans) for ans in answers if not _is_suspicious_ip(str(ans))]
                if valid_ips:
                    return _orig_getaddrinfo(valid_ips[0], port, family, type, proto, flags)
            except Exception:
                pass

            # Fallback to direct Cloudflare IP
            for fallback_ip in CLOUDFLARE_SUPABASE_IPS:
                try:
                    return _orig_getaddrinfo(fallback_ip, port, family, type, proto, flags)
                except Exception:
                    continue

    return _orig_getaddrinfo(host, port, family, type, proto, flags)


def apply_dns_patch():
    if socket.getaddrinfo != resilient_getaddrinfo:
        socket.getaddrinfo = resilient_getaddrinfo
        logger.info("Resilient DNS patch applied for Supabase domains")


apply_dns_patch()
