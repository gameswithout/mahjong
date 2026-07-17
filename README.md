# mahjong

## AGS CLI setup

Configure the project-specific AGS profile once:

```bash
./scripts/configure-ags-cli.sh
./scripts/login-ags-cli.sh
```

The setup script stores the confidential tooling client ID and other non-secret
project settings in the local `mahjong` AGS CLI profile. It never stores the
client secret in this repository. Each developer must obtain that secret from
the project secrets vault for the one-time client-credentials login.

Use the login script instead of plain `ags auth login`. The CLI defaults the
plain command to browser authorization-code login, which is incompatible with
this project's confidential tooling client.
