FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 8080

# Apply migrations on startup, then run the API.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/main.js"]
