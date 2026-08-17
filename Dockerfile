FROM node:22-alpine AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/dist/wavy-erp-shell/browser /usr/share/nginx/html
EXPOSE 80
