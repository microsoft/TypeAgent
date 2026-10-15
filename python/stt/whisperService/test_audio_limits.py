# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import asyncio
import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import subprocess
import threading
import types
import unittest
from unittest.mock import patch
import wave

import httpx
import numpy as np


def audio_bytes(samples: int = 320) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(np.full(samples, 16384, dtype="<i2").tobytes())
    return output.getvalue()


class Model:
    def __init__(self) -> None:
        self.inputs: list[np.ndarray] = []
        self.started = threading.Event()
        self.release = threading.Event()
        self.block = False

    def transcribe(self, audio: np.ndarray):
        self.inputs.append(audio.copy())
        self.started.set()
        if self.block and not self.release.wait(5):
            raise RuntimeError("Test transcription was not released")
        return iter([types.SimpleNamespace(text="hello")]), None


def load_service(model: Model):
    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    whisper = types.ModuleType("faster_whisper")
    whisper.WhisperModel = lambda *args, **kwargs: model

    spec = importlib.util.spec_from_file_location(
        "whisper_service_test", Path(__file__).with_name("faster-whisper.py")
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load the service")
    service = importlib.util.module_from_spec(spec)
    with patch.dict(
        "sys.modules", {"torch": torch, "faster_whisper": whisper}
    ), redirect_stdout(io.StringIO()):
        spec.loader.exec_module(service)
    return service


class AudioLimitsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.model = Model()
        self.service = load_service(self.model)
        self.service.MAX_UPLOAD_BYTES = len(audio_bytes())
        self.service.MAX_REQUEST_BYTES = self.service.MAX_UPLOAD_BYTES + 65536
        self.service.MAX_AUDIO_SECONDS = 0.02
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.service.app),
            base_url="http://test",
        )

    async def asyncTearDown(self) -> None:
        self.model.release.set()
        await self.client.aclose()

    async def upload(self, content: bytes):
        return await self.client.post(
            "/transcribe/",
            files={"file": ("recording.wav", content, "audio/wav")},
        )

    async def test_exact_upload_and_duration_limits_preserve_output(self) -> None:
        response = await self.upload(audio_bytes())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"transcription": "hello"})
        self.assertEqual(len(self.model.inputs), 1)
        self.assertEqual(self.model.inputs[0].dtype, np.float32)
        np.testing.assert_array_equal(self.model.inputs[0], np.full(320, 0.5))

    async def test_upload_one_byte_over_limit_stops_before_inference(self) -> None:
        response = await self.upload(audio_bytes() + b"x")
        self.assertEqual(response.status_code, 413)
        self.assertIn("error", response.json())
        self.assertEqual(self.model.inputs, [])

    async def test_decoded_audio_one_sample_over_limit_is_rejected(self) -> None:
        self.service.MAX_UPLOAD_BYTES = 4096
        response = await self.upload(audio_bytes(321))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.model.inputs, [])

    async def test_audio_below_duration_limit_is_accepted(self) -> None:
        response = await self.upload(audio_bytes(319))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.model.inputs[0]), 319)

    async def test_compressed_audio_is_bounded_by_decoded_samples(self) -> None:
        compressed = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-f", "wav", "-i", "pipe:0", "-c:a", "flac",
                "-f", "flac", "pipe:1",
            ],
            input=audio_bytes(16000),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=10,
        ).stdout
        self.assertLess(len(compressed), len(audio_bytes(16000)))
        self.service.MAX_UPLOAD_BYTES = len(compressed)
        response = await self.upload(compressed)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.model.inputs, [])

    async def test_decoder_timeout_is_reported_and_releases_capacity(self) -> None:
        with patch.object(
            self.service.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired("ffmpeg", 30),
        ):
            response = await self.upload(audio_bytes())
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.service.app.state.pending_transcriptions, 0)
        self.assertEqual(self.model.inputs, [])
        self.assertEqual((await self.upload(audio_bytes())).status_code, 200)

    async def test_invalid_audio_is_an_explicit_input_error(self) -> None:
        response = await self.upload(b"not audio")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())
        self.assertEqual(self.model.inputs, [])

    async def test_declared_request_limit_rejects_before_reading_body(self) -> None:
        self.service.MAX_REQUEST_BYTES = 100
        response = await self.client.post(
            "/transcribe/",
            content=b"x" * 101,
            headers={"origin": "http://example.test"},
        )
        self.assertEqual(response.status_code, 413)
        self.assertIsNotNone(response.headers.get("access-control-allow-origin"))
        self.assertEqual(self.model.inputs, [])

    async def test_chunked_request_limit_does_not_depend_on_content_length(self) -> None:
        self.service.MAX_REQUEST_BYTES = 100

        async def content():
            yield b"x" * 50
            yield b"x" * 51

        response = await self.client.post("/transcribe/", content=content())
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.model.inputs, [])

    async def test_stalled_upload_times_out_and_releases_waiting_request(self) -> None:
        self.service.UPLOAD_TIMEOUT_SECONDS = 0.25
        started = asyncio.Event()

        async def content():
            started.set()
            await asyncio.Event().wait()
            yield b""

        tasks = [asyncio.create_task(self.client.post(
            "/transcribe/",
            content=content(),
            headers={"origin": "http://example.test"},
        ))]
        try:
            await asyncio.wait_for(started.wait(), 2)
            tasks.append(asyncio.create_task(self.upload(audio_bytes())))
            for _ in range(100):
                if self.service.app.state.pending_transcriptions == 2:
                    break
                await asyncio.sleep(0.001)
            self.assertEqual(self.service.app.state.pending_transcriptions, 2)
            self.assertEqual((await self.upload(audio_bytes())).status_code, 503)
            stalled, waiting = await asyncio.wait_for(asyncio.gather(*tasks), 5)
            self.assertEqual(stalled.status_code, 408)
            self.assertEqual(stalled.json(), {
                "error": "The audio upload exceeded the time limit."
            })
            self.assertIsNotNone(
                stalled.headers.get("access-control-allow-origin")
            )
            self.assertEqual(waiting.status_code, 200)
            self.assertEqual(waiting.json(), {"transcription": "hello"})
            self.assertEqual(len(self.model.inputs), 1)
            self.assertEqual(self.service.app.state.pending_transcriptions, 0)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def test_upload_stalled_after_a_chunk_times_out(self) -> None:
        self.service.UPLOAD_TIMEOUT_SECONDS = 0.05

        async def content():
            yield b"unfinished audio"
            await asyncio.Event().wait()

        response = await asyncio.wait_for(
            self.client.post("/transcribe/", content=content()), 2
        )
        self.assertEqual(response.status_code, 408)
        self.assertEqual(response.json(), {
            "error": "The audio upload exceeded the time limit."
        })
        self.assertEqual(self.service.app.state.pending_transcriptions, 0)
        self.assertEqual(self.model.inputs, [])
        self.assertEqual((await self.upload(audio_bytes())).status_code, 200)

    async def test_upload_timeout_bounds_total_time_not_each_chunk(self) -> None:
        self.service.UPLOAD_TIMEOUT_SECONDS = 0.1
        sent_chunks = 0

        async def content():
            nonlocal sent_chunks
            for _ in range(10):
                await asyncio.sleep(0.025)
                sent_chunks += 1
                yield b"x"

        response = await asyncio.wait_for(
            self.client.post("/transcribe/", content=content()), 2
        )
        self.assertEqual(response.status_code, 408)
        self.assertLess(sent_chunks, 10)
        self.assertEqual(self.service.app.state.pending_transcriptions, 0)
        self.assertEqual(self.model.inputs, [])

    async def test_one_waiting_request_and_explicit_busy_response(self) -> None:
        self.service.UPLOAD_TIMEOUT_SECONDS = 0.1
        self.model.block = True
        first = asyncio.create_task(self.upload(audio_bytes()))
        try:
            started = await asyncio.to_thread(self.model.started.wait, 2)
            self.assertTrue(started)
            second = asyncio.create_task(self.upload(audio_bytes()))
            try:
                for _ in range(100):
                    if self.service.app.state.pending_transcriptions == 2:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(self.service.app.state.pending_transcriptions, 2)
                response = await self.upload(audio_bytes())
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers["retry-after"], "1")
                self.assertEqual(len(self.model.inputs), 1)
                await asyncio.sleep(0.15)
                self.assertFalse(first.done())
                self.assertFalse(second.done())
                self.model.release.set()
                responses = await asyncio.gather(first, second)
                self.assertTrue(
                    all(result.status_code == 200 for result in responses)
                )
                self.assertEqual(self.service.app.state.pending_transcriptions, 0)
            finally:
                self.model.release.set()
                await second
        finally:
            self.model.release.set()
            await first

    async def test_cancelled_request_keeps_capacity_until_worker_finishes(self) -> None:
        self.model.block = True
        first = asyncio.create_task(self.upload(audio_bytes()))
        self.assertTrue(await asyncio.to_thread(self.model.started.wait, 2))
        first.cancel()
        second = asyncio.create_task(self.upload(audio_bytes()))
        try:
            for _ in range(100):
                if self.service.app.state.pending_transcriptions == 2:
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(self.service.app.state.pending_transcriptions, 2)
            first.cancel()
            await asyncio.sleep(0.01)
            self.assertEqual((await self.upload(audio_bytes())).status_code, 503)
            self.assertEqual(len(self.model.inputs), 1)
            self.model.release.set()
            with self.assertRaises(asyncio.CancelledError):
                await first
            self.assertEqual((await second).status_code, 200)
            self.assertEqual(self.service.app.state.pending_transcriptions, 0)
        finally:
            self.model.release.set()
            await asyncio.gather(first, second, return_exceptions=True)


if __name__ == "__main__":
    unittest.main()
