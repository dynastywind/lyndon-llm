import pytest


@pytest.mark.asyncio
async def test_build_system_prompt_sets_base_prompt_without_memories(monkeypatch):
    from chat.memory.cross_session_file import CrossSessionFileMemory
    from chat.memory.long_term import LongTermMemory
    from chat.memory.manager import MemoryManager
    from chat.memory.session_file import SessionFileMemory

    async def no_memories(self, query, top_k=None, **kwargs):
        return []

    monkeypatch.setattr(LongTermMemory, "retrieve", no_memories)
    # Isolate from any real memory files on disk
    monkeypatch.setattr(CrossSessionFileMemory, "load", lambda self: None)
    monkeypatch.setattr(SessionFileMemory, "load", lambda self, sid: None)

    manager = MemoryManager("test-session")
    prompt = await manager.build_system_prompt(
        "Base prompt with RAG context",
        "question",
    )

    assert prompt == "Base prompt with RAG context"
    assert manager.get_messages()[0] == {
        "role": "system",
        "content": "Base prompt with RAG context",
    }
