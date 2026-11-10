"""Create local configuration without installing dependencies or contacting services."""
from pathlib import Path
import secrets


ROOT = Path(__file__).resolve().parents[1]


def prepare_env() -> None:
    target = ROOT / "backend" / ".env"
    template = ROOT / "backend" / ".env.example"
    if target.exists():
        print("Existing backend/.env preserved; verify credentials if migrating.")
    else:
        text = template.read_text(encoding="utf-8")
        text = text.replace("ADMIN_DEFAULT_PASSWORD=CHANGE_ME", "ADMIN_DEFAULT_PASSWORD=" + secrets.token_urlsafe(18))
        text = text.replace("AUTH_TOKEN_SECRET=CHANGE_ME", "AUTH_TOKEN_SECRET=" + secrets.token_urlsafe(48))
        with target.open("x", encoding="utf-8") as stream:
            stream.write(text)
        print("Created backend/.env. Read the generated admin password there; do not commit it.")
    for source, destination in [
        (ROOT / "configs/core.example.toml", ROOT / "configs/core.local.toml"),
        (ROOT / "frontend/.env.example", ROOT / "frontend/.env.local"),
    ]:
        if not destination.exists():
            with destination.open("x", encoding="utf-8") as stream:
                stream.write(source.read_text(encoding="utf-8"))


if __name__ == "__main__":
    prepare_env()
