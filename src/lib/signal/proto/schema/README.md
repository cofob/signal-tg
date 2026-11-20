# Signal protobuf schemas

Copied without changes from [signalapp/Signal-Android](https://github.com/signalapp/Signal-Android), commit
`aa38b25dae46798bce4b31fc0f71f77d4b8b0bfb` (2026-11-18), licensed under GPL-3.0:

| File | Source path |
| --- | --- |
| `SignalService.proto`, `Provisioning.proto`, `Groups.proto`, `DecryptedGroups.proto`, `StorageService.proto`, `StickerResources.proto` | `lib/libsignal-service/src/main/protowire/` |
| `WebSocketResources.proto` | `core/network/src/main/protowire/` |
| `DeviceName.proto` | `core/util-jvm/src/main/protowire/` |
| `Backup.proto` | `lib/archive/src/main/protowire/` |

`ProvisionEnvelope.proto` is `rust/provisioning/src/proto/provisioning.proto` from
[signalapp/libsignal](https://github.com/signalapp/libsignal) `v0.108.3`, licensed under AGPL-3.0.

After updating a schema, run `npm run signal:proto` to regenerate `../generated` with
[protobuf-es](https://github.com/bufbuild/protobuf-es) (`buf.gen.yaml` at the repository root).
