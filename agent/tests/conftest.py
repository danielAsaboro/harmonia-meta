import os

os.environ.setdefault("WEB_INTERNAL_URL", "http://localhost:3000")
# Tests assert against these exact values, so they must win over whatever the
# shell or CI job exports (the Verify workflow sets its own token and project).
os.environ["INTERNAL_API_TOKEN"] = "test-token-not-a-secret"
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
os.environ.setdefault("MODEL_API_KEY", "fake-key-for-unit-tests")
os.environ.setdefault("GITHUB_TOKEN", "ghp_fake-token-for-unit-tests")
