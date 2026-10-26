# Slack toggle checks

Set `TMUXAXXING_ROOT` in the tmux server before sourcing `tmux/tmuxaxxing.tmux.conf`, using the local repository path.

- [ ] With no `slack` session, press prefix+s. Confirm it creates the session, shows slk, and the status line shows session `slack`.
- [ ] Press prefix+s again. Confirm it returns to the exact pane you came from.
- [ ] Press prefix+s a third time. Confirm it returns to slk without restarting it. Compare `tmux display -p -t slack '#{pane_pid}'` before and after.
- [ ] Temporarily remove slk from the tmux server's `PATH`, then press prefix+s. Confirm it shows `slk not found`.

# Sidebar and status checks

- [ ] Open a new non-Slack window. Confirm it gets one left and one right sidebar.
- [ ] Press prefix+a, then prefix+g. Confirm each key hides and restores only its matching sidebar.
- [ ] Press prefix+R. Confirm both sidebars reload without duplicates.
- [ ] Trigger working, approval and done states. Confirm the status counters move.
- [ ] Leave an approval or unseen done item in a window. Confirm the window status has a dot.
- [ ] Click `slk` in the status line. Confirm it toggles Slack.
- [ ] Click a PR row in the GitHub sidebar. Confirm the browser opens it and the `>` marker moves there.
- [ ] Scroll the wheel over a sidebar. Confirm the selection moves one row per notch.
- [ ] Click a session row in the agents sidebar. Confirm tmux jumps to that pane.
- [ ] Click `⏎:open` in the agents footer. Confirm it opens the selected session.
- [ ] Quit a sidebar (`prefix x`) and type in the shell that replaces it. Confirm no `[<0;...M` garbage appears.
