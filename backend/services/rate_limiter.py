"""Simple in-memory rate limiter."""

import time
from collections import defaultdict


class RateLimiter:
    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, max_requests: int = 5, window_seconds: int = 60) -> bool:
        now = time.time()
        window_start = now - window_seconds
        self._windows[key] = [t for t in self._windows[key] if t > window_start]
        if len(self._windows[key]) >= max_requests:
            return False
        self._windows[key].append(now)
        return True


rate_limiter = RateLimiter()
