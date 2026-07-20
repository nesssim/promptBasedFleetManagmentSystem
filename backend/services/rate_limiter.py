"""Simple in-memory rate limiter."""

import time
from collections import defaultdict


class RateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._request_count: int = 0

    def check(self, key: str, max_requests: int = 5, window_seconds: int = 60) -> bool:
        now = time.time()
        window_start = now - window_seconds
        self._windows[key] = [t for t in self._windows[key] if t > window_start]
        if len(self._windows[key]) >= max_requests:
            return False
        self._windows[key].append(now)
        self._request_count += 1
        if self._request_count % 500 == 0 and len(self._windows) > 1000:
            empty_keys = [k for k, v in self._windows.items() if not v]
            for k in empty_keys:
                del self._windows[k]
        return True


rate_limiter = RateLimiter()
