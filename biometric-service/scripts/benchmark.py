"""
Phase 1 benchmark script — Master Plan Phase 1 requirements 10/11/12.

Benchmarks the ACTUALLY-INSTALLED DeepFace runtime against non-production,
publicly-published test fixtures ONLY (tests/fixtures/*.jpg — sourced from
DeepFace's own public repository test dataset, see the biometric-service
README note in the master plan's Phase 1 record; never real Neozy
employee/customer data).

Run: PYTHONUTF8=1 .venv/Scripts/python.exe scripts/benchmark.py

Prints a plain-text report to stdout. Does not persist any image or
embedding anywhere.
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psutil  # noqa: E402
from deepface import DeepFace  # noqa: E402
from deepface.modules import modeling  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tests", "fixtures")

RECOGNITION_MODELS = ["ArcFace", "Facenet512", "SFace"]
DETECTOR_BACKENDS = ["retinaface", "mediapipe", "yunet"]

SAME_PERSON_PAIR = ("face_a_1.jpg", "face_a_2.jpg")
DIFFERENT_PERSON_PAIR = ("face_a_1.jpg", "face_b_1.jpg")


def _rss_mb() -> float:
    return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def _path(name: str) -> str:
    return os.path.join(FIXTURES, name)


def benchmark_recognition_model(model_name: str) -> dict:
    result: dict = {"model": model_name}
    mem_before = _rss_mb()
    t0 = time.monotonic()
    try:
        modeling.build_model(task="facial_recognition", model_name=model_name)
        result["load_ok"] = True
    except Exception as exc:  # noqa: BLE001
        result["load_ok"] = False
        result["load_error"] = f"{type(exc).__name__}: {exc}"
        return result
    result["load_time_s"] = round(time.monotonic() - t0, 3)
    result["rss_delta_mb_after_load"] = round(_rss_mb() - mem_before, 1)

    try:
        t0 = time.monotonic()
        rep1 = DeepFace.represent(_path(SAME_PERSON_PAIR[0]), model_name=model_name, detector_backend="retinaface")[0]
        represent_time_1 = time.monotonic() - t0
        t0 = time.monotonic()
        rep2 = DeepFace.represent(_path(SAME_PERSON_PAIR[1]), model_name=model_name, detector_backend="retinaface")[0]
        represent_time_2 = time.monotonic() - t0
        result["embedding_ok"] = True
        result["embedding_dim"] = len(rep1["embedding"])
        result["represent_warm_time_s"] = round(represent_time_2, 3)
        result["represent_cold_time_s"] = round(represent_time_1, 3)
    except Exception as exc:  # noqa: BLE001
        result["embedding_ok"] = False
        result["embedding_error"] = f"{type(exc).__name__}: {exc}"
        return result

    try:
        rep3 = DeepFace.represent(_path(DIFFERENT_PERSON_PAIR[1]), model_name=model_name, detector_backend="retinaface")[0]

        same = DeepFace.verify(rep1["embedding"], rep2["embedding"], model_name=model_name, silent=True)
        diff = DeepFace.verify(rep1["embedding"], rep3["embedding"], model_name=model_name, silent=True)

        result["verify_ok"] = True
        result["deepface_threshold"] = same["threshold"]
        result["same_person_distance"] = round(same["distance"], 4)
        result["same_person_verified"] = same["verified"]
        result["same_person_expected"] = True
        result["same_person_correct"] = same["verified"] is True
        result["different_person_distance"] = round(diff["distance"], 4)
        result["different_person_verified"] = diff["verified"]
        result["different_person_expected"] = False
        result["different_person_correct"] = diff["verified"] is False
    except Exception as exc:  # noqa: BLE001
        result["verify_ok"] = False
        result["verify_error"] = f"{type(exc).__name__}: {exc}"

    return result


def benchmark_detector(detector_backend: str) -> dict:
    result: dict = {"detector": detector_backend}
    mem_before = _rss_mb()
    t0 = time.monotonic()
    try:
        modeling.build_model(task="face_detector", model_name=detector_backend)
        result["load_ok"] = True
    except Exception as exc:  # noqa: BLE001
        result["load_ok"] = False
        result["load_error"] = f"{type(exc).__name__}: {exc}"
        return result
    result["load_time_s"] = round(time.monotonic() - t0, 3)
    result["rss_delta_mb_after_load"] = round(_rss_mb() - mem_before, 1)

    try:
        t0 = time.monotonic()
        faces_cold = DeepFace.extract_faces(_path("face_a_1.jpg"), detector_backend=detector_backend, enforce_detection=True)
        cold_time = time.monotonic() - t0
        t0 = time.monotonic()
        faces_warm = DeepFace.extract_faces(_path("face_a_1.jpg"), detector_backend=detector_backend, enforce_detection=True)
        warm_time = time.monotonic() - t0
        result["detect_ok"] = True
        result["faces_found_single_face_image"] = len(faces_warm)
        result["detect_confidence"] = round(faces_warm[0].get("confidence", 0), 4)
        result["detect_cold_time_s"] = round(cold_time, 3)
        result["detect_warm_time_s"] = round(warm_time, 3)

        t0 = time.monotonic()
        multi = DeepFace.extract_faces(_path("multi_face.jpg"), detector_backend=detector_backend, enforce_detection=True)
        result["multi_face_detected_count"] = len(multi)
        result["multi_face_time_s"] = round(time.monotonic() - t0, 3)
    except Exception as exc:  # noqa: BLE001
        result["detect_ok"] = False
        result["detect_error"] = f"{type(exc).__name__}: {exc}"

    try:
        t0 = time.monotonic()
        DeepFace.extract_faces(_path("no_face.jpg"), detector_backend=detector_backend, enforce_detection=True)
        result["no_face_correctly_rejected"] = False  # should have raised
    except Exception:
        result["no_face_correctly_rejected"] = True

    return result


def benchmark_liveness() -> dict:
    result: dict = {}
    mem_before = _rss_mb()
    t0 = time.monotonic()
    try:
        modeling.build_model(task="spoofing", model_name="Fasnet")
        result["load_ok"] = True
    except Exception as exc:  # noqa: BLE001
        result["load_ok"] = False
        result["load_error"] = f"{type(exc).__name__}: {exc}"
        return result
    result["load_time_s"] = round(time.monotonic() - t0, 3)
    result["rss_delta_mb_after_load"] = round(_rss_mb() - mem_before, 1)

    try:
        t0 = time.monotonic()
        faces = DeepFace.extract_faces(_path("face_a_1.jpg"), detector_backend="retinaface", enforce_detection=True, anti_spoofing=True)
        result["call_ok"] = True
        result["is_real_on_genuine_photo"] = faces[0].get("is_real")
        result["antispoof_score"] = round(faces[0].get("antispoof_score", 0), 4)
        result["call_time_s"] = round(time.monotonic() - t0, 3)
    except Exception as exc:  # noqa: BLE001
        result["call_ok"] = False
        result["call_error"] = f"{type(exc).__name__}: {exc}"

    return result


def main() -> None:
    print("=" * 70)
    print("PHASE 1 BENCHMARK — actual installed DeepFace runtime")
    print("Test images: DeepFace project's own public test dataset (non-production)")
    print("=" * 70)

    print("\n--- Recognition model comparison ---")
    for model_name in RECOGNITION_MODELS:
        r = benchmark_recognition_model(model_name)
        print(f"\n{model_name}:")
        for k, v in r.items():
            if k == "model":
                continue
            print(f"  {k}: {v}")

    print("\n--- Detector backend comparison ---")
    for detector in DETECTOR_BACKENDS:
        r = benchmark_detector(detector)
        print(f"\n{detector}:")
        for k, v in r.items():
            if k == "detector":
                continue
            print(f"  {k}: {v}")

    print("\n--- Liveness (Fasnet) ---")
    r = benchmark_liveness()
    for k, v in r.items():
        print(f"  {k}: {v}")

    print("\n" + "=" * 70)
    print("BENCHMARK COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
