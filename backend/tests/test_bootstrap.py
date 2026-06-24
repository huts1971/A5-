import sqlite3
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

SOURCE_PACKAGE_PATH = (
    Path(__file__).resolve().parents[2] / "Scenic Area Public Information Package"
)
DERIVED_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "knowledge"


def test_startup_creates_p0_tables(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(Settings(database_url=f"sqlite:///{db_path}"))

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        table_names = {
            row[0]
            for row in connection.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }

    assert {
        "scenic_spot",
        "spot_recommendation_profile",
        "route",
        "route_spot",
        "knowledge_doc",
        "knowledge_chunk",
        "spot_fact",
        "entity_alias",
        "tag_alias",
        "source_ref",
        "approved_web_source",
        "approved_web_fact",
        "web_fact_candidate",
        "chat_session",
        "chat_message",
        "road_network_version",
        "road_node",
        "road_edge",
        "spot_road_access",
        "route_time_anchor",
    }.issubset(table_names)


def test_empty_database_bootstraps_curated_spot_data(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        spot_count = connection.execute("select count(*) from scenic_spot").fetchone()[0]
        route_count = connection.execute("select count(*) from route").fetchone()[0]
        route_spot_count = connection.execute(
            "select count(*) from route_spot"
        ).fetchone()[0]
        doc_count = connection.execute("select count(*) from knowledge_doc").fetchone()[0]
        spot_names = {
            row[0] for row in connection.execute("select name from scenic_spot")
        }

    assert spot_count == 24
    assert route_count >= 2
    assert route_spot_count >= 5
    assert doc_count >= 2
    assert {"灵山大佛", "灵山梵宫", "无尽意斋", "拈花广场", "鹿鸣谷"}.issubset(spot_names)


def test_bootstrap_does_not_modify_source_package_files(tmp_path):
    db_path = tmp_path / "app.db"
    before = _package_file_hashes(SOURCE_PACKAGE_PATH)
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
        )
    )

    with TestClient(app):
        pass

    assert _package_file_hashes(SOURCE_PACKAGE_PATH) == before


def test_bootstrap_imports_derived_knowledge_package_without_touching_raw_files(tmp_path):
    db_path = tmp_path / "app.db"
    before = _package_file_hashes(SOURCE_PACKAGE_PATH)
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        derived_doc = connection.execute(
            """
            select d.title, c.chunk_text
            from knowledge_doc d
            join knowledge_chunk c on c.doc_id = d.id
            where d.source_type = 'md'
            and d.title = 'LS-011-灵山大佛'
            order by d.id
            limit 1
            """
        ).fetchone()

    assert (DERIVED_KNOWLEDGE_PATH / "curated" / "facts.json").is_file()
    assert derived_doc is not None
    assert "灵山大佛" in derived_doc[0]
    assert "灵山大佛" in derived_doc[1]
    assert _package_file_hashes(SOURCE_PACKAGE_PATH) == before


