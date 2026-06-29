import os
from collections.abc import Mapping
from pathlib import Path

from .openavatar_runtime import OpenAvatarRuntime


def openavatar_base_url_from_environment(
    environ: Mapping[str, str] = os.environ,
) -> str:
    host = environ.get("A5_OPENAVATAR_HOST", "127.0.0.1")
    port = int(environ.get("A5_OPENAVATAR_PORT", "8282"))
    return f"http://{host}:{port}"


def runtime_from_environment(
    service_dir: Path,
    environ: Mapping[str, str] = os.environ,
) -> OpenAvatarRuntime:
    root_value = environ.get("A5_OPENAVATAR_ROOT", "vendor/OpenAvatarChat")
    config_value = environ.get("A5_OPENAVATAR_CONFIG", "config/a5_liteavatar.yaml")
    root = Path(root_value)
    if not root.is_absolute():
        root = service_dir / root
    host = environ.get("A5_OPENAVATAR_HOST", "127.0.0.1")
    port = int(environ.get("A5_OPENAVATAR_PORT", "8282"))
    return OpenAvatarRuntime(
        root=root,
        config_path=Path(config_value),
        host=host,
        port=port,
    )
