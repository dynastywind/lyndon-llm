"""CRUD for user accounts."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.user import User


class UserRepo:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def get_by_id(self, user_id: str) -> User | None:
        result = await self._db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        result = await self._db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def count(self) -> int:
        from sqlalchemy import func

        result = await self._db.execute(select(func.count()).select_from(User))
        return result.scalar_one()

    async def create(self, username: str, hashed_password: str) -> User:
        row = User(username=username, hashed_password=hashed_password)
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def get_by_oauth(self, provider: str, sub: str) -> User | None:
        result = await self._db.execute(
            select(User).where(User.oauth_provider == provider, User.oauth_sub == sub)
        )
        return result.scalar_one_or_none()

    async def create_oauth(
        self, username: str, provider: str, sub: str, email: str | None = None
    ) -> User:
        row = User(username=username, oauth_provider=provider, oauth_sub=sub, email=email)
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        return row

    async def update_password(self, user_id: str, hashed_password: str) -> None:
        row = await self.get_by_id(user_id)
        if row:
            row.hashed_password = hashed_password
            await self._db.commit()

    async def get_by_email(self, email: str) -> User | None:
        result = await self._db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def link_oauth(self, user_id: str, provider: str, sub: str) -> None:
        """Attach an OAuth identity to an existing account (e.g. password user signs in via Google)."""
        row = await self.get_by_id(user_id)
        if row:
            row.oauth_provider = provider
            row.oauth_sub = sub
            await self._db.commit()

    async def update_email(self, user_id: str, email: str | None) -> None:
        row = await self.get_by_id(user_id)
        if row:
            row.email = email
            await self._db.commit()

    async def delete(self, user_id: str) -> None:
        row = await self.get_by_id(user_id)
        if row:
            await self._db.delete(row)
            await self._db.commit()
