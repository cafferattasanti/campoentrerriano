FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY content ./content
ENV NODE_ENV=production DB_PATH=/data/campo.db PORT=3000
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/salud || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
