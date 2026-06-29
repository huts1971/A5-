from pathlib import Path

from avatar_service.openavatar_runtime import OpenAvatarRuntime
from avatar_service.runtime import RuntimeStatus


def test_runtime_explains_when_openavatar_root_is_missing(tmp_path: Path) -> None:
    missing_root = tmp_path / "OpenAvatarChat"
    runtime = OpenAvatarRuntime(
        root=missing_root,
        config_path=Path("config/a5_liteavatar.yaml"),
    )

    status = runtime.status()

    assert status.ready is False
    assert status.detail == f"OpenAvatarChat root not found: {missing_root}"


def test_runtime_does_not_spawn_when_installation_is_missing(tmp_path: Path) -> None:
    commands: list[list[str]] = []
    runtime = OpenAvatarRuntime(
        root=tmp_path / "missing",
        config_path=Path("config/a5_liteavatar.yaml"),
        process_factory=lambda command, _cwd: commands.append(command),
    )

    runtime.start()

    assert commands == []


def test_runtime_explains_when_bridge_config_is_missing(tmp_path: Path) -> None:
    root = tmp_path / "OpenAvatarChat"
    root.mkdir()
    runtime = OpenAvatarRuntime(
        root=root,
        config_path=Path("config/a5_liteavatar.yaml"),
    )

    status = runtime.status()

    assert status.ready is False
    assert status.detail == f"OpenAvatarChat config not found: {root / 'config/a5_liteavatar.yaml'}"


def test_runtime_explains_when_openavatar_python_is_missing(tmp_path: Path) -> None:
    root = tmp_path / "OpenAvatarChat"
    config = root / "config" / "a5_liteavatar.yaml"
    demo = root / "src" / "demo.py"
    for file in (config, demo):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.touch()
    commands: list[list[str]] = []
    runtime = OpenAvatarRuntime(
        root=root,
        config_path=Path("config/a5_liteavatar.yaml"),
        process_factory=lambda command, _cwd: commands.append(command),
    )

    runtime.start()

    assert commands == []
    assert runtime.status() == RuntimeStatus(
        ready=False,
        detail=f"OpenAvatarChat Python not found: {root / '.venv/Scripts/python.exe'}",
    )


def test_runtime_starts_openavatar_with_its_own_python_and_config(tmp_path: Path) -> None:
    root = tmp_path / "OpenAvatarChat"
    demo = root / "src" / "demo.py"
    config = root / "config" / "a5_liteavatar.yaml"
    python = root / ".venv" / "Scripts" / "python.exe"
    for file in (demo, config, python):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.touch()
    commands: list[tuple[list[str], Path]] = []

    class FakeProcess:
        def poll(self):
            return None

    runtime = OpenAvatarRuntime(
        root=root,
        config_path=Path("config/a5_liteavatar.yaml"),
        process_factory=lambda command, cwd: commands.append((command, cwd)) or FakeProcess(),
    )

    runtime.start()

    assert commands == [
        (
            [
                str(python),
                str(demo),
                "--host",
                "127.0.0.1",
                "--port",
                "8282",
                "--config",
                str(config),
            ],
            root,
        )
    ]


def test_runtime_becomes_ready_only_after_openavatar_readiness_passes(tmp_path: Path) -> None:
    root = tmp_path / "OpenAvatarChat"
    for file in (
        root / "src" / "demo.py",
        root / "config" / "a5_liteavatar.yaml",
        root / ".venv" / "Scripts" / "python.exe",
    ):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.touch()
    probe_result = {"ready": False}

    class FakeProcess:
        def poll(self):
            return None

    runtime = OpenAvatarRuntime(
        root=root,
        config_path=Path("config/a5_liteavatar.yaml"),
        process_factory=lambda _command, _cwd: FakeProcess(),
        readiness_probe=lambda _url: probe_result["ready"],
    )
    runtime.start()

    assert runtime.status().ready is False
    probe_result["ready"] = True
    assert runtime.status() == RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")


def test_runtime_stops_the_openavatar_process(tmp_path: Path) -> None:
    root = tmp_path / "OpenAvatarChat"
    for file in (
        root / "src" / "demo.py",
        root / "config" / "a5_liteavatar.yaml",
        root / ".venv" / "Scripts" / "python.exe",
    ):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.touch()
    events: list[str] = []

    class FakeProcess:
        def poll(self):
            return None

        def terminate(self):
            events.append("terminate")

        def wait(self, timeout: float):
            events.append(f"wait:{timeout}")

    runtime = OpenAvatarRuntime(
        root=root,
        config_path=Path("config/a5_liteavatar.yaml"),
        process_factory=lambda _command, _cwd: FakeProcess(),
    )
    runtime.start()

    runtime.stop()

    assert events == ["terminate", "wait:10"]
