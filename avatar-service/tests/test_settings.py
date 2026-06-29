from pathlib import Path

from avatar_service.settings import (
    openavatar_base_url_from_environment,
    runtime_from_environment,
)


def test_runtime_configuration_resolves_local_openavatar_installation(tmp_path: Path) -> None:
    runtime = runtime_from_environment(
        service_dir=tmp_path,
        environ={
            "A5_OPENAVATAR_ROOT": "vendor/OpenAvatarChat",
            "A5_OPENAVATAR_CONFIG": "config/a5_liteavatar.yaml",
            "A5_OPENAVATAR_HOST": "127.0.0.2",
            "A5_OPENAVATAR_PORT": "8382",
        },
    )

    assert runtime.root == (tmp_path / "vendor" / "OpenAvatarChat").resolve()
    assert runtime.config_path == Path("config/a5_liteavatar.yaml")
    assert runtime.host == "127.0.0.2"
    assert runtime.port == 8382


def test_gateway_base_url_uses_the_same_openavatar_endpoint() -> None:
    environment = {
        "A5_OPENAVATAR_HOST": "127.0.0.2",
        "A5_OPENAVATAR_PORT": "8382",
    }

    assert (
        openavatar_base_url_from_environment(environment)
        == "http://127.0.0.2:8382"
    )
