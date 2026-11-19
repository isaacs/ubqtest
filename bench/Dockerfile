# The benchmark of test tools, with a fixed budget of CPU and memory.
# Build from the root of the repository, after `npm run build`:
#   docker build -f bench/Dockerfile -t ubq-bench .
# `bench/docker.sh` does both, and runs the image.
FROM node:24-bookworm-slim
# GNU time gives the CPU time and the memory of a command.
RUN apt-get update && apt-get install -y --no-install-recommends time && rm -rf /var/lib/apt/lists/*
WORKDIR /bench
COPY bench/package.json ./
RUN npm install --no-audit --no-fund
# ubq as a project has it: the built package.
COPY dist node_modules/ubqtest
COPY bench/src src
COPY bench/gen.ts bench/run.ts ./
RUN node gen.ts
ENTRYPOINT ["node", "run.ts"]
