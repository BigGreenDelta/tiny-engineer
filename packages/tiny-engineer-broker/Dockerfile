FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
ENV TE_BROKER_PORT=8790
# The pause switch lives here; mount a volume on /data to keep it across a
# container restart.
RUN mkdir -p /data && chown node:node /data
ENV TE_PAUSE_FILE=/data/pause.json
EXPOSE 8790
USER node
CMD ["node", "bin/tiny-engineer-broker.js"]
