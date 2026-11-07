#!/usr/bin/env python3
"""Local-only recording server. Python 3.9+, no dependencies."""
from __future__ import annotations

import argparse
import json
import os
import re
import threading
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "public"
RECORDINGS = Path(os.getenv("STUDIO_RECORDINGS_DIR", str(BASE / "recordings"))).expanduser().resolve()
RECORDINGS.mkdir(parents=True, exist_ok=True)
SESSION_RE = re.compile(r"^session_[a-f0-9]{16}$")
MAX_JSON = 2 * 1024 * 1024
MAX_CHUNK = 64 * 1024 * 1024
LOCKS: dict[str, threading.Lock] = {}
GLOBAL_LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_session(session_id: str) -> Path:
    if not SESSION_RE.fullmatch(session_id):
        raise ValueError("Invalid session ID")
    path = RECORDINGS / session_id
    if not path.is_dir():
        raise FileNotFoundError("Unknown session")
    return path


def session_lock(session_id: str) -> threading.Lock:
    with GLOBAL_LOCK:
        return LOCKS.setdefault(session_id, threading.Lock())


def load_state(folder: Path) -> dict:
    return json.loads((folder / "state.json").read_text("utf-8"))


def save_json_atomic(path: Path, data: dict):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


class StudioHandler(SimpleHTTPRequestHandler):
    server_version = "CreatorStudioLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self):
        if urlsplit(self.path).path in ("/", "/index.html", "/app.js"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}")

    def _json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json({"error": str(message)}, status)

    def _body(self, limit):
        length = int(self.headers.get("Content-Length", "-1"))
        if length < 0 or length > limit:
            raise ValueError("Invalid or oversized request")
        return self.rfile.read(length)

    def _json_body(self):
        return json.loads(self._body(MAX_JSON).decode("utf-8"))

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        try:
            if path == "/api/health":
                return self._json({"ok": True, "storage": str(RECORDINGS), "serverTime": now_iso()})
            if path == "/api/sessions":
                items = []
                for folder in sorted(RECORDINGS.iterdir(), reverse=True):
                    if not folder.is_dir() or not SESSION_RE.fullmatch(folder.name):
                        continue
                    try:
                        state = load_state(folder)
                        items.append({"id":folder.name, "createdAt":state.get("createdAt"),
                                      "status":state.get("status"),"productName":state.get("productName"),
                                      "chunks":state.get("nextChunk",0),"size":state.get("size",0),
                                      "hasVideo":(folder / "recording.webm").exists(),
                                      "hasPartial":(folder / "recording.webm.part").exists()})
                    except (OSError, ValueError, json.JSONDecodeError):
                        pass
                    if len(items) >= 12:
                        break
                return self._json({"items":items})
            m = re.fullmatch(r"/api/session/(session_[a-f0-9]{16})/(video|metadata)",path)
            if m:
                folder = safe_session(m.group(1))
                fp = folder / ("recording.webm" if m.group(2)=="video" else "session.json")
                if not fp.is_file():
                    return self._error(404, "This file is not available yet")
                return self._send_file(fp, download=self.headers.get("Sec-Fetch-Dest")!="video")
            if path.startswith("/api/"):
                return self._error(404, "Unknown API endpoint")
            if path == "/":
                self.path = "/index.html"
            return super().do_GET()
        except (ValueError, FileNotFoundError) as e:
            return self._error(404, str(e))
        except Exception as e:
            return self._error(500, f"Server error: {e}")

    def _send_file(self, filepath: Path, download=True):
        size = filepath.stat().st_size
        range_header = self.headers.get("Range")
        begin, end = 0, max(0,size-1)
        status = 200
        if range_header:
            m = re.fullmatch(r"bytes=(\d+)-(\d*)",range_header.strip())
            if not m:
                self.send_response(416); self.send_header("Content-Range",f"bytes */{size}"); self.end_headers(); return
            begin = int(m.group(1))
            end = min(int(m.group(2)),size-1) if m.group(2) else size-1
            if begin >= size or end < begin:
                self.send_response(416);self.send_header("Content-Range",f"bytes */{size}");self.end_headers();return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", "video/webm" if filepath.suffix==".webm" else "application/json")
        self.send_header("Content-Length",str(end-begin+1 if size else 0))
        self.send_header("Accept-Ranges","bytes")
        self.send_header("Cache-Control","no-store")
        if status==206:
            self.send_header("Content-Range",f"bytes {begin}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition",f'attachment; filename="{filepath.name}"')
        self.end_headers()
        with filepath.open("rb") as f:
            f.seek(begin)
            remaining = end-begin+1 if size else 0
            while remaining > 0:
                block=f.read(min(1024*1024,remaining))
                if not block:break
                self.wfile.write(block)
                remaining-=len(block)

    def do_POST(self):
        path = unquote(urlsplit(self.path).path)
        try:
            if path == "/api/session/start":
                data=self._json_body()
                product=str(data.get("productName","Product"))[:120].strip() or "Product"
                features=str(data.get("sellingPoint",""))[:250]
                sid="session_"+uuid.uuid4().hex[:16]
                folder=RECORDINGS / sid
                folder.mkdir(mode=0o700)
                state={"id":sid,"createdAt":now_iso(),"status":"recording",
                       "productName":product,"sellingPoint":features,"nextChunk":0,"size":0}
                save_json_atomic(folder / "state.json",state)
                (folder / "recording.webm.part").touch()
                return self._json({"id":sid,"storage":str(folder),"nextChunk":0})
            m=re.fullmatch(r"/api/session/(session_[a-f0-9]{16})/chunk/(\d{1,8})",path)
            if m:
                sid, seq=m.group(1),int(m.group(2))
                folder=safe_session(sid)
                block=self._body(MAX_CHUNK)
                if len(block)==0:return self._error(400,"Empty recording chunk")
                with session_lock(sid):
                    state=load_state(folder)
                    if state["status"]!="recording":return self._error(409,"Session is already finalized")
                    expected=state["nextChunk"]
                    if seq < expected:return self._json({"ok":True,"duplicate":True,"nextChunk":expected})
                    if seq > expected:return self._error(409,f"Out-of-order chunk: expected {expected}")
                    with (folder / "recording.webm.part").open("ab") as output:
                        output.write(block)
                        output.flush()
                        os.fsync(output.fileno())
                    state["nextChunk"]+=1
                    state["size"]+=len(block)
                    save_json_atomic(folder / "state.json",state)
                return self._json({"ok":True,"nextChunk":seq+1,"size":state["size"]})
            m=re.fullmatch(r"/api/session/(session_[a-f0-9]{16})/finish",path)
            if m:
                sid=m.group(1)
                folder=safe_session(sid)
                payload=self._json_body()
                with session_lock(sid):
                    state=load_state(folder)
                    if state["status"]=="completed":return self._json({"ok":True,"id":sid,"alreadyFinished":True})
                    if state["nextChunk"]<1:return self._error(400,"No video chunks have been saved")
                    if payload.get("lastChunk")!=state["nextChunk"]-1:
                        return self._error(409,"Not all chunks have arrived yet")
                    save_json_atomic(folder / "session.json",payload.get("metadata",{}))
                    os.replace(folder / "recording.webm.part",folder / "recording.webm")
                    state["status"]="completed"
                    state["completedAt"]=now_iso()
                    save_json_atomic(folder / "state.json",state)
                return self._json({"ok":True,"id":sid,"videoUrl":f"/api/session/{sid}/video",
                                   "metadataUrl":f"/api/session/{sid}/metadata",
                                   "storage":str(folder),"bytes":state["size"]})
            m=re.fullmatch(r"/api/session/(session_[a-f0-9]{16})/recover",path)
            if m:
                sid=m.group(1)
                folder=safe_session(sid)
                with session_lock(sid):
                    state=load_state(folder)
                    if state["status"]=="completed":return self._error(409,"Already completed")
                    part=folder / "recording.webm.part"
                    if not part.exists() or part.stat().st_size==0:return self._error(400,"No partial recording")
                    os.replace(part,folder / "recording.webm")
                    state["status"]="recovered"
                    state["recoveredAt"]=now_iso()
                    save_json_atomic(folder / "state.json",state)
                    save_json_atomic(folder / "session.json",{"sessionId":sid,"recovered":True,
                                    "note":"Recovered after unexpected interruption; video may be incomplete.",
                                    "savedChunks":state["nextChunk"]})
                return self._json({"ok":True,"id":sid,"videoUrl":f"/api/session/{sid}/video"})
            return self._error(404,"Unknown API endpoint")
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            return self._error(400,str(e))
        except FileNotFoundError as e:
            return self._error(404,str(e))
        except Exception as e:
            return self._error(500,f"Server error: {e}")


def main():
    parser=argparse.ArgumentParser(description="Creator Recording Studio - local only")
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--no-browser",action="store_true")
    args=parser.parse_args()
    server=ThreadingHTTPServer(("127.0.0.1",args.port),StudioHandler)
    url=f"http://localhost:{args.port}"
    print("\nCREATOR RECORDING STUDIO")
    print("Open:",url)
    print("Videos saved in:",RECORDINGS)
    print("Local-only server; no videos are uploaded to any external service.\n")
    if not args.no_browser:
        threading.Timer(0.9,lambda:webbrowser.open(url)).start()
    try:server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:print("\nStudio stopped.")
    finally:server.server_close()

if __name__=="__main__":
    main()
