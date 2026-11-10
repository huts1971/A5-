"""Isolated defaults for the original business-service regression suite."""

import os


os.environ.update({
    "AUTH_TOKEN_SECRET": "test-suite-signing-secret-for-local-fixtures-only",
    "ADMIN_DEFAULT_USERNAME": "admin",
    "ADMIN_DEFAULT_PASSWORD": "test-admin-password-123",
    "GUIDE_ENGINE": "legacy",
    "GUIDE_WARMUP_ON_STARTUP": "false",
    "RAG_EMBEDDING_INDEX_ON_STARTUP": "false",
})
