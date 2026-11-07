#!/usr/bin/env python3
"""Optional: download the published MediaPipe JS/WASM/models for offline use.
Uses Python standard library only. Requires an internet connection once.
"""
import json
import os
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent / 'public' / 'vendor'
BASE='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35'
FILES={
 'vision_bundle.mjs':f'{BASE}/vision_bundle.mjs',
 'wasm/vision_wasm_internal.js':f'{BASE}/wasm/vision_wasm_internal.js',
 'wasm/vision_wasm_internal.wasm':f'{BASE}/wasm/vision_wasm_internal.wasm',
 'wasm/vision_wasm_nosimd_internal.js':f'{BASE}/wasm/vision_wasm_nosimd_internal.js',
 'wasm/vision_wasm_nosimd_internal.wasm':f'{BASE}/wasm/vision_wasm_nosimd_internal.wasm',
 'models/face_detector.tflite':'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
 'models/hand_landmarker.task':'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
 'models/object_detector.tflite':'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite',
}

def main():
    print('Downloading MediaPipe assets for offline operation. This can require several MB of data.')
    ROOT.mkdir(parents=True,exist_ok=True)
    manifest=ROOT/'assets.json'
    if manifest.exists():manifest.unlink()
    for rel,url in FILES.items():
        dst=ROOT/rel;dst.parent.mkdir(parents=True,exist_ok=True)
        print(f'Downloading {rel} ...',flush=True)
        req=urllib.request.Request(url,headers={'User-Agent':'FrameLabOfflineInstaller/1.0'})
        temp=dst.with_suffix(dst.suffix+'.tmp')
        try:
            with urllib.request.urlopen(req,timeout=90) as r, temp.open('wb') as out:
                while True:
                    data=r.read(1024*1024)
                    if not data:break
                    out.write(data)
            if temp.stat().st_size<100:raise RuntimeError(f'File suspiciously small: {rel}')
            os.replace(temp,dst)
        except Exception:
            temp.unlink(missing_ok=True)
            print('Download failed. The studio still supports online model loading.')
            raise
    manifest.write_text(json.dumps({'offline':True,'modelSource':'MediaPipe','version':'0.10.35'},indent=2),'utf-8')
    print('Done. Restart the studio; models now load locally without internet.')

if __name__=='__main__':main()
