from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Iterable

from .contracts import Chunk, digest


@dataclass
class Block:
    section: str
    text: str
    pages: list[int] = field(default_factory=list)
    kind: str = "paragraph"
    table_anchor: str = ""
    header: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)


def clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace("\x00", "")).strip()


def parse_document(path: Path, table_anchors: dict[str, str] | None = None) -> list[Block]:
    """PDF anchors use '<1-based-page>:<1-based-table>' -> stable table name."""
    suffix = path.suffix.lower()
    anchors = table_anchors or {}
    blocks: list[Block] = []
    if suffix in {".html", ".htm"}:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
        for node in soup.select("script,style,nav,footer,header,noscript,form"):
            node.decompose()
        root = soup.find("main") or soup.find("article") or soup.body or soup
        section = path.stem
        for node in root.find_all(["h1", "h2", "h3", "h4", "p", "li", "table"]):
            if node.find_parent("table") or node.find_parent("li"):
                continue
            if node.name.startswith("h"):
                section = clean(node.get_text(" "))
            elif node.name == "table":
                rows = [[clean(cell.get_text(" ")) for cell in row.find_all(["td", "th"])]
                        for row in node.find_all("tr")]
                rows = [row for row in rows if row]
                if rows:
                    caption = node.find("caption")
                    blocks.append(Block(section, "", kind="table", header=rows[0], rows=rows[1:],
                                        table_anchor=caption.get_text(" ") if caption else ""))
            else:
                blocks.append(Block(section, clean(node.get_text(" "))))
    elif suffix == ".pdf":
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            for number, page in enumerate(pdf.pages, 1):
                tables = page.find_tables()
                def outside_tables(obj: dict) -> bool:
                    x = (obj.get("x0", 0) + obj.get("x1", 0)) / 2
                    y = (obj.get("top", 0) + obj.get("bottom", 0)) / 2
                    return not any(t.bbox[0] <= x <= t.bbox[2] and t.bbox[1] <= y <= t.bbox[3]
                                   for t in tables)
                text = page.filter(outside_tables).extract_text() or ""
                if not text.strip() and not tables:
                    raise ValueError(f"Page {number} has no extractable text; OCR must be supplied explicitly")
                blocks.append(Block(path.stem, clean(text), [number]))
                for index, table in enumerate(tables, 1):
                    rows = [[clean(cell or "") for cell in row] for row in table.extract()]
                    if rows:
                        blocks.append(Block(path.stem, "", [number], "table",
                                            anchors.get(f"{number}:{index}", ""), rows[0], rows[1:]))
    elif suffix == ".docx":
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        doc = Document(path)
        section = path.stem
        for element in doc.element.body:
            if element.tag.endswith("}p"):
                p = Paragraph(element, doc)
                if p.style and p.style.name.startswith("Heading"):
                    section = p.text.strip()
                else:
                    blocks.append(Block(section, clean(p.text)))
            elif element.tag.endswith("}tbl"):
                rows = [[clean(c.text) for c in row.cells] for row in Table(element, doc).rows]
                if rows:
                    blocks.append(Block(section, "", kind="table", header=rows[0], rows=rows[1:]))
    elif suffix in {".md", ".markdown"}:
        from markdown_it import MarkdownIt

        tokens = MarkdownIt("commonmark").enable("table").parse(path.read_text(encoding="utf-8-sig"))
        section, rows, row = path.stem, [], []
        in_table, in_heading = False, False
        for token in tokens:
            if token.type == "heading_open":
                in_heading = True
            elif token.type == "heading_close":
                in_heading = False
            elif token.type == "table_open":
                in_table, rows = True, []
            elif token.type == "tr_open":
                row = []
            elif token.type == "tr_close":
                rows.append(row)
            elif token.type == "table_close":
                if rows:
                    blocks.append(Block(section, "", kind="table", header=rows[0], rows=rows[1:]))
                in_table = False
            elif token.type == "inline":
                text = clean(token.content)
                if in_heading:
                    section = text
                elif in_table:
                    row.append(text)
                elif text:
                    blocks.append(Block(section, text))
            elif token.type in {"fence", "code_block"}:
                blocks.append(Block(section, clean(token.content)))
    elif suffix == ".txt":
        section, current = path.stem, []
        for line in path.read_text(encoding="utf-8-sig").splitlines() + [""]:
            heading = re.match(r"^#{1,6}\s+(.+)$", line)
            if heading or not line.strip():
                if current:
                    blocks.append(Block(section, clean("\n".join(current))))
                    current = []
                if heading:
                    section = heading.group(1)
            else:
                current.append(line)
    else:
        raise ValueError(f"Unsupported document format: {suffix}")
    return [b for b in blocks if b.text or b.rows]


