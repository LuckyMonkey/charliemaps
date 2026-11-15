FROM node:22-alpine AS web-build
WORKDIR /build/web
COPY web/package.json ./
RUN npm install --ignore-scripts
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY api/package.json ./
RUN npm install --ignore-scripts
COPY api/ ./
COPY --from=web-build /build/web/dist ./web/dist
USER node
EXPOSE 4100
CMD ["npm", "start"]
