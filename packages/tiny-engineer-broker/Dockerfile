FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
ENV TE_BROKER_PORT=8790
EXPOSE 8790
USER node
CMD ["node", "bin/tiny-engineer-broker.js"]
