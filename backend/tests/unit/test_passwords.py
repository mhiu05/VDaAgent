"""argon2id password hashing (doc 12 "Login") and the in-memory login rate limit."""

from backend.auth import passwords
from backend.auth.ratelimit import LoginLimiter
from backend.auth.sessions import COOKIE_NAME, hash_token, new_token


def test_hash_is_argon2id_and_verifies():
    h = passwords.hash_password("đúng-mật-khẩu")
    assert h.startswith("$argon2id$")
    assert "đúng-mật-khẩu" not in h
    assert passwords.verify_password(h, "đúng-mật-khẩu")


def test_wrong_password_and_garbage_hash_do_not_verify():
    h = passwords.hash_password("secret-1")
    assert not passwords.verify_password(h, "secret-2")
    assert not passwords.verify_password("not-a-hash", "secret-1")
    assert not passwords.verify_password("", "secret-1")


def test_hashes_are_salted():
    assert passwords.hash_password("same") != passwords.hash_password("same")


def test_needs_rehash_for_weaker_parameters():
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("x")
    assert passwords.needs_rehash(weak)
    assert not passwords.needs_rehash(passwords.hash_password("x"))


def test_dummy_verify_takes_the_same_path():
    # Unknown users are checked against a fixed hash so timing matches a wrong password.
    assert passwords.verify_password(passwords.DUMMY_HASH, "anything") is False


def test_session_token_is_32_bytes_b64url_and_hashes_to_sha256():
    cookie, digest = new_token()
    assert COOKIE_NAME == "contoso_session"
    assert len(cookie) == 43 and "=" not in cookie
    assert set(cookie) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    assert len(digest) == 32
    assert hash_token(cookie) == digest
    assert new_token()[0] != cookie


def test_hash_token_rejects_malformed_cookies():
    assert hash_token("") is None
    assert hash_token("short") is None
    assert hash_token("!" * 43) is None
    assert hash_token("A" * 44) is None


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_limiter_blocks_after_ten_failures_per_username_for_fifteen_minutes():
    clock = Clock()
    lim = LoginLimiter(clock=clock)
    for _ in range(10):
        assert not lim.blocked("alice")
        lim.fail("alice")
    assert lim.blocked("alice")
    assert not lim.blocked("bob")
    assert 0 < lim.retry_after("alice") <= 15 * 60
    clock.t += 15 * 60 + 1
    assert not lim.blocked("alice")


def test_limiter_window_slides_and_success_resets():
    clock = Clock()
    lim = LoginLimiter(clock=clock)
    for _ in range(9):
        lim.fail("alice")
    clock.t += 14 * 60
    lim.fail("alice")
    assert lim.blocked("alice")
    clock.t += 2 * 60  # the first nine are older than 15 minutes now
    assert not lim.blocked("alice")
    lim.fail("alice")
    lim.reset("alice")
    assert not lim.blocked("alice")
