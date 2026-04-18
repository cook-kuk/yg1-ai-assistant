"""Shared fixtures: DB connection + Anthropic client + FastAPI test client."""
import os
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT.parent / ".env")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: LLM/network-backed tests (opt-in)")
    config.addinivalue_line("markers", "db: requires live PostgreSQL connection")


@pytest.fixture(scope="session")
def db_conn():
    """Yields a live psycopg2 connection from the shared pool. Skips the test
    if the DB is unreachable so the rest of the suite can still run."""
    from db import get_conn
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as e:
        pytest.skip(f"DB unreachable: {e}")
    from db import get_pool
    with get_pool().getconn() as _:
        pass
    yield


@pytest.fixture(scope="session")
def anthropic_client():
    """Anthropic SDK client, or skip if no API key present."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        pytest.skip("ANTHROPIC_API_KEY not set")
    from anthropic import Anthropic
    return Anthropic(api_key=key)


@pytest.fixture(scope="session")
def api_client():
    """In-process FastAPI client — no uvicorn required."""
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app) as c:
        yield c
