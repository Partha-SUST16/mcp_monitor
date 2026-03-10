import threading
import uuid
import os
import json
from datetime import datetime, timezone
from typing import Any, Optional

MONITOR_URL = os.getenv("AGENT_MONITOR_URL", "http://localhost:4242")

_session_id = os.getenv("AGENT_MONITOR_SESSION_ID", str(uuid.uuid4()))

SECRET_KEYS = {'token', 'key', 'secret', 'password', 'auth', 'api_key',
               'apikey', 'credential', 'bearer', 'authorization'}


def _sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return value
    if isinstance(value, dict):
        return {
            k: '[REDACTED]' if any(s in k.lower() for s in SECRET_KEYS)
               else _sanitize(v, depth + 1)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_sanitize(v, depth + 1) for v in value]
    return value


def _truncate_response(raw: Any) -> dict:
    serialized = json.dumps(raw)
    size_bytes = len(serialized.encode('utf-8'))
    limit = 10_000

    if size_bytes <= limit:
        return {"data": raw, "truncated": False, "sizeBytes": size_bytes}

    if isinstance(raw, list):
        kept, size = [], 2
        for item in raw:
            item_size = len(json.dumps(item).encode('utf-8'))
            if size + item_size > limit:
                break
            kept.append(item)
            size += item_size + 1
        return {"data": kept, "truncated": True, "sizeBytes": size_bytes}

    if isinstance(raw, dict):
        kept = {k: str(v)[:500] if isinstance(v, str) else v for k, v in raw.items()}
        return {"data": kept, "truncated": True, "sizeBytes": size_bytes}

    return {"data": str(raw)[:limit], "truncated": True, "sizeBytes": size_bytes}


def record(
    tool_name: str,
    server_name: str,
    arguments: Any,
    response: Any,
    status: str,
    latency_ms: float,
    timestamp: str,
    error: Optional[str] = None
):
    payload = {
        "sessionId": _session_id,
        "agentType": "python-sdk",
        "serverName": server_name,
        "toolName": tool_name,
        "method": tool_name,
        "arguments": _sanitize(arguments),
        "response": _truncate_response(response) if response is not None else None,
        "status": status,
        "latencyMs": round(latency_ms),
        "timestamp": timestamp,
        "errorMsg": error,
    }
    threading.Thread(target=_post, args=(payload,), daemon=True).start()


def _post(payload: dict):
    try:
        import urllib.request
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            f"{MONITOR_URL}/api/ingest",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass
