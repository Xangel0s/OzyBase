#!/bin/sh
set -eu

seed_dir="/app/migrations_seed"
target_dir="/app/migrations"
data_dir="/app/data"
functions_dir="/app/functions"
skip_seed="${OZY_SKIP_MIGRATIONS_SEED:-false}"
run_user="ozybase"
run_group="ozybase"

ensure_dir() {
  dir="$1"
  [ -d "$dir" ] || mkdir -p "$dir"
}

ensure_dir "$target_dir"
ensure_dir "$data_dir"
ensure_dir "$functions_dir"

if [ "$(id -u)" = "0" ]; then
  chown -R "${run_user}:${run_group}" "$target_dir" "$data_dir" "$functions_dir"
fi

if [ "$skip_seed" = "true" ] || [ "$skip_seed" = "1" ]; then
  if [ "$(id -u)" = "0" ]; then
    exec su-exec "${run_user}:${run_group}" "$@"
  fi
  exec "$@"
fi

if [ -d "$seed_dir" ]; then
  if [ -z "$(ls -A "$target_dir" 2>/dev/null)" ]; then
    cp -a "$seed_dir/." "$target_dir/"
    if [ "$(id -u)" = "0" ]; then
      chown -R "${run_user}:${run_group}" "$target_dir"
    fi
  fi
fi

if [ "$(id -u)" = "0" ]; then
  exec su-exec "${run_user}:${run_group}" "$@"
fi

exec "$@"
