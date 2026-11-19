# SPDX-License-Identifier: GPL-3.0-or-later
# Loaded only into the yt-dlp process that ytweb starts (via PYTHONPATH).
# If www.youtube.com does not resolve on this network, use www.youtube-nocookie.com, which is the same Google frontend.
import socket
_orig = socket.getaddrinfo
_hosts = ('www.youtube.com', 'youtube.com', 'm.youtube.com')
def _gai(host, *a, **k):
    try:
        return _orig(host, *a, **k)
    except socket.gaierror:
        if host in _hosts:
            return _orig('www.youtube-nocookie.com', *a, **k)
        raise
socket.getaddrinfo = _gai
