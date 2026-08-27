"""
Configuration loading (Master Plan Phase 1 requirement 5: "Model/detector/
liveness configuration MUST be environment-driven, never hardcoded").
"""

import importlib
import os


def test_defaults_when_no_env_set(monkeypatch):
    for key in (
        "DEEPFACE_RECOGNITION_MODEL",
        "DEEPFACE_DETECTOR_BACKEND",
        "DEEPFACE_ANTI_SPOOFING_ENABLED",
        "DEEPFACE_VERIFY_THRESHOLD",
    ):
        monkeypatch.delenv(key, raising=False)

    import app.config as config_module
    importlib.reload(config_module)
    settings = config_module.load_settings()

    assert settings.recognition_model == "ArcFace"
    # yunet, not retinaface: Phase 1 benchmark measured >100x faster
    # detection with equivalent correctness (see app/config.py's comment
    # and the master plan's Phase 1 record for the real numbers).
    assert settings.detector_backend == "yunet"
    assert settings.anti_spoofing_enabled is True
    assert settings.verify_threshold_override is None


def test_env_overrides_are_honored(monkeypatch):
    monkeypatch.setenv("DEEPFACE_RECOGNITION_MODEL", "Facenet512")
    monkeypatch.setenv("DEEPFACE_DETECTOR_BACKEND", "mediapipe")
    monkeypatch.setenv("DEEPFACE_ANTI_SPOOFING_ENABLED", "false")
    monkeypatch.setenv("DEEPFACE_VERIFY_THRESHOLD", "0.55")

    import app.config as config_module
    importlib.reload(config_module)
    settings = config_module.load_settings()

    assert settings.recognition_model == "Facenet512"
    assert settings.detector_backend == "mediapipe"
    assert settings.anti_spoofing_enabled is False
    assert settings.verify_threshold_override == 0.55

    # restore process-global settings singleton for any later test in this
    # module/session that imports app.config.settings directly
    importlib.reload(config_module)
