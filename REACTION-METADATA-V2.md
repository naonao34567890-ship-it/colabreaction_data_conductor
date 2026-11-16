# Reaction metadata v2 and Colab round-trip

## Input archive

`reaction-library.json` now uses `format: "mol-bench-reaction-library"`, `version: 2` and retains the existing `archiveId`, `createdAt`, `count`, `source`, and `reactions` attributes.

Each `reactions[]` item explicitly includes:

- `reactionId`: original persistent reaction identifier (not a display name).
- `name`: user-visible original reaction name.
- `classification`: original reaction classification, or `null`.
- `tags`: ordered list of tags.
- `createdAt`: original record creation time.
- `record`: existing hash-verified typed full-record reference.
- `endpoints`: existing START/FINISH (including electronic state, revision, XYZ paths and checksums).

The full `record.json` still preserves arbitrary supported reaction attributes, file bytes and raw structures. This is not replaced by the reduced list of manifest fields. Version 1 input archives remain readable.

## ColabReaction version 2 output

The companion one-cell Colab notebook (`ColabReaction_checkpoint_drive_live_timestamps_metadata_v2.ipynb`) accepts v1 and v2 reaction-library ZIP files. Every successfully started per-reaction calculation ZIP includes:

- `reaction-context.json`: `format:"mol-bench-reaction-context"`, `version:2`, source reaction ID and name, classification, tags, original creation time, endpoint metadata, entire source manifest entry and SHA256 of the input archive.
- `source-reaction.zip`: a single-reaction, fully restorable snapshot of the original archive's `record.json`, referenced blobs and START/FINISH XYZ.
- All prior DMF trajectory/energy/vibration outputs, logs and result images.

`batch_status.json` records the original reaction name, ID, classification and tags for both completed jobs and rejected jobs. It now identifies itself with `format:"mol-bench-colabreaction-batch"` and `version:2`.

## Returning from Colab viewer

The Colab calculation-record page reads the context and attaches the original classification to its Drive metadata when the name is within the existing 100-byte limit. The full context remains in the imported source folder even for longer labels.

When the reaction viewer creates a new START entry, it restores arbitrary additional typed attributes from `source-reaction.zip`, but gives the new reaction a new ID and creation time. The original ID/creation time and archive checksum are preserved separately as provenance. The old START and FINISH coordinates are not silently copied over the newly selected path frame.

For data with no v2 context, the existing legacy behavior is preserved.

## Clipboard behavior

The molecule and reaction libraries have Copy/Paste controls and Ctrl+C/Ctrl+V. Only `mol-bench-clipboard` payloads with a matching library kind are accepted; unrelated clipboard data is ignored. Copies receive newly allocated record IDs. Reaction copy/paste preserves tags, classification, both endpoints and supported typed fields. Large copies use a local IndexedDB clipboard reference, which works between tabs in the same browser/origin but is not a portable cross-device clipboard.

## Vibrations

The viewer incorporates the existing PR #2 design: select reaction path or a local maximum's 40-frame vibration XYZ, play/pause and 1/2/4/8/12 fps looping. Vibration XYZ is loaded only when requested. Notebook animation display cells are not required.

## Safety / release status

This feature is on the experimental PR #3 branch, NOT on main and NOT deployed. The fast-local mode still requires automatic background backup and end-to-end browser/Colab testing before production release. In particular, do not switch modes or clear browser data without a verified backup.
