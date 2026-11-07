"""API integration test: tests chunk sequencing, finalize, download and recovery."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
import socket

APP=pathlib.Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0))
        return s.getsockname()[1]


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.port=free_port()
        cls.base=f'http://127.0.0.1:{cls.port}'
        env=os.environ.copy();env['STUDIO_RECORDINGS_DIR']=cls.tmp.name
        cls.proc=subprocess.Popen([sys.executable,str(APP/'server.py'),'--no-browser','--port',str(cls.port)],cwd=str(APP),env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(80):
            try:urllib.request.urlopen(cls.base+'/api/health',timeout=.3);break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('Server failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=5);cls.tmp.cleanup()

    def get(self,path):return json.loads(urllib.request.urlopen(self.base+path,timeout=3).read())

    def post(self,path,data):
        body=data if isinstance(data,bytes) else json.dumps(data).encode()
        req=urllib.request.Request(self.base+path,data=body,method='POST')
        with urllib.request.urlopen(req,timeout=3) as r:return json.loads(r.read())

    def test_record_finish_and_download(self):
        start=self.post('/api/session/start',{'productName':'Test Product','sellingPoint':'Test feature'})
        sid=start['id']
        with self.assertRaises(urllib.error.HTTPError) as e:self.post(f'/api/session/{sid}/chunk/2',b'bad')
        self.assertEqual(e.exception.code,409)
        self.assertEqual(self.post(f'/api/session/{sid}/chunk/0',b'abc')['nextChunk'],1)
        self.assertTrue(self.post(f'/api/session/{sid}/chunk/0',b'abc')['duplicate'])
        self.post(f'/api/session/{sid}/chunk/1',b'def')
        with self.assertRaises(urllib.error.HTTPError) as e:self.post(f'/api/session/{sid}/finish',{'lastChunk':0,'metadata':{}})
        self.assertEqual(e.exception.code,409)
        self.post(f'/api/session/{sid}/finish',{'lastChunk':1,'metadata':{'takes':[{'scriptId':'S1'}]}})
        with urllib.request.urlopen(self.base+f'/api/session/{sid}/video',timeout=3) as resp:
            self.assertEqual(resp.read(),b'abcdef')
        self.assertEqual(self.get(f'/api/sessions')['items'][0]['status'],'completed')
        self.assertEqual(json.loads((pathlib.Path(self.tmp.name)/sid/'session.json').read_text())['takes'][0]['scriptId'],'S1')

    def test_recover_partial(self):
        sid=self.post('/api/session/start',{'productName':'Test recover'})['id']
        self.post(f'/api/session/{sid}/chunk/0',b'partial')
        self.post(f'/api/session/{sid}/recover',{})
        folder=pathlib.Path(self.tmp.name)/sid
        self.assertEqual((folder/'recording.webm').read_bytes(),b'partial')
        self.assertEqual(json.loads((folder/'state.json').read_text())['status'],'recovered')

if __name__=='__main__':unittest.main()
