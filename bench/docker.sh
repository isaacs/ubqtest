#!/bin/sh
# Builds ubq and the image of the benchmark, and runs it with a
# fixed budget: the CPUs and the memory are the same in each run,
# so the load of the machine has less effect on the times.
#   bench/docker.sh [--cpus 2] [--memory 2g] [options of run.ts]
set -e
cd "$(dirname "$0")/.." >/dev/null
cpus=2
memory=2g
while [ $# -gt 0 ]; do
  case "$1" in
    --cpus) cpus=$2; shift 2 ;;
    --memory) memory=$2; shift 2 ;;
    *) break ;;
  esac
done
npm run build >/dev/null
docker build -q -f bench/Dockerfile -t ubq-bench . >/dev/null
# The container has the first CPUs of the machine, and no others.
# With no swap, the memory limit is the real limit.
exec docker run --rm \
  --cpus "$cpus" --cpuset-cpus "0-$((cpus - 1))" \
  --memory "$memory" --memory-swap "$memory" \
  -e BENCH_CPUS="$cpus" -e BENCH_MEMORY="$memory" \
  ubq-bench "$@"
