"""
CLIP Embedder — app-level multimodal embeddings for image RAG.

Computes CLIP vectors in-process with ``open_clip`` and returns L2-normalized
vectors (cosine space). Used to embed images at ingest time and text queries at
retrieval time so they can be compared cross-modally in a dedicated image
collection. Kept independent of the vector store so the same vectors work on
both Chroma and Qdrant.

The model is heavy (~350 MB download for ViT-B-32 on first use) and torch calls
are blocking, so loading is lazy and every public method runs off the event loop
via ``asyncio.to_thread``.
"""

from __future__ import annotations

import asyncio
import logging

from config.settings import settings

logger = logging.getLogger(__name__)


class ClipEmbedder:
    def __init__(self) -> None:
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._device = "cpu"

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        import open_clip
        import torch

        if torch.cuda.is_available():
            self._device = "cuda"
        elif torch.backends.mps.is_available():
            self._device = "mps"
        else:
            self._device = "cpu"

        logger.info(
            "Loading CLIP model %s (%s) on %s",
            settings.clip_model,
            settings.clip_pretrained,
            self._device,
        )
        model, _, preprocess = open_clip.create_model_and_transforms(
            settings.clip_model,
            pretrained=settings.clip_pretrained,
            device=self._device,
        )
        model.eval()
        self._model = model
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer(settings.clip_model)

    def _embed_images_sync(self, paths: list[str]) -> list[list[float]]:
        from PIL import Image
        import torch

        self._ensure_loaded()
        tensors = []
        for path in paths:
            img = Image.open(path).convert("RGB")
            tensors.append(self._preprocess(img))
        batch = torch.stack(tensors).to(self._device)
        with torch.no_grad():
            feats = self._model.encode_image(batch)
            feats /= feats.norm(dim=-1, keepdim=True)
        return feats.cpu().tolist()

    def _embed_texts_sync(self, texts: list[str]) -> list[list[float]]:
        import torch

        self._ensure_loaded()
        tokens = self._tokenizer(texts).to(self._device)
        with torch.no_grad():
            feats = self._model.encode_text(tokens)
            feats /= feats.norm(dim=-1, keepdim=True)
        return feats.cpu().tolist()

    async def embed_images(self, paths: list[str]) -> list[list[float]]:
        """Return one normalized CLIP vector per image path."""
        return await asyncio.to_thread(self._embed_images_sync, paths)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return one normalized CLIP vector per text string (text encoder)."""
        return await asyncio.to_thread(self._embed_texts_sync, texts)


# Module-level singleton
clip_embedder = ClipEmbedder()
