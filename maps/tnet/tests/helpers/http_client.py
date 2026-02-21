from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class HttpResponse:
    status: int
    text: str

    def json(self) -> Any:
        return json.loads(self.text)


def get_json(url: str, params: dict[str, Any] | None = None, timeout: int = 20) -> HttpResponse:
    query = urllib.parse.urlencode(params or {}, doseq=True)
    request_url = f"{url}?{query}" if query else url

    try:
        with urllib.request.urlopen(request_url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return HttpResponse(status=response.getcode(), text=body)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return HttpResponse(status=error.code, text=body)


def get_text(url: str, params: dict[str, Any] | None = None, timeout: int = 20) -> HttpResponse:
    return get_json(url=url, params=params, timeout=timeout)
