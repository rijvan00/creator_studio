# FrameLab — Local Creator Recording Studio (V1)

A working browser-based camera recording MVP, with simulated AI scripts, a simulated teleprompter, live face/hand landmark detection, experimental product appearance tracking, recording warnings, retakes, and video + metadata saved **on your own laptop**.

**No API keys. No paid services. No cloud video upload. No Python packages to install.**

## Start in 3 steps

1. Unzip the folder somewhere writable (e.g., Desktop).
2. Start the local web server:
   - **Mac:** Double-click `start.command` (you may need to right-click → Open), or open Terminal in the folder and run `python3 server.py`.
   - **Windows:** Double-click `start.bat` (Python 3.9+ must be installed), or run `python server.py` in Command Prompt.
   - **Linux:** Run `python3 server.py`.
3. In **desktop Google Chrome or Microsoft Edge**, open **http://localhost:8765**. Allow camera and microphone permissions.

Python 3.9 or later is needed. Do not open `index.html` directly as a file: the recording service uses `localhost`.

## Recording flow

1. Enter your product name and the point you want to discuss; click **Update scripts**.
2. Click **Start camera** and wait for the vision detector to finish loading. Alignment monitoring starts automatically.
3. Keep your face centered with at least 10% empty space above your head, and hold a supported product visibly in one hand. The app detects common COCO product classes near that hand.
4. Hold position for **two seconds** until all four checks pass. **Start recording** becomes enabled.
5. Read the example script. Recording **continues** if you move out of frame or the product can't be tracked. Sustained (approx. 1.7-second) violations produce an on-screen warning and mark that take for retake.
6. Click **Finish script** to advance. When a take was flagged, choose **Re-record this script** or **Continue anyway**. You can also click **Retake now** at any time.
7. **Pause/Resume** when you need a break. Click **Done & save** to finalize.
8. Find the files in `recordings/session_.../recording.webm` and `session.json`. Download links appear on the page as well.

**Output:** One continuous portrait **540 × 960 WebM** video and a detailed JSON timeline containing each script, take start/end times, warnings, retake status, and session events. No automatic reels are created yet.

### Where video is saved

Files are written incrementally to the laptop by the small local server. The recordings are in the `recordings/` folder next to `server.py`. The process only listens on the loopback network interface, `127.0.0.1`.

To change the save folder, set the optional `STUDIO_RECORDINGS_DIR` environment variable before running the server. Example:

```bash
STUDIO_RECORDINGS_DIR="$HOME/Movies/FrameLab" python3 server.py
```

### Offline usage

By default, the initial vision model load requires an internet connection to download Google's **MediaPipe** Javascript/WASM/models in your browser. Webcam footage is analyzed on-device and is not uploaded to the model source.

For offline operation, while connected to the internet run:

```bash
python3 setup_offline_models.py
```

It downloads the published MediaPipe files into `public/vendor/` and enables local loading. After it finishes, reconnecting to the internet is not necessary to run live checks. This step is optional; the installer has no pip dependencies.

If the connection fails, the camera preview can still open, but **Start recording stays locked**: this MVP requires the face/hand detector and product calibration checks to start.

## Important limitations (V1)

- Product detection uses a pre-trained COCO object model near a detected hand. It recognizes only its supported classes (including bottle, cup, book, cell phone, remote, backpack, handbag, scissors, toothbrush, banana); it does not recognize arbitrary brands or packaging.
- A supported product must be detected before recording starts. Once recording, it may be rotated to show other sides while the holding hand stays visible; the product class is not re-verified continuously during that rotation.
- Face position and the 10% top gap are measured with real face detection, but they are heuristics, not professional camera calibration. Automatic warnings need real-device testing.
- Simulated scripts are fixed templates using your inputs, **not AI-generated**. They do not imply that unverified product claims are true.
- The local WebM is recorded with audio. The portrait crop is captured live from the camera; the full horizontal source is **not** retained. Preview and recording use mirror-style left/right movement.
- Recording is designed for long sessions with periodic server uploads; keep the browser window visible, the laptop awake, enough free disk space available, and the Python server running. A browser or laptop crash can still lose the current unsent chunk.
- If recording ends unexpectedly, the partial video remains as `recording.webm.part`. Reopen the studio and use **Recover partial video** in Previous Sessions. Partial recovered WebM may not play correctly if interrupted before finalization.
- For long recordings, desktop Chrome or Edge is strongly recommended. MediaRecorder/WebM behavior and codec support vary by browser and operating system.
- Video cutting, reels, AI editing, best-take ranking, scoring, and reel previews are **not in this version**.

## Quick troubleshooting

| Problem | Fix |
|---|---|
| Camera won't open | Allow webcam/mic in browser, close other camera apps, and use localhost in Chrome/Edge. |
| Vision unavailable | Connect to internet and reload, or run `setup_offline_models.py`. |
| Start recording disabled | Hold a supported product near a visible hand, keep your face centered with a 10% top gap, and wait 2 seconds. |
| Product check keeps warning | The item may not be a supported COCO category, or it may be too small/obscured for the detector. |
| Save interrupted | Keep the server terminal open; reload and use Recover partial video if needed. |
| App port in use | Run `python3 server.py --port 8766` and open `http://localhost:8766`. |

## Project layout

```
server.py                Local HTTP server and incremental disk writer
start.command            macOS launcher
start.bat                Windows launcher
setup_offline_models.py  Optional one-time model download for offline use
public/index.html        Browser application
public/styles.css        UI styling
public/app.js            Camera, vision, product tracking and recording logic
recordings/              Video + JSON sessions (created locally)
tests/test_server.py     Local server smoke tests
```

## Testing

```bash
python3 -m unittest discover -s tests -v
```

MediaPipe source: https://developers.google.com/edge/mediapipe/solutions/vision/ . Its JavaScript package uses Apache-2.0 licensing. For deployment or redistribution, review the upstream model and runtime license terms.
