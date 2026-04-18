"""E2E /recommend — runs the full stack via FastAPI TestClient (in-process).

The /recommend handler calls Haiku + the live DB, so these are marked `slow`
(LLM-backed) and `db` (PG-backed). Skipped cleanly if either is unavailable.
"""
import pytest


def test_health(api_client, db_conn):
    r = api_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["product_count"] > 100_000


@pytest.mark.slow
@pytest.mark.db
def test_recommend_returns_top5_with_scores(api_client, db_conn, anthropic_client):
    r = api_client.post("/recommend", json={"message": "10mm 4날 스테인리스 볼 엔드밀"})
    assert r.status_code == 200
    body = r.json()

    assert set(body.keys()) == {
        "filters", "candidates", "scores", "answer", "route", "removed_tokens",
    }
    assert body["route"] in {"deterministic", "kg", "llm"}
    assert body["filters"]["diameter"] == 10
    assert body["filters"]["flute_count"] == 4
    assert body["filters"]["material_tag"] == "M"

    assert 0 < len(body["candidates"]) <= 5
    assert len(body["candidates"]) == len(body["scores"])

    # scores must be monotonically non-increasing
    score_values = [s["score"] for s in body["scores"]]
    assert score_values == sorted(score_values, reverse=True)

    # breakdown keys: base weight schema + affinity + flagship + material_pref
    assert set(body["scores"][0]["breakdown"].keys()) == {
        "diameter", "flutes", "material", "shape", "coating",
        "affinity", "flagship", "material_pref",
    }


@pytest.mark.slow
@pytest.mark.db
def test_recommend_answer_mentions_top_brand(api_client, db_conn, anthropic_client):
    r = api_client.post("/recommend", json={"message": "10mm 볼 엔드밀"})
    assert r.status_code == 200
    body = r.json()
    if body["candidates"]:
        top_brand = body["candidates"][0]["brand"]
        if top_brand:
            assert top_brand in body["answer"]


def test_recommend_rejects_empty_message(api_client):
    r = api_client.post("/recommend", json={"message": ""})
    assert r.status_code == 422  # Pydantic min_length=1


def test_recommend_rejects_missing_field(api_client):
    r = api_client.post("/recommend", json={})
    assert r.status_code == 422
