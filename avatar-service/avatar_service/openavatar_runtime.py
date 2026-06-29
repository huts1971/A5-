import subprocess
import urllib.request
from pathlib import Path
from typing import Callable, Protocol

from .runtime import RuntimeStatus


class RuntimeProcess(Protocol):
    def poll(self) -> int | None: ...

    def terminate(self) -> None: ...

    def wait(self, timeout: float) -> int: ...

    def kill(self) -> None: ...


ProcessFactory = Callable[[list[str], Path], RuntimeProcess]
ReadinessProbe = Callable[[str], bool]


def _start_process(command: list[str], cwd: Path) -> RuntimeProcess:
    return subprocess.Popen(command, cwd=cwd)


def _probe_readiness(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status == 200
    except OSError:
        return False


class OpenAvatarRuntime:
    def __init__(
        self,
        root: Path,
        config_path: Path,
        process_factory: ProcessFactory = _start_process,
        readiness_probe: ReadinessProbe = _probe_readiness,
        host: str = "127.0.0.1",
        port: int = 8282,
    ):
        self.root = root.resolve()
        self.config_path = config_path
        self.process_factory = process_factory
        self.readiness_probe = readiness_probe
        self.host = host
        self.port = port
        self.process: RuntimeProcess | None = None

    @property
    def config_file(self) -> Path:
        return self.config_path if self.config_path.is_absolute() else self.root / self.config_path

    @property
    def python_file(self) -> Path:
        return self.root / ".venv" / "Scripts" / "python.exe"

    @property
    def demo_file(self) -> Path:
        return self.root / "src" / "demo.py"

    def installation_error(self) -> str | None:
        if not self.root.is_dir():
            return f"OpenAvatarChat root not found: {self.root}"
        if not self.config_file.is_file():
            return f"OpenAvatarChat config not found: {self.config_file}"
        if not self.python_file.is_file():
            return f"OpenAvatarChat Python not found: {self.python_file}"
        if not self.demo_file.is_file():
            return f"OpenAvatarChat entrypoint not found: {self.demo_file}"
        return None

    def start(self) -> None:
        if self.installation_error() is not None:
            return
        self.process = self.process_factory(
            [
                str(self.python_file),
                str(self.demo_file),
                "--host",
                self.host,
                "--port",
                str(self.port),
                "--config",
                str(self.config_file),
            ],
            self.root,
        )

    def stop(self) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None

    def status(self) -> RuntimeStatus:
        installation_error = self.installation_error()
        if installation_error is not None:
            return RuntimeStatus(ready=False, detail=installation_error)
        if self.process is None:
            return RuntimeStatus(ready=False, detail="OpenAvatarChat is not started")
        exit_code = self.process.poll()
        if exit_code is not None:
            return RuntimeStatus(
                ready=False,
                detail=f"OpenAvatarChat exited with code {exit_code}",
            )
        if self.readiness_probe(f"http://{self.host}:{self.port}/readiness"):
            return RuntimeStatus(ready=True, detail="OpenAvatarChat is ready")
        return RuntimeStatus(ready=False, detail="OpenAvatarChat model is loading")
