# Slack toggle checks

Set `TMUXAXXING_ROOT` in the tmux server before sourcing `tmux/tmuxaxxing.tmux.conf`, using the local repository path.

- [ ] With no `slack` session, press prefix+s. Confirm it creates the session, shows slk, and the status line shows session `slack`.
- [ ] Press prefix+s again. Confirm it returns to the exact pane you came from.
- [ ] Press prefix+s a third time. Confirm it returns to slk without restarting it. Compare `tmux display -p -t slack '#{pane_pid}'` before and after.
- [ ] Temporarily remove slk from the tmux server's `PATH`, then press prefix+s. Confirm it shows `slk not found`.
