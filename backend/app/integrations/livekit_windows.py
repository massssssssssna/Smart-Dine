"""Windows compatibility for an optional LiveKit local model we do not use.

LiveKit imports its local EOT extension eagerly. Some Windows machines cannot load
that optional native DLL. Smart Dine uses Deepgram's server-side endpointing, so a
small inert module keeps the unused extension out of the worker process.
"""

import sys
import types


def disable_unused_local_inference_on_windows() -> None:
    if sys.platform != "win32" or "livekit.local_inference" in sys.modules:
        return

    class _UnavailableLocalModel:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("Local LiveKit inference is disabled; use provider endpointing.")

    module = types.ModuleType("livekit.local_inference")
    module.EOT = _UnavailableLocalModel
    module.VAD = _UnavailableLocalModel
    module.EOT_MAX_SAMPLES = 0
    module.VAD_WINDOW_SAMPLES = 0
    module.init_eot = lambda: None
    module.init_vad = lambda: None
    sys.modules["livekit.local_inference"] = module
