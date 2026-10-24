#!/bin/sh
set -eu

if [ -n "${FEED_COUNTER_FILE:-}" ]; then
  printf '%s\n' run >> "$FEED_COUNTER_FILE"
fi

if [ "${FEED_HOLD_LOCK:-}" = "1" ]; then
  sleep 0.2
fi

case "${FEED_MODE:-good}" in
  good)
    printf '%s\n' '{"sections":[{"title":"FEED","items":[{"id":"item-1","text":"One"}]}]}'
    ;;
  fail)
    printf '%s\n' 'gh: not logged in' >&2
    exit 1
    ;;
  invalid)
    printf '%s\n' 'not json'
    ;;
  sleep)
    exec sleep 1
    ;;
  *)
    printf '%s\n' "unknown feed mode: ${FEED_MODE}" >&2
    exit 2
    ;;
esac
