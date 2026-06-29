from pathlib import Path

from dotenv import load_dotenv

from .app import create_app
from .gateway import HttpOpenAvatarGateway
from .settings import (
    openavatar_base_url_from_environment,
    runtime_from_environment,
)


SERVICE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(SERVICE_DIR / ".env")
OPENAVATAR_URL = openavatar_base_url_from_environment()

app = create_app(
    runtime_from_environment(SERVICE_DIR),
    webrtc_gateway=HttpOpenAvatarGateway(OPENAVATAR_URL),
    openavatar_url=OPENAVATAR_URL,
)