def test_bootstrap_imports_raw_word_documents_as_database_chunks(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        xlsx_doc_count = connection.execute(
            """
            select count(*)
            from knowledge_doc
            where path like '%.xlsx'
            """
        ).fetchone()[0]
        docx_titles = {
            row[0]
            for row in connection.execute(
                """
                select title
                from knowledge_doc
                where path like '%.docx'
                """
            )
        }
        docx_stats = connection.execute(
            """
            select count(distinct d.id), count(*), sum(length(c.chunk_text))
            from knowledge_doc d
            join knowledge_chunk c on c.doc_id = d.id
            where d.path like '%.docx'
            """
        ).fetchone()

    assert xlsx_doc_count == 0
    assert docx_titles == {
        "灵山胜境 景点结构化数据集",
        "灵山胜境：历史、文化、景点特色与个性化游览指南",
    }
    assert docx_stats[0] == 2
    assert docx_stats[1] >= 2
    assert docx_stats[2] > 800


def test_bootstrap_removes_legacy_raw_excel_placeholder_chunks(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            insert into knowledge_doc(
                id, title, source_type, path, content_hash, created_at, indexed_at
            )
            values (
                'doc_999',
                '景点景区旅游数据行为分析数据',
                'xlsx',
                'legacy/景点景区旅游数据行为分析数据.xlsx',
                'legacy',
                '2026-01-01 00:00:00',
                null
            )
            """
        )
        connection.execute(
            """
            insert into knowledge_chunk(doc_id, chunk_text, chunk_index, spot_id, vector_id)
            values (
                'doc_999',
                '资料文件：景点景区旅游数据行为分析数据.xlsx',
                0,
                null,
                null
            )
            """
        )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        xlsx_doc_count = connection.execute(
            """
            select count(*)
            from knowledge_doc
            where path like '%.xlsx'
            """
        ).fetchone()[0]
        legacy_chunk_count = connection.execute(
            """
            select count(*)
            from knowledge_chunk
            where doc_id = 'doc_999'
            """
        ).fetchone()[0]

    assert xlsx_doc_count == 0
    assert legacy_chunk_count == 0


def test_bootstrap_imports_curated_structured_data(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        fact = connection.execute(
            """
            select fact_label, fact_value, fact_unit, source_type
            from spot_fact
            where spot_id = 'spot_ling_shan_buddha'
            and fact_key = 'height_meters'
            """
        ).fetchone()
        alias = connection.execute(
            """
            select alias
            from entity_alias
            where entity_type = 'spot'
            and entity_id = 'spot_ling_shan_buddha'
            and alias = '无锡灵山大佛'
            """
        ).fetchone()
        tag_alias = connection.execute(
            """
            select tag
            from tag_alias
            where alias = '拍照'
            """
        ).fetchone()
        source_ref = connection.execute(
            """
            select title
            from source_ref
            where id = 'raw_doc_ling_shan_structured'
            """
        ).fetchone()
        web_source = connection.execute(
            """
            select source_level, allowed
            from approved_web_source
            where domain = 'lingshan.com.cn'
            """
        ).fetchone()
        candidate_count = connection.execute(
            "select count(*) from web_fact_candidate"
        ).fetchone()[0]

    assert fact == ("高度", "88", "米", "database")
    assert alias == ("无锡灵山大佛",)
    assert tag_alias == ("摄影",)
    assert source_ref == ("灵山胜境 景点结构化数据集",)
    assert web_source == ("official", 1)
    assert candidate_count == 0


def test_bootstrap_backfills_curated_facts_into_existing_database(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            create table scenic_spot (
                id varchar(64) primary key,
                name varchar(120) not null,
                summary text,
                story text,
                tags json,
                visit_minutes integer,
                crowd_types json,
                image_url varchar(500),
                sort_order integer
            )
            """
        )
        connection.execute(
            """
            insert into scenic_spot(
                id, name, summary, story, tags, visit_minutes,
                crowd_types, image_url, sort_order
            )
            values (
                'spot_ling_shan_buddha', '灵山大佛', '旧数据库中的景点',
                '', '[]', 30, '[]', '', 10
            )
            """
        )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        fact = connection.execute(
            """
            select fact_label, fact_value, fact_unit, source_type
            from spot_fact
            where spot_id = 'spot_ling_shan_buddha'
            and fact_key = 'height_meters'
            """
        ).fetchone()

    assert fact == ("高度", "88", "米", "database")


def test_bootstrap_keeps_approved_web_facts_separate_from_candidates(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        approved_fact = connection.execute(
            """
            select entity_id, fact_key, fact_value, source_url, source_level
            from approved_web_fact
            where entity_id = 'spot_ling_shan_buddha'
            and fact_key = 'height_meters'
            """
        ).fetchone()
        candidate_count = connection.execute(
            "select count(*) from web_fact_candidate"
        ).fetchone()[0]

    assert approved_fact == (
        "spot_ling_shan_buddha",
        "height_meters",
        "88",
        "https://www.lingshan.com.cn/web/park/introduction/1.html",
        "official",
    )
    assert candidate_count == 0


def test_bootstrap_updates_approved_web_fact_source_url(tmp_path):
    db_path = tmp_path / "app.db"
    app = create_app(
        Settings(
            database_url=f"sqlite:///{db_path}",
            source_package_path=str(SOURCE_PACKAGE_PATH),
            derived_knowledge_path=str(DERIVED_KNOWLEDGE_PATH),
        )
    )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            update approved_web_fact
            set source_url = 'https://www.lssf.com.cn/'
            where entity_id = 'spot_ling_shan_buddha'
            and fact_key = 'height_meters'
            """
        )

    with TestClient(app):
        pass

    with sqlite3.connect(db_path) as connection:
        source_url = connection.execute(
            """
            select source_url
            from approved_web_fact
            where entity_id = 'spot_ling_shan_buddha'
            and fact_key = 'height_meters'
            """
        ).fetchone()[0]

    assert source_url == "https://www.lingshan.com.cn/web/park/introduction/1.html"


def _package_file_hashes(package_path: Path) -> dict[str, str]:
    return {
        file_path.name: hashlib.sha256(file_path.read_bytes()).hexdigest()
        for file_path in package_path.iterdir()
        if file_path.is_file()
    }
