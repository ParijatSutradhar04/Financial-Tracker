import os

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL or "postgres://invalid:invalid@127.0.0.1:1/none"
os.environ.setdefault("APP_TIMEZONE", "Asia/Kolkata")
os.environ["LAYA_SPACE_URL"] = "https://laya.test"
os.environ["LAYA_HF_TOKEN"] = "test-token"
