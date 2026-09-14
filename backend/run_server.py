import asyncio
import selectors
import sys
import time
import traceback
import uvicorn

async def start_server():
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        loop="none",
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()

def run_loop():
    if sys.platform == "win32":
        selector = selectors.SelectSelector()
        loop = asyncio.SelectorEventLoop(selector)
        asyncio.set_event_loop(loop)
    else:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(start_server())
    finally:
        try:
            loop.close()
        except Exception:
            pass

if __name__ == "__main__":
    while True:
        try:
            run_loop()
            print("Server cycle finished, restarting in 1s...", file=sys.stderr)
            time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            break
        except BaseException as exc:
            traceback.print_exc()
            print("Server encountered exception, restarting in 2s...", file=sys.stderr)
            time.sleep(2)
