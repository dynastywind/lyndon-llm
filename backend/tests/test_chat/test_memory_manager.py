import pytest


@pytest.mark.asyncio
async def test_build_system_prompt_sets_base_prompt_without_memories(monkeypatch):
    from chat.memory.long_term import LongTermMemory
    from chat.memory.manager import MemoryManager

    async def no_memories(self, query, top_k=None):
        return []

    monkeypatch.setattr(LongTermMemory, "retrieve", no_memories)

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
