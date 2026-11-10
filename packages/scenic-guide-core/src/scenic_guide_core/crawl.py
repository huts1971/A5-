from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx


class OfficialCrawler:
    """Explicit URL list only; no recursive crawling or automatic trust promotion."""

    def __init__(self, allowed_hosts: set[str], allow_network: bool = False):
        if not allow_network:
            raise PermissionError("Crawling requires allow_network=true")
        self.hosts = {h.lower() for h in allowed_hosts}
        self.agent = "ScenicKnowledgeImporter/0.1"

    def validate_url(self, url: str) -> None:
        parts = urlsplit(url)
        if (parts.scheme != "https" or parts.hostname not in self.hosts or parts.username
                or parts.password or parts.port not in {None, 443}):
            raise ValueError("Only allowlisted HTTPS official sites are permitted")
        addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError("Non-public destinations are forbidden")

    def _fetch(self, client: httpx.Client, url: str, limit: int) -> tuple[bytes, str]:
        self.validate_url(url)
        with client.stream("GET", url) as response:
            response.raise_for_status()
            if response.is_redirect:
                raise ValueError("Redirects must be reviewed and allowlisted separately")
            data = bytearray()
            for part in response.iter_bytes():
                data.extend(part)
                if len(data) > limit:
                    raise ValueError("Download exceeds size limit")
            return bytes(data), response.headers.get("content-type", "")

    def fetch(self, url: str) -> bytes:
        self.validate_url(url)
        parts = urlsplit(url)
        robot_url = f"https://{parts.hostname}/robots.txt"
        with httpx.Client(timeout=20, follow_redirects=False, trust_env=False,
                          headers={"User-Agent": self.agent}) as client:
            robots, _ = self._fetch(client, robot_url, 256000)
            parser = RobotFileParser()
            parser.parse(robots.decode("utf-8", errors="replace").splitlines())
            if not parser.can_fetch(self.agent, url):
                raise PermissionError("robots.txt disallows this page")
            content, mime = self._fetch(client, url, 5_000_000)
            if "text/html" not in mime:
                raise ValueError("Crawler accepts HTML only; import PDF separately")
            return content
