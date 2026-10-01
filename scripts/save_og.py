#!/usr/bin/env python3
"""Tiny one-shot receiver: the og.html capture page POSTs the globe's PNG dataURL here; we decode it to
scripts/_globe.png so make_og.py can composite it. Avoids piping ~150KB of base64 back through the agent.
POST any path with the dataURL (or raw base64) as the body. CORS open so the :8777 page can reach :8778."""
import base64, os
from http.server import BaseHTTPRequestHandler, HTTPServer

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_globe.png")


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8", "replace")
        if "," in body[:64]:
            body = body.split(",", 1)[1]
        try:
            with open(OUT, "wb") as f:
                f.write(base64.b64decode(body))
            msg = b"ok"
        except Exception as e:
            msg = ("err: " + str(e)).encode()
        self.send_response(200); self._cors()
        self.send_header("Content-Type", "text/plain"); self.end_headers()
        self.wfile.write(msg)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("save_og listening on :8778 ->", OUT)
    HTTPServer(("127.0.0.1", 8778), H).serve_forever()
