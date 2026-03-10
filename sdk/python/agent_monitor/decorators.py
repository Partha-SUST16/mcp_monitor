import time
import functools
from datetime import datetime, timezone
from .collector import record


def patch_qwen_agent(server_name: str = "python-agent"):
    """Monkey-patches QwenAgent's BaseTool.call to record all tool invocations."""
    try:
        from qwen_agent.tools.base import BaseTool
    except ImportError:
        raise ImportError("qwen_agent is not installed. pip install qwen-agent")

    _original = BaseTool.call

    def _monitored(self, params, **kwargs):
        ts = datetime.now(timezone.utc).isoformat()
        start = time.perf_counter()
        try:
            result = _original(self, params, **kwargs)
            latency = (time.perf_counter() - start) * 1000
            record(
                tool_name=getattr(self, 'name', self.__class__.__name__),
                server_name=server_name,
                arguments=params,
                response=result,
                status='success',
                latency_ms=latency,
                timestamp=ts
            )
            return result
        except Exception as e:
            latency = (time.perf_counter() - start) * 1000
            record(
                tool_name=getattr(self, 'name', self.__class__.__name__),
                server_name=server_name,
                arguments=params,
                response=None,
                status='error',
                latency_ms=latency,
                timestamp=ts,
                error=str(e)
            )
            raise

    BaseTool.call = _monitored


def monitor(server_name: str = "python-agent"):
    """Generic decorator for any callable tool."""
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            ts = datetime.now(timezone.utc).isoformat()
            start = time.perf_counter()
            try:
                result = fn(*args, **kwargs)
                record(fn.__name__, server_name, kwargs, result,
                       'success', (time.perf_counter() - start) * 1000, ts)
                return result
            except Exception as e:
                record(fn.__name__, server_name, kwargs, None,
                       'error', (time.perf_counter() - start) * 1000, ts, str(e))
                raise
        return wrapper
    return decorator
