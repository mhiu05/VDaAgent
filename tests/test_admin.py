"""Unit and integration tests for Admin User Management endpoints."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from src.config import Settings
from src.services.permissions import permissions_for_role, role_can_manage_target
from src.services.repository import Repository


def test_admin_permissions():
    admin_perms = permissions_for_role("admin")
    assert "user.accounts.read" in admin_perms
    assert "user.account.manage" in admin_perms
    assert "system.admin" in admin_perms
    assert "dataset.read" in admin_perms


def test_admin_role_management():
    assert role_can_manage_target("admin", "analyst") is True
    assert role_can_manage_target("admin", "admin") is True
    assert role_can_manage_target("analyst", "admin") is False
    assert role_can_manage_target("analyst", "analyst") is True


def test_repository_user_status_and_role():
    engine = create_engine("sqlite:///:memory:")
    repo = Repository(engine=engine)

    # Sync a new user (normal registration receives analyst)
    user_id = "test-user-123"
    repo.sync_user_profile(user_id, "test@example.com", role="analyst")

    profile = repo.get_user_profile(user_id)
    assert profile is not None
    assert profile["email"] == "test@example.com"
    assert profile["role"] == "analyst"
    assert profile["status"] == "active"
    assert repo.is_user_locked(user_id) is False

    # Lock user
    updated = repo.update_user_status(user_id, "locked", "Security policy violation", "admin-1")
    assert updated["status"] == "locked"
    assert updated["locked_reason"] == "Security policy violation"
    assert repo.is_user_locked(user_id) is True

    # Check listing
    users_data = repo.list_all_users()
    assert users_data["stats"]["total_users"] >= 1
    assert users_data["stats"]["locked_users"] >= 1

    # Unlock user
    unlocked = repo.update_user_status(user_id, "active")
    assert unlocked["status"] == "active"
    assert unlocked["locked_reason"] is None
    assert repo.is_user_locked(user_id) is False

    # Update role to admin
    role_updated = repo.update_user_role(user_id, "admin")
    assert role_updated["role"] == "admin"


def test_default_admin_accounts_auto_promotion():
    engine = create_engine("sqlite:///:memory:")
    settings = Settings(
        app_env="test",
        database_url="postgresql+psycopg://user:password@localhost/test",
        global_admin_emails="admin1@example.com,admin2@example.com",
    )
    repo = Repository(engine=engine, settings=settings)

    # 1. Admin 1 logs in -> automatically gets role "admin"
    admin_1_id = "admin-user-001"
    repo.sync_user_profile(admin_1_id, "admin1@example.com", role="analyst")
    profile_1 = repo.get_user_profile(admin_1_id)
    assert profile_1 is not None
    assert profile_1["role"] == "admin"

    # 2. Admin 2 logs in -> automatically gets role "admin"
    admin_2_id = "admin-user-002"
    repo.sync_user_profile(admin_2_id, "ADMIN2@EXAMPLE.COM", role="analyst")
    profile_2 = repo.get_user_profile(admin_2_id)
    assert profile_2 is not None
    assert profile_2["role"] == "admin"

    # 3. Normal user registers -> receives role "analyst" (cannot register as admin)
    normal_user_id = "normal-user-003"
    repo.sync_user_profile(normal_user_id, "normal@example.com", role="analyst")
    normal_profile = repo.get_user_profile(normal_user_id)
    assert normal_profile is not None
    assert normal_profile["role"] == "analyst"


def test_delete_user_account():
    engine = create_engine("sqlite:///:memory:")
    settings = Settings(
        app_env="test",
        database_url="postgresql+psycopg://user:password@localhost/test",
        global_admin_emails="admin1@example.com",
    )
    repo = Repository(engine=engine, settings=settings)

    admin_id = "admin-01"
    repo.sync_user_profile(admin_id, "admin1@example.com", role="admin")

    user_to_delete_id = "user-delete-01"
    repo.sync_user_profile(user_to_delete_id, "victim@example.com", role="analyst")
    assert repo.get_user_profile(user_to_delete_id) is not None

    # Cannot delete self
    with pytest.raises(ValueError, match="tự xóa tài khoản"):
        repo.delete_user_account(admin_id, actor_user_id=admin_id)

    # Cannot delete default admin
    with pytest.raises(ValueError, match="Quản trị viên"):
        repo.delete_user_account(admin_id, actor_user_id="other-admin")

    # Successfully delete user
    res = repo.delete_user_account(user_to_delete_id, actor_user_id=admin_id)
    assert res["deleted"] is True
    assert repo.get_user_profile(user_to_delete_id) is None