def flatten_tables(blocks: list[Block]) -> list[Block]:
    """Merge only explicitly anchored, adjacent PDF continuations with identical headers."""
    result: list[Block] = []
    tables: dict[str, Block] = {}
    for block in blocks:
        if block.kind != "table":
            result.append(block)
            continue
        block = replace(block, pages=list(block.pages), header=list(block.header),
                        rows=[list(row) for row in block.rows])
        previous = tables.get(block.table_anchor) if block.table_anchor else None
        if (previous and previous.header == block.header and previous.pages and block.pages
                and block.pages[0] == previous.pages[-1] + 1):
            previous.rows.extend(block.rows)
            previous.pages.extend(block.pages)
        else:
            result.append(block)
            if block.table_anchor:
                tables[block.table_anchor] = block
    flattened: list[Block] = []
    for block in result:
        if block.kind != "table":
            flattened.append(block)
            continue
        for row in block.rows:
            if row == block.header:
                continue
            pairs = [f"{block.header[i] if i < len(block.header) else f'column_{i + 1}'}: {value}"
                     for i, value in enumerate(row)]
            text = f"{block.section} | {block.table_anchor}\n" + " ; ".join(pairs)
            flattened.append(Block(block.section, text, sorted(set(block.pages)), "table_row",
                                   block.table_anchor))
    return flattened


def sentence_windows(text: str, limit: int = 700, overlap: int = 100) -> Iterable[str]:
    if not 0 <= overlap < limit:
        raise ValueError("Require 0 <= overlap < chunk limit")
    units = re.split(r"(?<=[。！？!?；;])|\n+", text)
    # Oversized single sentences are explicitly split, never silently truncated.
    units = [u[i:i + limit] for u in units if u.strip() for i in range(0, len(u), limit)]
    current = ""
    for unit in units:
        if len(current) + len(unit) + 1 > limit:
            if current.strip():
                yield current.strip()
            tail = current[-overlap:] if overlap else ""
            current = tail + unit if len(tail) + len(unit) <= limit else unit
        else:
            current += ("\n" if current else "") + unit
    if current.strip():
        yield current.strip()


def chunk_blocks(blocks: list[Block], *, document_id: str, title: str, map_id: str,
                 spot_id: str = "", source_url: str = "", approved: bool = False,
                 source_type: str = "document", limit: int = 700, overlap: int = 100) -> list[Chunk]:
    chunks = []
    for block_index, block in enumerate(flatten_tables(blocks)):
        parent = digest([document_id, block.section])[:32]
        for index, text in enumerate(sentence_windows(block.text, limit, overlap)):
            chunks.append(Chunk(
                id=digest([document_id, block_index, index, text])[:40], document_id=document_id,
                parent_id=parent, title=title, section=block.section, text=text, map_id=map_id,
                spot_id=spot_id, source_url=source_url, source_type=source_type, pages=block.pages,
                approved=approved, metadata={"kind": block.kind, "table_anchor": block.table_anchor},
            ))
    return chunks


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix=".partial")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            for record in records:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Corpus:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = sorted((c for c in chunks if c.approved), key=lambda c: c.id)
        self.by_id = {c.id: c for c in self.chunks}
        if len(self.by_id) != len(self.chunks):
            raise ValueError("Duplicate chunk IDs; fix ingestion before indexing")
        if not self.chunks:
            raise ValueError("No approved chunks")
        self.id = digest([c.model_dump() for c in self.chunks])

    @classmethod
    def load(cls, path: str | Path) -> Corpus:
        path = Path(path)
        release = path.with_suffix(".release.jsonl")
        manifest = json.loads(release.read_text(encoding="utf-8")) if release.is_file() else None
        if manifest and manifest.get("corpus_file"):
            filename = manifest["corpus_file"]
            if not isinstance(filename, str) or Path(filename).name != filename:
                raise ValueError("Release corpus_file must be a filename in the corpus directory")
            path = path.parent / filename
        with open(path, encoding="utf-8") as stream:
            corpus = cls([Chunk.model_validate_json(line) for line in stream if line.strip()])
        if manifest and corpus.id != manifest["corpus_id"]:
            raise ValueError("Release manifest and corpus fingerprint differ")
        return corpus

    def save(self, path: Path) -> None:
        write_jsonl(path, (chunk.model_dump() for chunk in self.chunks))
