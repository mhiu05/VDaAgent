from backend.settings import Settings


def test_defaults_match_doc_16(clean_env):
    s = Settings()
    assert s.AGENT_MODEL == "anthropic/claude-haiku-4.5"
    assert s.JEV_MODEL == "typesafe/jev-1.14"
    assert s.COMPACTION_MODEL == s.AGENT_MODEL
    assert s.OPENROUTER_BASE_URL == "https://openrouter.ai/api/v1"
    assert s.LANGFUSE_INIT_USER_EMAIL == "admin@contoso.local"
    assert s.LANGFUSE_PUBLIC_URL == "http://localhost:3100"
    assert s.APP_PORT == 8000
    assert s.APP_URL == "http://localhost:8000"
    assert s.COOKIE_SECURE is False
    assert s.MODEL_BACKEND == "openrouter"
    assert s.MODEL_CONTEXT_TOKENS is None
    assert s.GITHUB_TOKEN.get_secret_value() == ""


def test_tunable_defaults(clean_env):
    s = Settings()
    assert s.SOFT_CONTEXT_RATIO == 0.6
    assert s.HARD_CONTEXT_RATIO == 0.9
    assert s.OFFLOAD_CHARS == 8000
    assert s.EXEC_TIMEOUT_S == 120
    assert s.EXEC_MEM_MB == 2048
    assert s.MAX_STEPS_PER_ACTIVATION == 50
    assert s.MODEL_TIMEOUT_S == 120
    assert s.TASK_MAX_S == 3600
    assert s.JEV_K == 20
    assert s.JEV_CONFIDENCE_FLOOR == 0.6
    assert s.MAX_AGENTS_PER_USER == 12


def test_service_defaults(clean_env):
    s = Settings()
    assert s.EXECD_URL == "http://workspace:7000"
    assert s.LANGFUSE_BASE_URL == "http://langfuse-web:3000"
    assert s.DOMAINS_DIR == "/domains"


def test_every_doc_16_key_is_a_setting():
    keys = {
        "OPENROUTER_API_KEY",
        "ADMIN_USERNAME",
        "ADMIN_PASSWORD",
        "AGENT_MODEL",
        "JEV_MODEL",
        "JEV_CONFIDENCE_FLOOR",
        "COMPACTION_MODEL",
        "OPENROUTER_BASE_URL",
        "POSTGRES_PASSWORD",
        "SESSION_SECRET",
        "EXECD_TOKEN",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "LANGFUSE_NEXTAUTH_SECRET",
        "LANGFUSE_SALT",
        "LANGFUSE_ENCRYPTION_KEY",
        "CLICKHOUSE_PASSWORD",
        "REDIS_AUTH",
        "MINIO_ROOT_PASSWORD",
        "LANGFUSE_INIT_USER_EMAIL",
        "LANGFUSE_PUBLIC_URL",
        "APP_PORT",
        "APP_URL",
        "COOKIE_SECURE",
        "GITHUB_TOKEN",
        "MODEL_BACKEND",
        "MODEL_CONTEXT_TOKENS",
    }
    assert keys <= set(Settings.model_fields)


def test_app_url_follows_app_port(clean_env):
    clean_env.setenv("APP_PORT", "8010")
    assert Settings().APP_URL == "http://localhost:8010"


def test_compaction_model_follows_agent_model(clean_env):
    clean_env.setenv("AGENT_MODEL", "openai/gpt-4o-mini")
    s = Settings()
    assert s.COMPACTION_MODEL == "openai/gpt-4o-mini"
    clean_env.setenv("COMPACTION_MODEL", "x/y")
    assert Settings().COMPACTION_MODEL == "x/y"


def test_reads_dotenv_and_process_env_wins(clean_env, tmp_path):
    (tmp_path / ".env").write_text("JEV_MODEL=from/dotenv\nAGENT_MODEL=from/dotenv\n")
    clean_env.setenv("AGENT_MODEL", "from/process")
    s = Settings()
    assert s.JEV_MODEL == "from/dotenv"
    assert s.AGENT_MODEL == "from/process"


def test_unknown_dotenv_keys_are_ignored(clean_env, tmp_path):
    (tmp_path / ".env").write_text("SOMETHING_ELSE=1\n")
    Settings()


def test_secrets_are_not_in_repr(platform_env):
    text = repr(Settings())
    for value in platform_env.values():
        if value != "admin":
            assert value not in text


def test_cookie_secure_parses_one(clean_env):
    clean_env.setenv("COOKIE_SECURE", "1")
    assert Settings().COOKIE_SECURE is True
