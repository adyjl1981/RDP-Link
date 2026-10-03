FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY lib ./lib
COPY public ./public
USER node
CMD ["node", "server.js"]
