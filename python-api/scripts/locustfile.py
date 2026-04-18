"""Locust scenario for the python-api endpoints.

Quick run:
    .venv/bin/pip install locust
    .venv/bin/locust -f scripts/locustfile.py --host http://127.0.0.1:8010

Weights reflect a rough production mix:
  - 3×  NL /products (primary chat path)
  - 2×  manual-filter /products (UI form)
  - 1×  /filter-options toggle
  - 1×  /health probe (load balancer ping equivalent)
"""
from locust import HttpUser, task, between


class ARIAUser(HttpUser):
    wait_time = between(1, 3)

    @task(3)
    def products_nl(self):
        self.client.post("/products", json={
            "message": "수스 10mm 4날 스퀘어",
        }, name="/products NL")

    @task(2)
    def products_manual(self):
        self.client.post("/products", json={
            "filters": {"material_tag": "M", "diameter": 10},
        }, name="/products manual")

    @task(1)
    def filter_options(self):
        self.client.post("/filter-options", json={
            "field": "subtype",
            "current_filters": {"material_tag": "M"},
        }, name="/filter-options")

    @task(1)
    def health(self):
        self.client.get("/health", name="/health")
