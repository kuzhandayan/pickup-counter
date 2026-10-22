# 1. Build the customer screen
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# 2. Run the API, which also serves the built screen
FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["npm", "start"]
