# Changelog

## 0.10.0

- Feature: Queue-based investigation system - investigations run sequentially
- Feature: Catchup scanning - every trigger also checks for uninvestigated open issues
- Feature: Issue author notification - `@author` mentioned in investigation comments
- Feature: Failure backoff - 3 consecutive failures → 30 min backoff; 6 → worker exits
- Feature: New `/queue` endpoint to view queue status and investigated issues
- Refactor: Split investigate.sh into entry point + investigate-issue.sh worker

## 0.7.0

- Feature: ADB now works via Tailscale nc proxy (fixes userspace networking limitation)
- Add socat for TCP port forwarding through Tailscale
- Fix: Use --dangerously-skip-permissions for automated Claude tool execution

## 0.6.0

- Feature: Add ttyd web terminal for interactive Claude OAuth authentication
- Fix: Update Tailscale to 1.92.3 (installed directly instead of outdated Alpine package)
- Access web terminal via HA sidebar to run `claude` and complete OAuth login

## 0.5.0

- Feature: Simplified credential handling
- Removed complex gnome-keyring setup

## 0.4.0

- Feature: Built-in Tailscale support for ADB over VPN
- Add tailscale_auth_key config option
- ADB timeout reduced to 10 seconds

## 0.3.0

- Feature: Add HTTP API server on port 8099 for triggering investigations
- Replace shell_command with rest_command approach

## 0.2.0

- Feature: Add Claude OAuth credentials support for subscription-based auth
- Credentials from laptop can be transferred to add-on config

## 0.1.1

- Fix: Use jq instead of bashio for config reading
- Fix: Add proper config loading feedback in logs

## 0.1.0

- Initial release
