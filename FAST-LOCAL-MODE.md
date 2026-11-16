# Fast local mode (opt-in, experimental)

This branch introduces an IndexedDB-authoritative workflow for the Firebase version of Mol Bench. It is **not enabled by default**. The user explicitly activates it from the navigation toolbar after a full Drive-to-local migration.

## What it does

- Reads all molecules (including full XYZ bodies) and reactions from the existing Drive-authoritative store once.
- Copies the records and their IDs to **separate, account-scoped** IndexedDB databases without modifying or deleting Drive files.
- Verifies local molecule/reaction counts and refreshes the Drive metadata before enabling the mode.
- After reload, molecule editing, import/export, deletion, naming, tags, and reaction operations use local IndexedDB. The molecule import/export Worker is explicitly given the same local scope.
- Preserves the prior Drive data unchanged as a recovery point.

## IMPORTANT — backups are not automatic yet

While fast local mode is active, **new changes are NOT backed up to Drive**. Export complete molecule and reaction ZIP archives periodically. Do not clear site data or switch browsers until backups exist. The mode indicator explicitly says this. A separate incrementally synchronized, resumable backup mechanism is necessary before fast local mode is a recommended production default.

No automatic merge, multi-device synchronization, or cloud-to-local re-import after activation is implemented. Concurrent editing from multiple devices will diverge.

## Enable

1. Close other Mol Bench tabs and open the published molecular library with Drive connected.
2. Select **高速ローカルへ移行** and read the warning.
3. Allow the one-time full migration to finish. If the operation fails, the Drive-first mode remains active and the Drive data stays unchanged.
4. Following the reload, verify molecule/reaction entries and export ZIP backups.

## Testing required before publication

- Run Node tests and browser integration tests.
- Test one-time migration of molecules and reaction records, including blobs/raw XYZ, names, tags, charge/multiplicity, and revisions.
- Verify Worker and cooperative fallback paths, bulk registration/export, thumbnails, local edit/save/overwrite and reaction creation.
- Simulate Drive disconnection during migration and IndexedDB quota failure.
- Verify migration detects a concurrent Drive change and doesn't enable the local flag.
- Verify existing Drive-first mode stays unchanged until opt-in.

This branch should remain a draft until these checks are completed and an automatic backup mechanism is implemented.
