FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json to the workspace
COPY package*.json ./

# Install app dependencies (if any are added in the future)
RUN npm install

# Bundle app source
COPY . .

# The built-in Node server listens on 8080
EXPOSE 8080

# Start the Node.js HTTP server
CMD [ "npm", "start" ]
