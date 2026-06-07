# Operations Runbook

## Memory-at-rest encryption

PII-bearing memory (per-session `.md` files, the per-user cross-session file,
and Chroma `long_term_memory` documents) is encrypted at rest. Each artifact is
encrypted with a per-scope key derived from the server master secret:

```
key = HKDF-SHA256(secret = JWT_SECRET_KEY, salt = app-salt, info = scope_id)
```

- `scope_id` = `user_id` for the cross-session file, `session_id` for session
  files, and `user_id or session_id` for Chroma documents.
- Decryption is transparent in-process so the **local** model still receives
  real values; PII leaves the device only after redaction (`core/security/pii.py`).
- Toggle: `MEMORY_ENCRYPTION_ENABLED` (default `true`).

### ⚠️ JWT_SECRET_KEY is also the memory encryption key

Because the encryption key is derived from `JWT_SECRET_KEY`, **rotating that
secret makes all existing memory unreadable** — at runtime `decrypt()` fails and
falls back to returning ciphertext, so the model silently loses the user's
profile and past-session context (it does not crash, which makes this easy to
miss).

**Never rotate `JWT_SECRET_KEY` without re-keying memory first.**

---

## Procedure: rotating `JWT_SECRET_KEY`

Re-key memory whenever you change `JWT_SECRET_KEY`. Run from the `backend/`
directory with the virtualenv (`.venv`).

1. **Stop the backend** (or put it in maintenance) so nothing writes new
   memory mid-rotation.

2. **Note the current (old) secret.** Copy the existing `JWT_SECRET_KEY` value
   from `.env` somewhere safe — you need it to decrypt.

3. **Set the new secret in `.env`:**
   ```
   JWT_SECRET_KEY=<new-secret>
   ```

4. **Dry-run the re-key** (reports counts, writes nothing):
   ```bash
   OLD_JWT_SECRET_KEY="<old-secret>" REKEY_DRY_RUN=1 \
     .venv/bin/python -m scripts.rekey_memory
   ```
   If the old key is wrong, this aborts **before** touching any data
   (`ABORTED: could not decrypt … wrong old key?`). Fix the old key and retry.

5. **Apply the re-key:**
   ```bash
   OLD_JWT_SECRET_KEY="<old-secret>" \
     .venv/bin/python -m scripts.rekey_memory
   ```
   It decrypts every file + Chroma document with the old key (in memory, all at
   once — fail-closed) and rewrites them encrypted under the new key.

6. **Start the backend** and verify a logged-in user's profile still loads
   (e.g. ask "what do you know about me?" — the model should still recall it).

### Notes
- **Fail-closed & re-runnable.** If any ciphertext can't be decrypted with the
  supplied `OLD_JWT_SECRET_KEY`, the script aborts before writing, so a mistyped
  old key can't corrupt data. Legacy plaintext is simply encrypted with the new
  key. Safe to re-run.
- **Rotating the JWT secret also invalidates issued login tokens** (sessions),
  which is expected — users re-authenticate. That is independent of memory.
- Set `NEW_JWT_SECRET_KEY` explicitly if you want to re-key to a key other than
  the one currently in `.env` (defaults to `settings.jwt_secret_key`).

---

## Related one-time migration

`scripts/migrate_encrypt_memory.py` encrypts **pre-existing plaintext** memory
(first rollout of encryption). It is idempotent and skips already-encrypted
content. Use `rekey_memory.py` — not this — when the key changes.
