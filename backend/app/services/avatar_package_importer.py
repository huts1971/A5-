from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import shutil
import stat
from zipfile import BadZipFile, ZipFile

from app.core.errors import ApiError


DANGEROUS_SUFFIXES = {
    ".7z",
    ".bat",
    ".cmd",
    ".com",
    ".dll",
    ".exe",
    ".jar",
    ".msi",
    ".ps1",
    ".rar",
    ".scr",
    ".sh",
    ".tar",
    ".zip",
}
DANGEROUS_ARCHIVE_SUFFIXES = (
    ".tar.gz",
    ".tar.br",
    ".tar.bz2",
    ".tar.xz",
    ".tbz",
    ".tgz",
)


@dataclass(frozen=True)
class ImportedAvatarPackage:
    resource_path: str
    resource_size: int
    manifest: dict[str, str]


def import_avatar_package(
    content: bytes,
    package_root: str,
    version_id: str,
    maximum_extracted_bytes: int,
) -> ImportedAvatarPackage:
    root = Path(package_root)
    temporary = root / f".{version_id}.tmp"
    destination = root / version_id
    shutil.rmtree(temporary, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)

    try:
        with ZipFile(_bytes_path(content)) as archive:
            extracted_size = sum(info.file_size for info in archive.infolist())
            compressed_size = sum(info.compress_size for info in archive.infolist())
            if extracted_size > maximum_extracted_bytes:
                raise ApiError(
                    "Unity WebGL ZIP 解压后超过 300 MB 限制",
                    "AVATAR_ZIP_EXPANDED_TOO_LARGE",
                    413,
                )
            if (
                extracted_size > 1024 * 1024
                and extracted_size > max(1, compressed_size) * 200
            ):
                raise ApiError(
                    "ZIP 压缩比异常，疑似 ZIP 炸弹",
                    "AVATAR_ZIP_BOMB",
                    413,
                )
            for info in archive.infolist():
                _validate_archive_entry(info)
            files = [
                _safe_archive_path(info.filename)
                for info in archive.infolist()
                if not info.is_dir()
            ]
            build_dirs = {
                path.parent
                for path in files
                if path.parent.name == "Build"
            }
            if len(build_dirs) != 1:
                raise ApiError(
                    "ZIP 必须包含唯一的 Unity WebGL Build 目录",
                    "AVATAR_BUILD_INVALID",
                    400,
                )
            build_dir = next(iter(build_dirs))
            if len(build_dir.parts) not in {1, 2}:
                raise ApiError(
                    "Unity WebGL Build 目录最多允许一层包装目录",
                    "AVATAR_BUILD_INVALID",
                    400,
                )
            wrapper = build_dir.parent
            manifest = _build_manifest(files, build_dir, wrapper)

            for info in archive.infolist():
                if info.is_dir():
                    continue
                source_path = _safe_archive_path(info.filename)
                relative = source_path.relative_to(wrapper) if wrapper.parts else source_path
                target = temporary.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)

        temporary.replace(destination)
        return ImportedAvatarPackage(
            resource_path=version_id,
            resource_size=sum(
                file.stat().st_size for file in destination.rglob("*") if file.is_file()
            ),
            manifest=manifest,
        )
    except ApiError:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    except (BadZipFile, ValueError, OSError) as exc:
        shutil.rmtree(temporary, ignore_errors=True)
        raise ApiError(
            "Unity WebGL ZIP 无法读取",
            "AVATAR_ZIP_INVALID",
            400,
        ) from exc


def _bytes_path(content: bytes):
    from io import BytesIO

    return BytesIO(content)


def _safe_archive_path(filename: str) -> PurePosixPath:
    path = PurePosixPath(filename.replace("\\", "/"))
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ApiError("ZIP 包含不安全路径", "AVATAR_ZIP_UNSAFE_PATH", 400)
    return path


def _validate_archive_entry(info) -> None:
    path = _safe_archive_path(info.filename)
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise ApiError("ZIP 不允许包含符号链接", "AVATAR_ZIP_UNSAFE_FILE", 400)
    lower_name = path.name.lower()
    if not info.is_dir() and (
        path.suffix.lower() in DANGEROUS_SUFFIXES
        or lower_name.endswith(DANGEROUS_ARCHIVE_SUFFIXES)
    ):
        raise ApiError("ZIP 包含不允许的文件类型", "AVATAR_ZIP_UNSAFE_FILE", 400)


def _build_manifest(
    files: list[PurePosixPath],
    build_dir: PurePosixPath,
    wrapper: PurePosixPath,
) -> dict[str, str]:
    build_files = [path for path in files if path.parent == build_dir]
    kinds = {
        "loader": _single_match(build_files, (".loader.js", ".loader.js.gz", ".loader.js.br")),
        "data": _single_match(build_files, (".data", ".data.gz", ".data.br")),
        "framework": _single_match(
            build_files,
            (".framework.js", ".framework.js.gz", ".framework.js.br"),
        ),
        "wasm": _single_match(build_files, (".wasm", ".wasm.gz", ".wasm.br")),
    }
    manifest = {
        kind: _relative(path, wrapper)
        for kind, path in kinds.items()
    }
    streaming = wrapper / "StreamingAssets"
    if any(streaming in path.parents for path in files):
        manifest["streaming_assets"] = _relative(streaming, wrapper)
    fallback = wrapper / "fallback.png"
    if fallback in files:
        manifest["fallback"] = _relative(fallback, wrapper)
    return manifest


def _single_match(
    files: list[PurePosixPath],
    suffixes: tuple[str, ...],
) -> PurePosixPath:
    matches = [path for path in files if path.name.endswith(suffixes)]
    if len(matches) != 1:
        raise ApiError(
            "Unity WebGL 核心构建文件不完整或存在重复",
            "AVATAR_BUILD_FILES_INVALID",
            400,
        )
    return matches[0]


def _relative(path: PurePosixPath, wrapper: PurePosixPath) -> str:
    relative = path.relative_to(wrapper) if wrapper.parts else path
    return relative.as_posix()
