from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_joint_launcher_skips_services_whose_ports_are_already_listening() -> None:
    launcher = (ROOT / "start-local.bat").read_text(encoding="utf-8")

    assert ":port_is_listening" in launcher
    for port in (5173, 5174, 8001, 8283):
        assert f"call :port_is_listening {port}" in launcher
    assert "already listening; skipping duplicate start" in launcher


def test_joint_stop_script_covers_avatar_ports() -> None:
    stop_script = (ROOT / "stop-local.bat").read_text(encoding="utf-8")

    assert "8282 8283" in stop_script
    assert "taskkill /T /F /PID" in stop_script
