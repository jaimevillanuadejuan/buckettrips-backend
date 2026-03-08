FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 8080

# Sync Prisma schema to the DB on startup, then run the API.
CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
