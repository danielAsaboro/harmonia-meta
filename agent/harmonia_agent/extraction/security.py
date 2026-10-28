"""SSRF protections for untrusted public-web sources."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit


class UnsafeSourceUrl(ValueError):
    pass


def _resolve(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    return list({ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})


def assert_public_url(url: str, *, resolver: Callable[[str], Iterable[ipaddress.IPv4Address | ipaddress.IPv6Address]] = _resolve) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeSourceUrl("source URL must be a public HTTP(S) URL")
    try:
        literal = ipaddress.ip_address(parsed.hostname)
        addresses = [literal]
    except ValueError:
        addresses = list(resolver(parsed.hostname))
    if not addresses:
        raise UnsafeSourceUrl("source hostname did not resolve")
    for address in addresses:
        if not address.is_global:
            raise UnsafeSourceUrl("source URL resolves to a non-public address")
    return url
